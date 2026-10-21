import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverAfter } from "@/lib/notify/rules";
import { createSupabaseAdmin } from "@/server/supabase/admin";

export type Category = "payments" | "bills" | "meters" | "money" | "summary" | "reminders" | "personal" | "test";
export type Message = { category: Category; title: string; body?: string; url?: string; dedupeKey: string };

type Prefs = { user_id: string; quiet_start: string; quiet_end: string } & Partial<Record<Exclude<Category, "test">, boolean>>;

export function pushConfigured() {
  const e = process.env;
  return Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY && e.VAPID_SUBJECT);
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

let configured = false;
function configure() {
  if (configured || !pushConfigured()) return configured;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
  return true;
}

/**
 * Records a notification for each person (once per dedupe key) and rings their devices,
 * unless they turned that kind off or it's their quiet hours, in which case it waits.
 */
export async function notify(householdId: string, userIds: string[], message: Message, db: SupabaseClient = createSupabaseAdmin()) {
  const users = [...new Set(userIds)];
  if (!users.length) return { created: 0 };
  const { data: prefRows } = await db.from("notification_prefs").select("*").in("user_id", users);
  const prefs = new Map((prefRows as Prefs[] | null ?? []).map((p) => [p.user_id, p]));
  const now = new Date();

  const rows = users.flatMap((userId) => {
    const p = prefs.get(userId);
    if (message.category !== "test" && p && p[message.category] === false) return [];
    const after = message.category === "test" ? now : deliverAfter(now, p?.quiet_start?.slice(0, 5) ?? "22:00", p?.quiet_end?.slice(0, 5) ?? "08:00");
    return [
      {
        household_id: householdId,
        user_id: userId,
        category: message.category,
        title: message.title.slice(0, 120),
        body: message.body?.slice(0, 300) ?? null,
        url: message.url ?? "/dashboard",
        dedupe_key: message.dedupeKey,
        deliver_after: after.toISOString(),
      },
    ];
  });
  if (!rows.length) return { created: 0 };
  const { data: created, error } = await db
    .from("notifications")
    .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("Notification insert failed", error.message);
    return { created: 0 };
  }
  await deliverDue(db, created?.map((c) => c.id));
  return { created: created?.length ?? 0 };
}

/** Rings devices for notifications whose time has come (all due ones, or just the given ids). */
export async function deliverDue(db: SupabaseClient = createSupabaseAdmin(), ids?: string[]) {
  if (ids && !ids.length) return { sent: 0 };
  let q = db.from("notifications").select("id, user_id, category, title, body, url").is("sent_at", null).lte("deliver_after", new Date().toISOString()).limit(200);
  if (ids) q = q.in("id", ids);
  const { data: due } = await q;
  if (!due?.length) return { sent: 0 };

  const canPush = configure();
  const { data: subs } = canPush
    ? await db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth, failures").in("user_id", [...new Set(due.map((d) => d.user_id))])
    : { data: [] as { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; failures: number }[] };

  let sent = 0;
  for (const n of due) {
    const payload = JSON.stringify({ title: n.title, body: n.body ?? "", url: n.url ?? "/dashboard", tag: `${n.category}-${n.id}` });
    for (const s of (subs ?? []).filter((x) => x.user_id === n.user_id)) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 12 * 3600, urgency: "normal" });
        sent++;
        await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString(), failures: 0 }).eq("id", s.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410 || s.failures >= 5) await db.from("push_subscriptions").delete().eq("id", s.id);
        else await db.from("push_subscriptions").update({ failures: s.failures + 1 }).eq("id", s.id);
      }
    }
    await db.from("notifications").update({ sent_at: new Date().toISOString() }).eq("id", n.id);
  }
  return { sent };
}
