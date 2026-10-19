"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SplitError, exactShares, specToStored } from "@/lib/finance";
import { computeAmountPaisa, splitInputToSpec } from "@/lib/finance/expense-preview";
import { paisaToDecimalString } from "@/lib/finance/money";
import { expenseInputSchema, type ExpenseInputForm } from "@/lib/validation/expense";
import { getContext, isAdmin } from "@/server/auth";
import { getReference } from "@/server/data/ledger";
import { dbError, forbidden, invalid, type ActionResult } from "@/server/actions/result";
import { kickSync } from "@/server/excel/kick";

export async function saveExpense(input: ExpenseInputForm): Promise<ActionResult<{ id: string; version: number }>> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;

  const parsed = expenseInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const ref = await getReference();

  if (!ref.periods.some((p) => p.id === v.periodId)) return { ok: false, error: "That month no longer exists." };
  if (!ref.units.some((u) => u.id === v.paidByUnitId)) return { ok: false, error: "Choose who paid." };

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
    notes: v.notes,
  };

  const { data, error } = await ctx.supabase.rpc("upsert_expense", { p: payload });
  if (error) return dbError(error);
  const row = (data as { id: string; version: number }[])[0];

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
  revalidatePath("/", "layout");
  kickSync();
  return { ok: true, data: { id: data as string }, message: "Month started" };
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
