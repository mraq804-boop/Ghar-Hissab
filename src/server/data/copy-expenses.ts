import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpenseRow } from "./ledger";

/**
 * Adds copies of earlier expenses to a month: same item, quantity, rate, amount and sharing;
 * no date, receipt or notes; paid from the purse (so no contribution payment is created).
 * Stops at the first failure and reports how many went in before it.
 */
export async function insertCopies(db: SupabaseClient, householdId: string, toPeriodId: string, rows: ExpenseRow[]) {
  let count = 0;
  for (const e of rows) {
    const { error } = await db.rpc("upsert_expense", {
      p: {
        household_id: householdId,
        period_id: toPeriodId,
        section_id: e.section_id,
        category_id: e.category_id,
        title: e.title,
        description: e.description ?? "",
        qty_text: e.qty_text ?? "",
        qty_num: e.qty_num ?? "",
        rate: e.rate ?? "",
        amount: e.amount ?? "",
        split_rule_id: e.split_rule_id,
        split_override: e.split_override,
        expense_date: "",
        paid_by_unit_id: null,
        notes: "",
      },
    });
    if (error) return { count, failed: { title: e.title, error } };
    count++;
  }
  return { count, failed: null };
}
