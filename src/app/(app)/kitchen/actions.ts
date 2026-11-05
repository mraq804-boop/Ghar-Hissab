"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { daysOfMonth, generateRoster } from "@/lib/kitchen";
import { MONTHS_LONG } from "@/lib/periods";
import { SHOPPING_GROUPS, formatKg, shoppingCategory } from "@/lib/shopping";
import { moneyString } from "@/lib/validation/expense";
import { getContext, isAdmin } from "@/server/auth";
import { getReference } from "@/server/data/ledger";
import { dbError, forbidden, invalid, type ActionResult } from "@/server/actions/result";
import { kickSync } from "@/server/excel/kick";

const shoppingSchema = z.object({
  date: z.iso.date("Choose the shopping date."),
  items: z
    .array(
      z.object({
        group: z.enum(SHOPPING_GROUPS),
        item: z.string().trim().min(1).max(80),
        kg: z.number().positive().max(1000),
        amount: moneyString,
      }),
    )
    .min(1, "Enter the price of at least one item.")
    .max(30),
});

export async function addShoppingToExpenses(input: z.input<typeof shoppingSchema>): Promise<ActionResult<{ count: number }>> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const p = shoppingSchema.safeParse(input);
  if (!p.success) return invalid(p.error);

  const ref = await getReference();
  const [year, month] = p.data.date.split("-").map(Number);
  const period = ref.periods.find((x) => x.year === year && x.month === month);
  if (!period) return { ok: false, error: `Start ${MONTHS_LONG[month - 1]} ${year} in Expenses first.` };
  if (period.status === "closed") return { ok: false, error: `${MONTHS_LONG[month - 1]} ${year} is closed. Reopen it first.` };
  const purse = ref.units.find((u) => u.is_purse_holder) ?? ref.units[0];

  const payloads = [];
  for (const it of p.data.items) {
    const category = shoppingCategory(it.group, ref.categories);
    if (!category) return { ok: false, error: `There is no ${it.group === "Sabzi" ? "vegetables" : "chicken & meat"} category in Expenses.` };
    if (!category.default_split_rule_id) return { ok: false, error: `"${category.name}" has no default split. Add one expense in it by hand first.` };
    payloads.push({
      household_id: ctx.householdId,
      period_id: period.id,
      section_id: category.section_id,
      category_id: category.id,
      title: it.item,
      description: "",
      qty_text: formatKg(it.kg),
      qty_num: "",
      rate: "",
      amount: it.amount,
      split_rule_id: category.default_split_rule_id,
      split_override: null,
      expense_date: p.data.date,
      paid_by_unit_id: purse.id,
      notes: "Weekly shopping list",
    });
  }

  let count = 0;
  for (const payload of payloads) {
    const { error } = await ctx.supabase.rpc("upsert_expense", { p: payload });
    if (error) {
      if (count) revalidatePath("/", "layout");
      const r = dbError(error);
      return count && !r.ok ? { ...r, error: `${count} added, then: ${r.error}` } : r;
    }
    count++;
  }

  revalidatePath("/", "layout");
  kickSync();
  return { ok: true, data: { count }, message: `${count} item${count === 1 ? "" : "s"} added to ${MONTHS_LONG[month - 1]} expenses` };
}

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
