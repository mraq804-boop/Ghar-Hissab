"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { daysOfMonth, generateRoster } from "@/lib/kitchen";
import { getContext, isAdmin } from "@/server/auth";
import { dbError, forbidden, invalid, type ActionResult } from "@/server/actions/result";
import { kickSync } from "@/server/excel/kick";

const slotSchema = z.object({
  week: z.number().int().min(1).max(4),
  weekday: z.number().int().min(1).max(7),
  dish: z.string().trim().max(80),
});

export async function saveDish(input: z.input<typeof slotSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const p = slotSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { data: existing } = await ctx.supabase
    .from("meal_slots")
    .select("fixed_category")
    .eq("household_id", ctx.householdId)
    .eq("weekday", p.data.weekday)
    .eq("week", 1)
    .maybeSingle();
  const { error } = await ctx.supabase.from("meal_slots").upsert(
    { household_id: ctx.householdId, week: p.data.week, weekday: p.data.weekday, dish: p.data.dish, fixed_category: existing?.fixed_category ?? "" },
    { onConflict: "household_id,week,weekday" },
  );
  if (error) return dbError(error);
  revalidatePath("/kitchen");
  kickSync();
  return { ok: true, data: undefined, message: "Menu updated" };
}

const categorySchema = z.object({ weekday: z.number().int().min(1).max(7), category: z.string().trim().max(60) });

export async function saveDayCategory(input: z.input<typeof categorySchema>): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const p = categorySchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { data: rows } = await ctx.supabase.from("meal_slots").select("week, dish").eq("household_id", ctx.householdId).eq("weekday", p.data.weekday);
  const upserts = [1, 2, 3, 4].map((week) => ({
    household_id: ctx.householdId,
    week,
    weekday: p.data.weekday,
    fixed_category: p.data.category,
    dish: rows?.find((r) => r.week === week)?.dish ?? "",
  }));
  const { error } = await ctx.supabase.from("meal_slots").upsert(upserts, { onConflict: "household_id,week,weekday" });
  if (error) return dbError(error);
  revalidatePath("/kitchen");
  kickSync();
  return { ok: true, data: undefined, message: "Category updated" };
}

export async function addSabzi(name: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const n = z.string().trim().min(1, "Enter a vegetable").max(40).safeParse(name);
  if (!n.success) return invalid(n.error);
  const { count } = await ctx.supabase.from("sabzi_options").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= 24) return { ok: false, error: "The workbook has room for 24 sabzi options. Remove one first." };
  const { error } = await ctx.supabase.from("sabzi_options").insert({ household_id: ctx.householdId, name: n.data, sort_order: (count ?? 0) + 1 });
  if (error) return dbError(error);
  revalidatePath("/kitchen");
  kickSync();
  return { ok: true, data: undefined, message: `${n.data} added` };
}

export async function removeSabzi(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx) || !z.uuid().safeParse(id).success) return forbidden;
  const { error } = await ctx.supabase.from("sabzi_options").delete().eq("id", id);
  if (error) return dbError(error);
  revalidatePath("/kitchen");
  kickSync();
  return { ok: true, data: undefined, message: "Removed" };
}

const dutySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  breakfast: z.uuid().nullable(),
  lunch: z.uuid().nullable(),
  dinner: z.uuid().nullable(),
  off: z.uuid().nullable(),
  offNote: z.string().trim().max(40).optional().default(""),
});

export async function saveDutyDay(input: z.input<typeof dutySchema>): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const p = dutySchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await ctx.supabase.from("duty_days").upsert(
    {
      household_id: ctx.householdId,
      day: p.data.day,
      breakfast_member_id: p.data.breakfast,
      lunch_member_id: p.data.lunch,
      dinner_member_id: p.data.dinner,
      off_member_id: p.data.off,
      off_note: p.data.offNote || null,
    },
    { onConflict: "household_id,day" },
  );
  if (error) return dbError(error);
  revalidatePath("/kitchen");
  kickSync();
  return { ok: true, data: undefined, message: "Duty saved" };
}

const fillSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  people: z.array(z.uuid()).min(1, "Choose who cooks").max(6),
  awayMember: z.uuid().nullable().optional(),
  awayUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  overwrite: z.boolean().default(false),
});

export async function fillRoster(input: z.input<typeof fillSchema>): Promise<ActionResult<{ days: number }>> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const p = fillSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  const days = daysOfMonth(v.year, v.month);
  const { data: existing } = await ctx.supabase.from("duty_days").select("day").gte("day", days[0]).lte("day", days[days.length - 1]);
  if (existing?.length && !v.overwrite) return { ok: false, error: "This month already has duties. Choose to replace them." };

  const plan = generateRoster(v.people, days, (d) => (v.awayMember && v.awayUntil && d <= v.awayUntil ? [v.awayMember] : []));
  const rows = plan.map((d) => ({
    household_id: ctx.householdId,
    day: d.day,
    breakfast_member_id: d.breakfast,
    lunch_member_id: d.lunch,
    dinner_member_id: d.dinner,
    off_member_id: d.off,
    off_note: v.awayMember && d.off === v.awayMember && v.awayUntil && d.day <= v.awayUntil ? "on holiday" : null,
  }));
  const { error } = await ctx.supabase.from("duty_days").upsert(rows, { onConflict: "household_id,day" });
  if (error) return dbError(error);
  revalidatePath("/kitchen");
  kickSync();
  return { ok: true, data: { days: rows.length }, message: `Roster filled for ${rows.length} days` };
}
