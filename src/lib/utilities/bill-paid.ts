export type BillExpense = { expense_date: string | null; receipt_path: string | null; deleted_at: string | null } | null;

/** A bill counts as paid once its expense has the paid bill attached or the date it was paid. */
export function billPaid(e: BillExpense): boolean {
  return !!e && !e.deleted_at && (!!e.receipt_path || !!e.expense_date);
}
