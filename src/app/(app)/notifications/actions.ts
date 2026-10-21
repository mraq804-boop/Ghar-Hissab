"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { karachiInstant } from "@/lib/notify/rules";
import { getContext } from "@/server/auth";
import { dbError, invalid, type ActionResult } from "@/server/actions/result";
import { notify, pushConfigured } from "@/server/notify/push";

const subscriptionSchema = z.object({
  endpoint: z.url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
  userAgent: z.string().max(300).optional(),
});

export async function saveSubscription(input: z.input<typeof subscriptionSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This phone didn't give a valid notification address. Try again." };
  const v = parsed.data;
  await ctx.supabase.from("push_subscriptions").delete().eq("endpoint", v.endpoint);
  const { error } = await ctx.supabase.from("push_subscriptions").insert({
    household_id: ctx.householdId,
    endpoint: v.endpoint,
    p256dh: v.keys.p256dh,
    auth: v.keys.auth,
    user_agent: v.userAgent ?? null,
  });
  if (error) return dbError(error);
  revalidatePath("/notifications");
  return { ok: true, data: undefined, message: "Notifications are on for this phone" };
}

export async function removeSubscription(endpointOrId: string): Promise<ActionResult> {
  const ctx = await getContext();
  const column = /^[0-9a-f-]{36}$/i.test(endpointOrId) ? "id" : "endpoint";
  const { error } = await ctx.supabase.from("push_subscriptions").delete().eq(column, endpointOrId);
  if (error) return dbError(error);
  revalidatePath("/notifications");
  return { ok: true, data: undefined, message: "Notifications turned off for that device" };
}

export async function sendTestNotification(): Promise<ActionResult> {
  const ctx = await getContext();
  if (!pushConfigured()) return { ok: false, error: "Push isn't set up on the server yet (VAPID keys missing)." };
  const { count } = await ctx.supabase.from("push_subscriptions").select("id", { count: "exact", head: true });
  if (!count) return { ok: false, error: "Turn on notifications on this phone first." };
  await notify(ctx.householdId, [ctx.userId], { category: "test", title: "Ghar Hisaab notifications work", body: "You'll get reminders and alerts like this one.", url: "/notifications", dedupeKey: `test-${Date.now()}` });
  return { ok: true, data: undefined, message: `Test sent to ${count} device${count === 1 ? "" : "s"}` };
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 22:00.");
const prefsSchema = z.object({
  quietStart: time,
  quietEnd: time,
  payments: z.boolean(),
  bills: z.boolean(),
  meters: z.boolean(),
  money: z.boolean(),
  summary: z.boolean(),
  reminders: z.boolean(),
  personal: z.boolean(),
});

export async function savePrefs(input: z.input<typeof prefsSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = prefsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const { error } = await ctx.supabase.from("notification_prefs").upsert({
    user_id: ctx.userId,
    quiet_start: v.quietStart,
    quiet_end: v.quietEnd,
    payments: v.payments,
    bills: v.bills,
    meters: v.meters,
    money: v.money,
    summary: v.summary,
    reminders: v.reminders,
    personal: v.personal,
    updated_at: new Date().toISOString(),
  });
  if (error) return dbError(error);
  revalidatePath("/notifications");
  return { ok: true, data: undefined, message: "Notification settings saved" };
}

export async function markAllRead(): Promise<ActionResult> {
  const ctx = await getContext();
  const { error } = await ctx.supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

const reminderSchema = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(1, "Give the reminder a title.").max(80),
  note: z.string().trim().max(200).optional().default(""),
  date: z.iso.date("Choose the date."),
  time,
  repeat: z.enum(["none", "daily", "weekly", "monthly"]),
  audience: z.enum(["me", "family"]),
});

export async function saveReminder(input: z.input<typeof reminderSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = reminderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const at = karachiInstant(v.date, v.time);
  if (v.repeat === "none" && at.getTime() < Date.now() - 60_000) return { ok: false, error: "That time has already passed. Choose a later time." };
  const row = { title: v.title, note: v.note || null, next_at: at.toISOString(), repeat: v.repeat, audience: v.audience, active: true };
  const { error } = v.id
    ? await ctx.supabase.from("reminders").update(row).eq("id", v.id)
    : await ctx.supabase.from("reminders").insert({ ...row, household_id: ctx.householdId });
  if (error) return dbError(error);
  revalidatePath("/reminders");
  return { ok: true, data: undefined, message: v.id ? "Reminder saved" : "Reminder added" };
}

export async function deleteReminder(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "That reminder couldn't be found." };
  const { data, error } = await ctx.supabase.from("reminders").delete().eq("id", id).select("id");
  if (error) return dbError(error);
  if (!data.length) return { ok: false, error: "You can only delete your own reminders." };
  revalidatePath("/reminders");
  return { ok: true, data: undefined, message: "Reminder deleted" };
}

export async function snoozeReminder(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "That reminder couldn't be found." };
  const { data: r } = await ctx.supabase.from("reminders").select("next_at").eq("id", id).maybeSingle();
  if (!r) return { ok: false, error: "That reminder couldn't be found." };
  const base = Math.max(Date.parse(r.next_at), Date.now());
  const { data, error } = await ctx.supabase.from("reminders").update({ next_at: new Date(base + 86_400_000).toISOString(), active: true }).eq("id", id).select("id");
  if (error) return dbError(error);
  if (!data.length) return { ok: false, error: "You can only change your own reminders." };
  revalidatePath("/reminders");
  return { ok: true, data: undefined, message: "Moved to tomorrow" };
}
