import "server-only";
import { getContext } from "@/server/auth";
import { toPaisa } from "@/server/data/ledger";

export type AbbuEntry = { id: string; kind: "paid" | "returned"; amountPaisa: bigint; onDate: string; note: string | null; fromExpense: boolean };

export async function getAbbuMoney() {
  const ctx = await getContext();
  const { data, error } = await ctx.supabase
    .from("abbu_money")
    .select("id, kind, amount, on_date, note, expense_id")
    .eq("household_id", ctx.householdId)
    .order("on_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    throw error;
  }
  const entries: AbbuEntry[] = (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind as AbbuEntry["kind"],
    amountPaisa: toPaisa(r.amount) ?? 0n,
    onDate: r.on_date,
    note: r.note,
    fromExpense: Boolean(r.expense_id),
  }));
  const paid = entries.filter((e) => e.kind === "paid").reduce((a, e) => a + e.amountPaisa, 0n);
  const returned = entries.filter((e) => e.kind === "returned").reduce((a, e) => a + e.amountPaisa, 0n);
  return { entries, paidPaisa: paid, returnedPaisa: returned, owedPaisa: paid - returned };
}

export async function abbuExpenseIds(expenseIds: string[]) {
  if (!expenseIds.length) return new Set<string>();
  const ctx = await getContext();
  const { data, error } = await ctx.supabase.from("abbu_money").select("expense_id").in("expense_id", expenseIds);
  if (error) return new Set<string>();
  return new Set((data ?? []).map((r) => r.expense_id as string));
}

export async function syncAbbuForExpense(expenseId: string, entry: { amount: string; onDate: string; note: string } | null) {
  const ctx = await getContext();
  if (!entry || !entry.amount || Number(entry.amount) <= 0) {
    return ctx.supabase.from("abbu_money").delete().eq("expense_id", expenseId);
  }
  return ctx.supabase.from("abbu_money").upsert(
    { household_id: ctx.householdId, kind: "paid", amount: entry.amount, on_date: entry.onDate, note: entry.note.slice(0, 200), expense_id: expenseId },
    { onConflict: "expense_id" },
  );
}
