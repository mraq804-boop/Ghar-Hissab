import { describe, expect, it } from "vitest";
import { spendingAlerts, type AlertExpense, type AlertMonth } from "@/lib/smart/alerts";

const rs = (n: number) => BigInt(n) * 100n;
const e = (title: string, amount: number | null, over: Partial<AlertExpense> = {}): AlertExpense => ({
  title,
  sectionKey: "SHARED",
  categoryKey: "groc",
  categoryName: "Groceries",
  amountPaisa: amount === null ? null : rs(amount),
  ratePaisa: null,
  ...over,
});
const month = (label: string, expenses: AlertExpense[]): AlertMonth => ({ label, expenses });

const milk = (n: number) => e("Milk", n, { sectionKey: "MILK_MEAT", categoryKey: "milk", categoryName: "Milk" });
const gas = (n: number | null) => e("Gas", n, { sectionKey: "BILLS", categoryKey: "gas", categoryName: "Gas" });

describe("spendingAlerts", () => {
  it("is quiet for a normal month", () => {
    const prev = [month("Oct 2026", [milk(12000), gas(8000)]), month("Sep 2026", [milk(11500), gas(7000)])];
    expect(spendingAlerts(month("Nov 2026", [milk(12500), gas(7600)]), prev, 20)).toEqual([]);
  });

  it("flags an item far above its usual amount", () => {
    const prev = [month("Oct 2026", [milk(12000)]), month("Sep 2026", [milk(12000)])];
    const [a] = spendingAlerts(month("Nov 2026", [milk(120000)]), prev, 20);
    expect(a).toMatchObject({ kind: "item_high", title: "Milk is Rs 120,000 this month" });
  });

  it("flags a category that is clearly higher than usual", () => {
    const prev = [month("Oct 2026", [e("Oil", 4000), e("Chini", 1000)])];
    const alerts = spendingAlerts(month("Nov 2026", [e("Oil", 6000), e("Chini", 1500)]), prev, 25);
    expect(alerts).toEqual([{ kind: "category_high", title: "Groceries up 50% this month", detail: "Rs 7,500 so far, usually about Rs 5,000." }]);
  });

  it("flags a regular bill that has not been entered after the 10th", () => {
    const prev = [month("Oct 2026", [gas(8730)])];
    expect(spendingAlerts(month("Nov 2026", []), prev, 5)).toEqual([]);
    expect(spendingAlerts(month("Nov 2026", []), prev, 12)[0]).toMatchObject({ kind: "missing", title: "Gas bill not entered yet", detail: "It was Rs 8,730 in Oct 2026." });
  });

  it("does not repeat the missing alert for a bill marked as not issued", () => {
    const prev = [month("Oct 2026", [gas(8730)])];
    expect(spendingAlerts(month("Nov 2026", [gas(null)]), prev, 15)).toEqual([]);
  });

  it("flags a rate increase on kg-priced items", () => {
    const prev = [month("Oct 2026", [e("Chicken", 10500, { ratePaisa: rs(500) })])];
    const [a] = spendingAlerts(month("Nov 2026", [e("Chicken", 12000, { ratePaisa: rs(600) })]), prev, 20);
    expect(a).toMatchObject({ kind: "rate_up", title: "Chicken rate up 20%" });
  });

  it("flags the same item and amount entered twice in one section, even in the first month", () => {
    const alerts = spendingAlerts(month("Oct 2026", [e("Capri", 450), e("Capri", 450, { sectionKey: "NOT_SHARED" }), e("Tea", 1000), e("tea", 1000)]), [], 20);
    expect(alerts).toEqual([{ kind: "duplicate", title: "Tea Rs 1,000 is entered twice", detail: "Same item and amount appears twice in Oct 2026. Check it isn't a duplicate." }]);
  });
});
