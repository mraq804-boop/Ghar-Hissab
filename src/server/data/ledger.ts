import "server-only";
import { cache } from "react";
import {
  computeSettlement,
  overrideToSpec,
  parseRupeesToPaisa,
  ruleToSpec,
  type ExpenseInput,
  type Settlement,
  type SplitSpec,
  type UnitRef,
} from "@/lib/finance";
import { getContext } from "@/server/auth";
import { periodLabel, type Period } from "@/lib/periods";
import type { HistoryItem } from "@/lib/smart/suggest";

export type { Period } from "@/lib/periods";

export type Unit = { id: string; code: string; name: string; sort_order: number; is_purse_holder: boolean; active: boolean };
export type Section = { id: string; key: string; title: string; sort_order: number };
export type Rule = {
  id: string;
  name: string;
  type: "equal_units" | "weights" | "percentage" | "custom_amounts" | "none";
  description: string | null;
  is_system: boolean;
  active: boolean;
  parts: { unit_id: string; num: number | null; den: number | null; percent: number | null }[];
};
export type Category = {
  id: string;
  name: string;
  section_id: string;
  default_split_rule_id: string | null;
  icon: string | null;
  sort_order: number;
  active: boolean;
  kind: "essential" | "variable";
};

export type ExpenseRow = {
  id: string;
  period_id: string;
  section_id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  qty_text: string | null;
  qty_num: string | null;
  rate: string | null;
  amount: string | null;
  split_rule_id: string | null;
  split_override: Parameters<typeof overrideToSpec>[0] | null;
  expense_date: string | null;
  paid_by_unit_id: string | null;
  receipt_path: string | null;
  notes: string | null;
  sort_order: number;
  version: number;
  source: "app" | "import";
  updated_at: string;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  period_id: string;
  payer_unit_id: string;
  payer_member_id: string | null;
  recipient_unit_id: string;
  amount: string;
  paid_on: string;
  method: string;
  reference: string | null;
  related_expense_id: string | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  source: "app" | "import";
  version: number;
  created_at: string;
  updated_at: string;
  submitted_by: string | null;
  payment_attachments: { id: string; storage_path: string; mime_type: string; size_bytes: number; sha256: string }[];
  payment_reviews: { decision: string; reason: string | null; created_at: string; reviewer_id: string | null }[];
};

export const getReference = cache(async () => {
  const ctx = await getContext();
  const db = ctx.supabase;
  const [units, sections, rules, categories, periods] = await Promise.all([
    db.from("units").select("id, code, name, sort_order, is_purse_holder, active").order("sort_order"),
    db.from("expense_sections").select("id, key, title, sort_order").order("sort_order"),
    db.from("split_rules").select("id, name, type, description, is_system, active, parts:split_rule_parts(unit_id, num, den, percent)").order("name"),
    db.from("expense_categories").select("id, name, section_id, default_split_rule_id, icon, sort_order, active, kind").order("sort_order"),
    db.from("periods").select("id, year, month, status, sheet_name").order("year", { ascending: false }).order("month", { ascending: false }),
  ]);
  let categoryRows = categories.data as Category[] | null;
  if (categories.error?.code === "42703") {
    const plain = await db.from("expense_categories").select("id, name, section_id, default_split_rule_id, icon, sort_order, active").order("sort_order");
    if (plain.error) throw plain.error;
    categoryRows = (plain.data as Omit<Category, "kind">[]).map((c) => ({ ...c, kind: /milk|sabzi|vegetable|chicken|meat/i.test(c.name) ? "variable" : "essential" }));
  } else if (categories.error) throw categories.error;
  for (const r of [units, sections, rules, periods]) if (r.error) throw r.error;
  return {
    units: units.data as Unit[],
    sections: sections.data as Section[],
    rules: rules.data as Rule[],
    categories: categoryRows as Category[],
    periods: periods.data as Period[],
  };
});

export function unitRefs(units: Unit[]): UnitRef[] {
  return units.map((u) => ({ id: u.id, code: u.code, sortOrder: u.sort_order }));
}

export function expenseSpec(e: Pick<ExpenseRow, "split_rule_id" | "split_override">, rules: Rule[]): SplitSpec {
  if (e.split_override) return overrideToSpec(e.split_override);
  const rule = rules.find((r) => r.id === e.split_rule_id);
  if (!rule) throw new Error(`Split rule ${e.split_rule_id} not found`);
  return ruleToSpec(rule);
}

