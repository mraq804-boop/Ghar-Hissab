export type PlanItem = {
  id: string;
  title: string;
  categoryId: string | null;
  estimate: number;
  dueDate: string | null;
  repeatMonthly: boolean;
  status: "planned" | "bought" | "skipped";
  actual: number | null;
};

export type PlanSummary = {
  planned: number;
  bought: number;
  boughtEstimate: number;
  remaining: number;
  toBuy: number;
  count: number;
  budget: number | null;
  overBudgetBy: number | null;
};

/**
 * Totals for a month's plan. `planned` counts what's still to buy at its estimate plus what's bought at
 * its actual amount, so it moves as real prices come in. Skipped items don't count.
 */
export function planSummary(items: PlanItem[], overallBudget: number | null): PlanSummary {
  const live = items.filter((i) => i.status !== "skipped");
  const open = live.filter((i) => i.status === "planned");
  const done = live.filter((i) => i.status === "bought");
  const remaining = open.reduce((a, i) => a + i.estimate, 0);
  const bought = done.reduce((a, i) => a + (i.actual ?? i.estimate), 0);
  const planned = remaining + bought;
  return {
    planned,
    bought,
    boughtEstimate: done.reduce((a, i) => a + i.estimate, 0),
    remaining,
    toBuy: open.length,
    count: live.length,
    budget: overallBudget,
    overBudgetBy: overallBudget !== null && planned > overallBudget ? planned - overallBudget : null,
  };
}

const key = (title: string, categoryId: string | null) => `${title.trim().toLowerCase()}|${categoryId ?? ""}`;

function moveDate(date: string | null, month: string) {
  if (!date) return null;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, "0")}`;
}

/** Copies of last month's repeating items for `month` ("2026-11"), skipping ones already on that month's list. */
export function rollForward(previous: PlanItem[], existing: Pick<PlanItem, "title" | "categoryId">[], month: string) {
  const have = new Set(existing.map((e) => key(e.title, e.categoryId)));
  return previous
    .filter((i) => i.repeatMonthly && !have.has(key(i.title, i.categoryId)))
    .map((i) => ({ title: i.title, categoryId: i.categoryId, estimate: i.actual ?? i.estimate, dueDate: moveDate(i.dueDate, month), repeatMonthly: true }));
}

/** One suggested item per category from what was actually spent last month, biggest first. */
export function fromLastMonth(
  expenses: { categoryId: string | null; amount: number }[],
  categories: { id: string; name: string }[],
  existing: Pick<PlanItem, "title" | "categoryId">[],
) {
  const have = new Set(existing.map((e) => key(e.title, e.categoryId)));
  const totals = new Map<string | null, number>();
  for (const e of expenses) totals.set(e.categoryId, (totals.get(e.categoryId) ?? 0) + e.amount);
  return [...totals]
    .map(([categoryId, total]) => ({ title: categories.find((c) => c.id === categoryId)?.name ?? "Other", categoryId, estimate: Math.round(total), dueDate: null, repeatMonthly: false }))
    .filter((s) => s.estimate > 0 && !have.has(key(s.title, s.categoryId)))
    .sort((a, b) => b.estimate - a.estimate);
}
