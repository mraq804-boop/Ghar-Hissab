"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseRupeesToPaisa, paisaToDecimalString } from "@/lib/finance/money";
import { fromLastMonth, rollForward, type PlanItem } from "@/lib/personal/plan";
import { getContext } from "@/server/auth";
import { dbError, invalid, type ActionResult } from "@/server/actions/result";
import { monthRange, previousMonth } from "@/server/data/personal";
import { onPersonalSpending } from "@/server/notify/events";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month.");
const amount = z
  .string()
  .trim()
  .transform((s) => s.replace(/,/g, ""))
  .refine((s) => /^\d+(\.\d{1,2})?$/.test(s) && Number(s) > 0, "Enter an amount in rupees.")
  .transform((s) => paisaToDecimalString(parseRupeesToPaisa(s)));

const itemSchema = z
  .object({
    id: z.uuid().optional(),
    month,
    title: z.string().trim().min(1, "Give the item a name.").max(80),
    categoryId: z.uuid().nullable(),
    estimate: amount,
    dueDate: z.union([z.literal(""), z.iso.date()]).optional().default(""),
    repeatMonthly: z.boolean().optional().default(false),
  })
  .refine((v) => !v.dueDate || v.dueDate.startsWith(v.month), { message: "The date must be in the same month.", path: ["dueDate"] });

const done = (message: string): ActionResult => {
  revalidatePath("/me");
  return { ok: true, data: undefined, message };
};

export async function savePlanItem(input: z.input<typeof itemSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const row = { month: `${v.month}-01`, title: v.title, category_id: v.categoryId, estimate: v.estimate, due_date: v.dueDate || null, repeat_monthly: v.repeatMonthly, reminded_at: null };
  const { error } = v.id ? await ctx.supabase.from("personal_plan_items").update(row).eq("id", v.id) : await ctx.supabase.from("personal_plan_items").insert(row);
  if (error) return dbError(error);
  return done(v.id ? "Saved" : `Added ${v.title}`);
}

export async function deletePlanItem(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "That item couldn't be found." };
  const { data, error } = await ctx.supabase.from("personal_plan_items").delete().eq("id", id).select("id");
  if (error) return dbError(error);
  if (!data.length) return { ok: false, error: "That item couldn't be found." };
  return done("Removed from the plan");
}

export async function setPlanStatus(id: string, status: "planned" | "skipped"): Promise<ActionResult> {
  const ctx = await getContext();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "That item couldn't be found." };
  const { data, error } = await ctx.supabase.from("personal_plan_items").update({ status, ...(status === "planned" ? { expense_id: null } : {}) }).eq("id", id).select("id");
  if (error) return dbError(error);
  if (!data.length) return { ok: false, error: "That item couldn't be found." };
  return done(status === "skipped" ? "Skipped" : "Back on the list");
}

const boughtSchema = z.object({
  id: z.uuid(),
  amount,
  spentOn: z.iso.date("Choose the date."),
  note: z.string().trim().max(200).optional().default(""),
  receiptPath: z.string().max(200).nullable().optional(),
  receiptMime: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]).nullable().optional(),
});

/** Ticks an item off: records the real spending entry and links it to the plan. */
export async function markBought(input: z.input<typeof boughtSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = boughtSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  if (v.receiptPath && !v.receiptPath.startsWith(`${ctx.userId}/`)) return { ok: false, error: "That receipt upload isn't valid. Upload it again." };

  const { data: item } = await ctx.supabase.from("personal_plan_items").select("id, title, category_id, status").eq("id", v.id).maybeSingle();
  if (!item) return { ok: false, error: "That item couldn't be found." };
  if (item.status === "bought") return { ok: false, error: "That item is already marked as bought." };

  const { data: expense, error } = await ctx.supabase
    .from("personal_expenses")
    .insert({ category_id: item.category_id, amount: v.amount, spent_on: v.spentOn, note: v.note || item.title, receipt_path: v.receiptPath ?? null, receipt_mime: v.receiptPath ? (v.receiptMime ?? null) : null })
    .select("id")
    .single();
  if (error) return dbError(error);
  const link = await ctx.supabase.from("personal_plan_items").update({ status: "bought", expense_id: expense.id }).eq("id", v.id);
  if (link.error) return dbError(link.error);
  onPersonalSpending(ctx.userId, ctx.householdId, v.spentOn);
  return done(`${item.title} bought for Rs ${Number(v.amount).toLocaleString("en-US")}`);
}

type Row = { id: string; title: string; category_id: string | null; estimate: string; due_date: string | null; repeat_monthly: boolean; status: PlanItem["status"]; personal_expenses: { amount: string } | null };
const toItem = (r: Row): PlanItem => ({
  id: r.id,
  title: r.title,
  categoryId: r.category_id,
  estimate: Number(r.estimate),
  dueDate: r.due_date,
  repeatMonthly: r.repeat_monthly,
  status: r.status,
  actual: r.personal_expenses ? Number(r.personal_expenses.amount) : null,
});

async function monthItems(m: string) {
  const ctx = await getContext();
  const { data, error } = await ctx.supabase
    .from("personal_plan_items")
    .select("id, title, category_id, estimate, due_date, repeat_monthly, status, personal_expenses(amount)")
    .eq("month", `${m}-01`);
  if (error) throw error;
  return (data as unknown as Row[]).map(toItem);
}

async function insertItems(m: string, items: { title: string; categoryId: string | null; estimate: number; dueDate: string | null; repeatMonthly: boolean }[]) {
  if (!items.length) return null;
  const ctx = await getContext();
  return ctx.supabase.from("personal_plan_items").insert(
    items.map((i, n) => ({ month: `${m}-01`, title: i.title.slice(0, 80), category_id: i.categoryId, estimate: i.estimate.toFixed(2), due_date: i.dueDate, repeat_monthly: i.repeatMonthly, sort_order: n })),
  );
}

export async function carryRepeating(m: string): Promise<ActionResult> {
  if (!month.safeParse(m).success) return { ok: false, error: "Choose a month." };
  const [previous, existing] = await Promise.all([monthItems(previousMonth(m)), monthItems(m)]);
  const add = rollForward(previous, existing, m);
  if (!add.length) return { ok: false, error: "No repeating items from last month to bring over." };
  const r = await insertItems(m, add);
  if (r?.error) return dbError(r.error);
  return done(`Brought over ${add.length} repeating item${add.length === 1 ? "" : "s"}`);
}

export async function copyFromLastMonth(m: string): Promise<ActionResult> {
  if (!month.safeParse(m).success) return { ok: false, error: "Choose a month." };
  const ctx = await getContext();
  const prev = monthRange(previousMonth(m));
  const [{ data: spent, error }, { data: cats }, existing] = await Promise.all([
    ctx.supabase.from("personal_expenses").select("category_id, amount").gte("spent_on", prev.from).lt("spent_on", prev.to),
    ctx.supabase.from("personal_categories").select("id, name"),
    monthItems(m),
  ]);
  if (error) return dbError(error);
  const add = fromLastMonth((spent ?? []).map((s) => ({ categoryId: s.category_id, amount: Number(s.amount) })), cats ?? [], existing);
  if (!add.length) return { ok: false, error: "Nothing new to copy: last month has no spending that isn't already on this list." };
  const r = await insertItems(m, add);
  if (r?.error) return dbError(r.error);
  return done(`Added ${add.length} item${add.length === 1 ? "" : "s"} from last month's spending. Adjust the amounts as needed.`);
}
