import { describe, expect, it } from "vitest";
import { chainSettlements, computeSettlement, type UnitRef } from "@/lib/finance";

const units: UnitRef[] = [
  { id: "aq", code: "AQ", sortOrder: 1 },
  { id: "ak", code: "AK", sortOrder: 2 },
  { id: "ab", code: "AB", sortOrder: 3 },
];
const rs = (n: number) => BigInt(n) * 100n;
const shared = (id: string, rupees: number) => ({ id, amountPaisa: rs(rupees), split: { type: "equal_units" as const, unitIds: ["aq", "ak", "ab"] } });
const pay = (unitId: string, rupees: number) => ({ unitId, amountPaisa: rs(rupees) });
const row = (s: ReturnType<typeof computeSettlement>, id: string) => s.units.find((u) => u.unitId === id)!;

describe("chainSettlements", () => {
  const months = chainSettlements(units, [
    { key: "oct", expenses: [shared("o", 30000)], payments: [pay("aq", 19000), pay("ak", 9500), pay("ab", 2000)] },
    { key: "nov", expenses: [shared("n", 30000)], payments: [pay("ak", 10500), pay("ab", 9000)] },
  ]);
  const oct = months.get("oct")!;
  const nov = months.get("nov")!;

  it("opens each month with the closing balances of the month before", () => {
    expect([row(oct, "aq").balancePaisa, row(oct, "ak").balancePaisa, row(oct, "ab").balancePaisa]).toEqual([rs(9000), rs(-500), rs(-8000)]);
    expect([row(nov, "aq").broughtForwardPaisa, row(nov, "ak").broughtForwardPaisa, row(nov, "ab").broughtForwardPaisa]).toEqual([rs(9000), rs(-500), rs(-8000)]);
  });

  it("uses a payment to clear the old amount first, and the rest counts for the new month", () => {
    expect(row(nov, "ak")).toMatchObject({ clearedPreviousPaisa: rs(500), balancePaisa: 0n, status: "settled" });
    expect(row(nov, "ab")).toMatchObject({ clearedPreviousPaisa: rs(8000), balancePaisa: rs(-8000 + 9000 - 10000), status: "to_pay" });
  });

  it("gives credit to whoever paid extra, so they owe less", () => {
    expect(row(nov, "aq")).toMatchObject({ paidPaisa: 0n, clearedPreviousPaisa: 0n, balancePaisa: rs(9000 - 10000), status: "to_pay" });
  });

  it("keeps the money in balance across the family", () => {
    expect(nov.totals.broughtForwardPaisa).toBe(oct.totals.balancePaisa);
    expect(nov.totals.balancePaisa).toBe(nov.totals.broughtForwardPaisa + nov.totals.paidPaisa - nov.totals.sharePaisa);
  });

  it("changes nothing for the first month", () => {
    const alone = computeSettlement({ units, expenses: [shared("o", 30000)], payments: [pay("aq", 19000), pay("ak", 9500), pay("ab", 2000)] });
    expect(alone.units.map((u) => [u.balancePaisa, u.status])).toEqual(oct.units.map((u) => [u.balancePaisa, u.status]));
  });

  it("treats a household with only a carried balance as owing or getting back, not as unpaid", () => {
    const quiet = chainSettlements(units, [
      { key: 1, expenses: [shared("a", 3000)], payments: [pay("aq", 3000)] },
      { key: 2, expenses: [], payments: [] },
    ]).get(2)!;
    expect(quiet.units.map((u) => u.status)).toEqual(["gets_back", "to_pay", "to_pay"]);
  });
});