export function toPaisa(v: string | number | null): bigint | null {
  return v === null || v === undefined ? null : parseRupeesToPaisa(String(v));
}

export function toExpenseInput(e: ExpenseRow, rules: Rule[], sections: Section[]): ExpenseInput {
  return {
    id: e.id,
    amountPaisa: toPaisa(e.amount),
    split: expenseSpec(e, rules),
    section: sections.find((s) => s.id === e.section_id)?.key,
  };
}

const EXPENSE_COLUMNS =
  "id, period_id, section_id, category_id, title, description, qty_text, qty_num, rate, amount, split_rule_id, split_override, expense_date, paid_by_unit_id, receipt_path, notes, sort_order, version, source, updated_at, created_at";

const PAYMENT_COLUMNS =
  "id, period_id, payer_unit_id, payer_member_id, recipient_unit_id, amount, paid_on, method, reference, related_expense_id, notes, status, source, version, created_at, updated_at, submitted_by, payment_attachments(id, storage_path, mime_type, size_bytes, sha256), payment_reviews(decision, reason, created_at, reviewer_id)";

export async function getExpenses(periodIds: string[]) {
  if (periodIds.length === 0) return [];
  const ctx = await getContext();
  const { data, error } = await ctx.supabase
    .from("expenses")
    .select(EXPENSE_COLUMNS)
    .in("period_id", periodIds)
    .is("deleted_at", null)
    .order("sort_order");
  if (error) throw error;
  return data as unknown as ExpenseRow[];
}

export async function getPayments(
  filter: { periodIds?: string[]; status?: PaymentRow["status"]; unitId?: string; limit?: number } = {},
) {
  const ctx = await getContext();
  let q = ctx.supabase.from("payments").select(PAYMENT_COLUMNS).order("created_at", { ascending: false });
  if (filter.periodIds) q = q.in("period_id", filter.periodIds);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.unitId) q = q.eq("payer_unit_id", filter.unitId);
  if (filter.limit) q = q.limit(filter.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data as unknown as PaymentRow[];
}

/** Expenses from the most recent months, newest first, for suggesting categories and prices. */
export async function getExpenseHistory(periods: Period[], months = 6): Promise<HistoryItem[]> {
  const recent = [...periods].sort((a, b) => b.year - a.year || b.month - a.month).slice(0, months);
  const rows = await getExpenses(recent.map((p) => p.id));
  const order = new Map(recent.map((p, i) => [p.id, i]));
  return rows
    .sort((a, b) => (order.get(a.period_id) ?? 0) - (order.get(b.period_id) ?? 0) || b.updated_at.localeCompare(a.updated_at))
    .map((e) => {
      const p = recent[order.get(e.period_id) ?? 0];
      return {
        title: e.title,
        categoryId: e.category_id,
        sectionId: e.section_id,
        splitRuleId: e.split_rule_id,
        splitOverride: e.split_override as HistoryItem["splitOverride"],
        amount: e.amount,
        rate: e.rate,
        qtyNum: e.qty_num,
        qtyText: e.qty_text,
        periodLabel: periodLabel(p),
      };
    });
}

export type PeriodLedger = {
  period: Period;
  expenses: ExpenseRow[];
  payments: PaymentRow[];
  settlement: Settlement;
};

export async function getPeriodLedgers(periods: Period[]): Promise<PeriodLedger[]> {
  if (periods.length === 0) return [];
  const ref = await getReference();
  const ids = periods.map((p) => p.id);
  const [expenses, payments] = await Promise.all([getExpenses(ids), getPayments({ periodIds: ids })]);
  const units = unitRefs(ref.units);
  return periods.map((period) => {
    const pe = expenses.filter((e) => e.period_id === period.id);
    const pp = payments.filter((p) => p.period_id === period.id);
    const settlement = computeSettlement({
      units,
      expenses: pe.map((e) => toExpenseInput(e, ref.rules, ref.sections)),
      payments: pp
        .filter((p) => p.status === "approved")
        .map((p) => ({ unitId: p.payer_unit_id, amountPaisa: toPaisa(p.amount)! })),
    });
    return { period, expenses: pe, payments: pp, settlement };
  });
}
