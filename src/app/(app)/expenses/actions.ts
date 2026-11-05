"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SplitError, exactShares, specToStored } from "@/lib/finance";
import { computeAmountPaisa, splitInputToSpec } from "@/lib/finance/expense-preview";
import { formatPaisa, paisaToDecimalString } from "@/lib/finance/money";
import { expenseInputSchema, type ExpenseInputForm } from "@/lib/validation/expense";
import { getContext, isAdmin } from "@/server/auth";
import { getExpenses, getReference, toPaisa } from "@/server/data/ledger";
import { insertCopies } from "@/server/data/copy-expenses";
import { dailyFoodToCarry } from "@/lib/expenses/copy";
import { dbError, forbidden, invalid, type ActionResult } from "@/server/actions/result";
import { kickSync } from "@/server/excel/kick";
import { createSupabaseAdmin } from "@/server/supabase/admin";

export async function saveExpense(input: ExpenseInputForm): Promise<ActionResult<{ id: string; version: number }>> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;

  const parsed = expenseInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const ref = await getReference();

  if (!ref.periods.some((p) => p.id === v.periodId)) return { ok: false, error: "That month no longer exists." };
  if (!ref.units.some((u) => u.id === v.paidByUnitId)) return { ok: false, error: "Choose who paid." };
  if (v.receiptPath && !new RegExp(`^${ctx.householdId}/expenses/[0-9a-f-]{36}\\.(jpg|png|webp|pdf)$`).test(v.receiptPath)) {
    return { ok: false, error: "That bill upload isn't valid. Attach it again." };
  }
  const oldReceipt =
    v.id && v.receiptPath ? (await ctx.supabase.from("expenses").select("receipt_path").eq("id", v.id).maybeSingle()).data?.receipt_path ?? null : null;

  let amountPaisa: bigint | null;
  let override: ReturnType<typeof specToStored> | null = null;
  try {
    amountPaisa = computeAmountPaisa(v.pricing, v.amount, v.qty, v.rate);
    const spec = splitInputToSpec(v.split, ref.rules);
    if (amountPaisa !== null) exactShares({ id: "check", amountPaisa, split: spec });
    if (v.split.type !== "rule") override = specToStored(spec);
  } catch (e) {
    if (e instanceof SplitError) return { ok: false, error: e.message, fieldErrors: { split: [e.message] } };
    throw e;
  }

  const payload = {
    id: v.id,
    expected_version: v.expectedVersion,
    household_id: ctx.householdId,
    period_id: v.periodId,
    section_id: v.sectionId,
    category_id: v.categoryId,
    title: v.title,
    description: v.description,
    qty_text: v.qtyText,
    qty_num: v.pricing === "rate" ? v.qty : "",
    rate: v.pricing === "rate" ? v.rate.replace(/,/g, "") : "",
    amount: amountPaisa === null ? "" : paisaToDecimalString(amountPaisa),
    split_rule_id: v.split.type === "rule" ? v.split.ruleId : null,
    split_override: override,
    expense_date: v.expenseDate,
    paid_by_unit_id: v.paidByUnitId,
    paid_from_own: v.paidFromOwn,
    receipt_path: v.receiptPath,
    notes: v.notes,
  };

  const { data, error } = await ctx.supabase.rpc("upsert_expense", { p: payload });
  if (error) return dbError(error);
  const row = (data as { id: string; version: number }[])[0];
  if (oldReceipt && oldReceipt !== v.receiptPath && oldReceipt.startsWith(`${ctx.householdId}/`)) {
    await createSupabaseAdmin().storage.from("receipts").remove([oldReceipt]);
  }

  revalidatePath("/", "layout");
  kickSync();
  return { ok: true, data: row, message: v.id ? "Expense updated" : "Expense added" };
}

const deleteSchema = z.object({ id: z.uuid(), version: z.number().int().positive() });

export async function deleteExpense(input: z.input<typeof deleteSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { error } = await ctx.supabase.rpc("delete_expense", { expense_id: parsed.data.id, expected_version: parsed.data.version });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  kickSync();
  return { ok: true, data: undefined, message: "Expense deleted" };
}

const periodSchema = z.object({ year: z.number().int().min(2020).max(2100), month: z.number().int().min(1).max(12) });

export async function startPeriod(input: z.input<typeof periodSchema>): Promise<ActionResult<{ id: string }>> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const parsed = periodSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { data, error } = await ctx.supabase.rpc("ensure_period", { h: ctx.householdId, y: parsed.data.year, m: parsed.data.month });
  if (error) return dbError(error);
  const carried = await carryDailyFood(data as string, parsed.data.year, parsed.data.month);
  revalidatePath("/", "layout");
  kickSync();
  return { ok: true, data: { id: data as string }, message: carried ? `Month started. ${carried} added from last month.` : "Month started" };
}

/** Puts last month's daily food (milk, sabzi, chicken & meat) into a new month at the same kg and rate. */
async function carryDailyFood(periodId: string, year: number, month: number) {
  const ctx = await getContext();
  const ref = await getReference();
  const previous = ref.periods
    .filter((p) => p.year * 12 + p.month < year * 12 + month)
    .sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month))[0];
  const target = ref.periods.find((p) => p.id === periodId);
  if (!previous || target?.status === "closed") return null;
  const dailyFood = new Set(ref.categories.filter((c) => c.kind === "variable").map((c) => c.id));
  const [source, existing] = await Promise.all([getExpenses([previous.id]), getExpenses([periodId])]);
  const sectionOrder = (id: string) => ref.sections.findIndex((s) => s.id === id);
  const rows = dailyFoodToCarry(
    source.map((e) => ({ ...e, categoryId: e.category_id })),
    existing.map((e) => ({ title: e.title, categoryId: e.category_id })),
    dailyFood,
  ).sort((a, b) => sectionOrder(a.section_id) - sectionOrder(b.section_id) || a.sort_order - b.sort_order);
  if (!rows.length) return null;
  const { count } = await insertCopies(ctx.supabase, ctx.householdId, periodId, rows);
  if (!count) return null;
  const total = rows.slice(0, count).reduce((a, e) => a + (toPaisa(e.amount) ?? 0n), 0n);
  return `${count} daily food item${count === 1 ? "" : "s"} (${formatPaisa(total)})`;
}

const statusSchema = z.object({ periodId: z.uuid(), status: z.enum(["open", "closed"]) });

export async function setPeriodStatus(input: z.input<typeof statusSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { error } = await ctx.supabase.rpc("set_period_status", { period_id: parsed.data.periodId, new_status: parsed.data.status });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: parsed.data.status === "closed" ? "Month closed" : "Month reopened" };
}

export async function expenseReceiptUrl(expenseId: string): Promise<ActionResult<{ url: string }>> {
  const ctx = await getContext();
  if (!z.uuid().safeParse(expenseId).success) return forbidden;
  const { data: row } = await ctx.supabase.from("expenses").select("receipt_path").eq("id", expenseId).maybeSingle();
  if (!row?.receipt_path) return { ok: false, error: "No bill is attached, or you don't have access to it." };
  const { data, error } = await ctx.supabase.storage.from("receipts").createSignedUrl(row.receipt_path, 120);
  if (error || !data) return { ok: false, error: "The bill couldn't be opened. Try again." };
  return { ok: true, data: { url: data.signedUrl } };
}
