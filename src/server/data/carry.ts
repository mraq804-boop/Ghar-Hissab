import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chainSettlements, type Paisa } from "@/lib/finance";
import { toExpenseInput, toPaisa, unitRefs, type ExpenseRow, type Rule, type Section, type Unit } from "./ledger";

/**
 * Each household's closing balance at the end of the month before (year, month), for code that settles
 * a single month with its own client (scheduled notifications, the sheet sync). Empty for the first month.
 */
export async function broughtForwardFor(db: SupabaseClient, householdId: string, year: number, month: number): Promise<Map<string, Paisa>> {
  const { data: periods } = await db.from("periods").select("id, year, month").eq("household_id", householdId);
  const before = (periods ?? []).filter((p) => p.year * 12 + p.month < year * 12 + month).sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  if (!before.length) return new Map();
  const ids = before.map((p) => p.id);
  const [units, sections, rules, expenses, payments] = await Promise.all([
    db.from("units").select("id, code, name, sort_order, is_purse_holder, active").eq("household_id", householdId).order("sort_order"),
    db.from("expense_sections").select("id, key, title, sort_order").eq("household_id", householdId),
    db.from("split_rules").select("id, name, type, description, is_system, active, parts:split_rule_parts(unit_id, num, den, percent)").eq("household_id", householdId),
    db.from("expenses").select("id, period_id, amount, split_rule_id, split_override, section_id").in("period_id", ids).is("deleted_at", null),
    db.from("payments").select("period_id, payer_unit_id, amount").in("period_id", ids).eq("status", "approved"),
  ]);
  for (const r of [units, sections, rules, expenses, payments]) if (r.error) throw r.error;
  const chain = chainSettlements(
    unitRefs(units.data as Unit[]),
    before.map((p) => ({
      key: p.id,
      expenses: (expenses.data as unknown as ExpenseRow[]).filter((e) => e.period_id === p.id).map((e) => toExpenseInput(e, rules.data as Rule[], sections.data as Section[])),
      payments: (payments.data ?? []).filter((x) => x.period_id === p.id).map((x) => ({ unitId: x.payer_unit_id, amountPaisa: toPaisa(x.amount)! })),
    })),
  );
  const last = chain.get(before[before.length - 1].id)!;
  return new Map(last.units.map((u) => [u.unitId, u.balancePaisa]));
}
