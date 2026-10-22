import { describe, expect, it } from "vitest";
import { fromLastMonth, planSummary, rollForward, type PlanItem } from "@/lib/personal/plan";

const item = (over: Partial<PlanItem> & { title: string }): PlanItem => ({
  id: over.title,
  categoryId: "fuel",
  estimate: 1000,
  dueDate: null,
  repeatMonthly: false,
  status: "planned",
  actual: null,
  ...over,
});

describe("planSummary", () => {
  it("adds estimates still to buy and actual amounts already bought, ignoring skipped", () => {
    const s = planSummary(
      [
        item({ title: "Petrol", estimate: 12000, status: "bought", actual: 11500 }),
        item({ title: "Shoes", estimate: 6000 }),
        item({ title: "Gift", estimate: 3000, status: "skipped" }),
      ],
      20000,
    );
    expect(s).toEqual({ planned: 17500, bought: 11500, boughtEstimate: 12000, remaining: 6000, toBuy: 1, count: 2, budget: 20000, overBudgetBy: null });
  });

  it("shows how far the plan goes over the budget", () => {
    expect(planSummary([item({ title: "Petrol", estimate: 32000 })], 30000).overBudgetBy).toBe(2000);
    expect(planSummary([item({ title: "Petrol", estimate: 32000 })], null).overBudgetBy).toBeNull();
  });
});

describe("rollForward", () => {
  it("copies repeating items to the next month, keeping the day where it exists", () => {
    const next = rollForward(
      [
        item({ title: "Petrol", repeatMonthly: true, dueDate: "2026-10-31", status: "bought", actual: 11500 }),
        item({ title: "Shoes" }),
        item({ title: "Mobile", categoryId: "mobile", repeatMonthly: true, dueDate: "2026-10-05" }),
      ],
      [{ title: "mobile", categoryId: "mobile" }],
      "2026-11",
    );
    expect(next).toEqual([{ title: "Petrol", categoryId: "fuel", estimate: 11500, dueDate: "2026-11-30", repeatMonthly: true }]);
  });
});

describe("fromLastMonth", () => {
  it("suggests one item per category from last month's spending, biggest first", () => {
    const s = fromLastMonth(
      [
        { categoryId: "fuel", amount: 3000 },
        { categoryId: "fuel", amount: 2500.4 },
        { categoryId: "med", amount: 850 },
        { categoryId: null, amount: 200 },
      ],
      [{ id: "fuel", name: "Fuel" }, { id: "med", name: "Medicine" }],
      [{ title: "Medicine", categoryId: "med" }],
    );
    expect(s).toEqual([
      { title: "Fuel", categoryId: "fuel", estimate: 5500, dueDate: null, repeatMonthly: false },
      { title: "Other", categoryId: null, estimate: 200, dueDate: null, repeatMonthly: false },
    ]);
  });
});
