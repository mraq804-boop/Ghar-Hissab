import "server-only";
import { DEFAULT_PERSONAL_CATEGORIES } from "@/lib/personal/budget";
import { parseRupeesToPaisa } from "@/lib/finance/money";
import { MONTHS_LONG } from "@/lib/periods";
import type { Report } from "@/server/reports";
import { getContext } from "@/server/auth";

export type PersonalCategory = { id: string; name: string; sort_order: number; active: boolean };
export type PersonalExpense = {
  id: string;
  category_id: string | null;
  amount: string;
  spent_on: string;
  note: string | null;
  receipt_path: string | null;
  receipt_mime: string | null;
};
export type PersonalBudget = { id: string; category_id: string | null; amount: string };

export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

export function previousMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Categories for the signed-in person, creating the defaults the first time. */
export async function getPersonalCategories(): Promise<PersonalCategory[]> {
  const ctx = await getContext();
  const db = ctx.supabase;
  const { data, error } = await db.from("personal_categories").select("id, name, sort_order, active").order("sort_order").order("name");
  if (error) throw error;
  if (data.length) return data;
  const seeded = await db
    .from("personal_categories")
    .insert(DEFAULT_PERSONAL_CATEGORIES.map((name, i) => ({ name, sort_order: i })))
    .select("id, name, sort_order, active");
  if (seeded.error) throw seeded.error;
  return seeded.data.sort((a, b) => a.sort_order - b.sort_order);
}

/** Everything for one month of the signed-in person's own spending. Reads only their rows (RLS). */
export async function getPersonalMonth(month: string) {
  const ctx = await getContext();
  const db = ctx.supabase;
  const { from, to } = monthRange(month);
  const prev = monthRange(previousMonth(month));
  const [categories, current, last, budgets, history] = await Promise.all([
    getPersonalCategories(),
    db.from("personal_expenses").select("id, category_id, amount, spent_on, note, receipt_path, receipt_mime").gte("spent_on", from).lt("spent_on", to).order("spent_on", { ascending: false }).order("created_at", { ascending: false }),
    db.from("personal_expenses").select("category_id, amount").gte("spent_on", prev.from).lt("spent_on", prev.to),
    db.from("personal_budgets").select("id, category_id, amount"),
    db.from("personal_expenses").select("note, category_id").not("note", "is", null).order("created_at", { ascending: false }).limit(100),
  ]);
  for (const r of [current, last, budgets, history]) if (r.error) throw r.error;
  return {
    categories,
    expenses: current.data as PersonalExpense[],
    lastMonth: last.data as { category_id: string | null; amount: string }[],
    budgets: budgets.data as PersonalBudget[],
    history: (history.data as { note: string | null; category_id: string | null }[]).map((h) => ({
      note: h.note,
      categoryName: categories.find((c) => c.id === h.category_id)?.name ?? null,
    })),
  };
}

/** The person's own spending between two months (inclusive), for export and chat. */
export async function getPersonalRange(fromMonth: string, toMonth: string) {
  const ctx = await getContext();
  const categories = await getPersonalCategories();
  const { data, error } = await ctx.supabase
    .from("personal_expenses")
    .select("id, category_id, amount, spent_on, note")
    .gte("spent_on", monthRange(fromMonth).from)
    .lt("spent_on", monthRange(toMonth).to)
    .order("spent_on");
  if (error) throw error;
  return (data as Omit<PersonalExpense, "receipt_path" | "receipt_mime">[]).map((e) => ({
    ...e,
    categoryName: categories.find((c) => c.id === e.category_id)?.name ?? "Uncategorised",
  }));
}

/** The person's own month as a report for the Excel and PDF exporters. */
export async function personalReport(month: string): Promise<Report> {
  const rows = await getPersonalRange(month, month);
  const total = rows.reduce((a, r) => a + parseRupeesToPaisa(r.amount), 0n);
  const [y, m] = month.split("-").map(Number);
  return {
    type: "expenses",
    title: "My spending",
    subtitle: `${MONTHS_LONG[m - 1]} ${y} · private to you`,
    columns: [
      { key: "date", label: "Date", kind: "date" },
      { key: "category", label: "Category", kind: "text" },
      { key: "note", label: "Note", kind: "text" },
      { key: "amount", label: "Amount", kind: "money" },
    ],
    rows: rows.map((r) => ({ date: r.spent_on, category: r.categoryName, note: r.note ?? "", amount: parseRupeesToPaisa(r.amount) })),
    totals: { date: null, category: "Total", note: "", amount: total },
    generatedAt: new Date().toISOString(),
  };
}
