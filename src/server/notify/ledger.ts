import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSettlement, type Settlement } from "@/lib/finance";
import { toExpenseInput, toPaisa, unitRefs, type ExpenseRow, type Rule, type Section, type Unit } from "@/server/data/ledger";

/** The settlement for one household month, computed with the given (service) client. */
export async function settlementFor(db: SupabaseClient, householdId: string, year: number, month: number): Promise<{ periodId: string; units: Unit[]; settlement: Settlement } | null> {
  const { data: period } = await db.from("periods").select("id").eq("household_id", householdId).eq("year", year).eq("month", month).maybeSingle();
  if (!period) return null;
  const [units, sections, rules, expenses, payments] = await Promise.all([
    db.from("units").select("id, code, name, sort_order, is_purse_holder, active").eq("household_id", householdId).order("sort_order"),
    db.from("expense_sections").select("id, key, title, sort_order").eq("household_id", householdId),
    db.from("split_rules").select("id, name, type, description, is_system, active, parts:split_rule_parts(unit_id, num, den, percent)").eq("household_id", householdId),
    db.from("expenses").select("id, amount, split_rule_id, split_override, section_id").eq("period_id", period.id).is("deleted_at", null),
    db.from("payments").select("payer_unit_id, amount").eq("period_id", period.id).eq("status", "approved"),
  ]);
  for (const r of [units, sections, rules, expenses, payments]) if (r.error) return null;
  const settlement = computeSettlement({
    units: unitRefs(units.data as Unit[]),
    expenses: (expenses.data as unknown as ExpenseRow[]).map((e) => toExpenseInput(e, rules.data as Rule[], sections.data as Section[])),
    payments: (payments.data ?? []).map((p) => ({ unitId: p.payer_unit_id, amountPaisa: toPaisa(p.amount)! })),
  });
  return { periodId: period.id, units: units.data as Unit[], settlement };
}
