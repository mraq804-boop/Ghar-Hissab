import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  allocateExpense,
  computeSettlement,
  exactShares,
  formatPaisa,
  largestRemainder,
  parseRupeesToPaisa,
  type SplitSpec,
  type UnitRef,
} from "@/lib/finance";
import {
  OCTOBER_EXPENSES,
  OCTOBER_PAYMENTS,
  POOL3,
  SARF,
  UNITS,
  WAPDA,
} from "../../fixtures/october-2026";

const byCode = <T extends { unitId: string }>(rows: T[], id: string) => rows.find((r) => r.unitId === id)!;

describe("October 2026 workbook reproduction", () => {
  const s = computeSettlement({ units: UNITS, expenses: OCTOBER_EXPENSES, payments: OCTOBER_PAYMENTS });

  it("matches the section totals in Grocery List", () => {
    expect(s.sectionTotals.SHARED).toBe(2_370_000n);
    expect(s.sectionTotals.NOT_SHARED).toBe(496_000n);
    expect(s.sectionTotals.MILK_MEAT).toBe(4_850_000n);
    expect(s.sectionTotals.HOUSE_HELP).toBe(800_000n);
    expect(s.sectionTotals.BILLS).toBe(220_000n);
    expect(s.grandTotal).toBe(8_736_000n);
  });

  it("matches the split pools G59:G61", () => {
    const pools = Object.fromEntries(s.rulePools.map((p) => [p.key, p.amountPaisa]));
    expect(pools[ruleKeyOf(POOL3)]).toBe(7_980_000n);
    expect(pools[ruleKeyOf(WAPDA)] ?? 0n).toBe(0n);
    expect(pools[ruleKeyOf(SARF)]).toBe(260_000n);
    expect(s.splitTotal).toBe(8_240_000n);
  });

  it("keeps exact shares equal to the Excel formulas G62:G64", () => {
    expect(byCode(s.units, "aq").exactShare.toFixed(2)).toBe("27755.56");
    expect(byCode(s.units, "ak").exactShare.toFixed(2)).toBe("27755.56");
    expect(byCode(s.units, "ab").exactShare.toFixed(2)).toBe("26888.89");
  });

  it("rounds to whole PKR with largest remainder and keeps the exact total", () => {
    expect(byCode(s.units, "aq").sharePaisa).toBe(2_775_600n);
    expect(byCode(s.units, "ak").sharePaisa).toBe(2_775_500n);
    expect(byCode(s.units, "ab").sharePaisa).toBe(2_688_900n);
    expect(s.units.reduce((a, u) => a + u.sharePaisa, 0n)).toBe(8_240_000n);
  });

  it("settles like rows 69:71", () => {
    expect(byCode(s.units, "aq")).toMatchObject({ paidPaisa: 2_790_000n, balancePaisa: 14_400n, status: "gets_back" });
    expect(byCode(s.units, "ak")).toMatchObject({ paidPaisa: 1_900_000n, balancePaisa: -875_500n, status: "to_pay" });
    expect(byCode(s.units, "ab")).toMatchObject({ paidPaisa: 0n, balancePaisa: -2_688_900n, status: "not_paid" });
    expect(s.totals).toEqual({ sharePaisa: 8_240_000n, paidPaisa: 4_690_000n, balancePaisa: -3_550_000n });
  });

  it("ignores pending bills (null amounts)", () => {
    expect(s.pendingBillCount).toBe(3);
  });
});

function ruleKeyOf(spec: SplitSpec) {
  return computeSettlement({ units: UNITS, expenses: [{ id: "x", amountPaisa: 100n, split: spec }], payments: [] })
    .rulePools[0].key;
}

describe("status rule", () => {
  const units: UnitRef[] = [{ id: "a", code: "A", sortOrder: 1 }];
  const one = (paid: bigint | null) =>
    computeSettlement({
      units,
      expenses: [{ id: "e", amountPaisa: 100_000n, split: { type: "equal_units", unitIds: ["a"] } }],
      payments: paid === null ? [] : [{ unitId: "a", amountPaisa: paid }],
    }).units[0].status;

  it("is not_paid with no approved payments", () => expect(one(null)).toBe("not_paid"));
  it("is settled when the balance rounds to zero rupees", () => expect(one(100_040n)).toBe("settled"));
  it("is gets_back when overpaid", () => expect(one(100_100n)).toBe("gets_back"));
  it("is to_pay when underpaid", () => expect(one(50_000n)).toBe("to_pay"));
  it("is to_pay when a zero payment exists (sheet F=0 case)", () => expect(one(0n)).toBe("to_pay"));
});

describe("split specs", () => {
  it("equal split of 100 among 3 gives 34/33/33", () => {
    const a = allocateExpense({ id: "e", amountPaisa: 10_000n, split: POOL3 }, UNITS);
    expect(a.map((x) => x.sharePaisa)).toEqual([3_400n, 3_300n, 3_300n]);
  });

  it("percentage split", () => {
    const a = allocateExpense(
      {
        id: "e",
        amountPaisa: 100_000n,
        split: { type: "percentage", parts: [{ unitId: "aq", percent: 50 }, { unitId: "ab", percent: 50 }] },
      },
      UNITS,
    );
    expect(a).toEqual([
      { unitId: "aq", sharePaisa: 50_000n },
      { unitId: "ab", sharePaisa: 50_000n },
    ]);
  });

  it("custom amounts must add up to the expense", () => {
    expect(() =>
      exactShares({ id: "e", amountPaisa: 1_000n, split: { type: "custom_amounts", parts: [{ unitId: "aq", amountPaisa: 900n }] } }),
    ).toThrow(/must add up/);
  });

  it("weights must add up to one", () => {
    expect(() =>
      exactShares({ id: "e", amountPaisa: 1_000n, split: { type: "weights", parts: [{ unitId: "aq", num: 1, den: 2 }] } }),
    ).toThrow(/add up to 1/);
  });

  it("percentages must add up to 100", () => {
    expect(() =>
      exactShares({ id: "e", amountPaisa: 1_000n, split: { type: "percentage", parts: [{ unitId: "aq", percent: 60 }] } }),
    ).toThrow(/100/);
  });

  it("rejects an equal split with no units", () => {
    expect(() => exactShares({ id: "e", amountPaisa: 1_000n, split: { type: "equal_units", unitIds: [] } })).toThrow();
  });
});

describe("largestRemainder (property)", () => {
  it("always sums to the rounded total and each share is within one step of exact", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 10_000_000n }), { minLength: 1, maxLength: 3 }),
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 6 }),
        (amounts, weights) => {
          const units = weights.map((_, i) => ({ id: `u${i}`, code: `U${i}`, sortOrder: i }));
          const totalW = weights.reduce((a, b) => a + b, 0);
          const expenses = amounts.map((amt, i) => ({
            id: `e${i}`,
            amountPaisa: amt,
            split: {
              type: "weights" as const,
              parts: weights.map((w, j) => ({ unitId: `u${j}`, num: w, den: totalW })),
            },
          }));
          const s = computeSettlement({ units, expenses, payments: [] });
          const sum = s.units.reduce((a, u) => a + u.sharePaisa, 0n);
          const total = amounts.reduce((a, b) => a + b, 0n);
          const target = ((total + 50n) / 100n) * 100n;
          expect(sum).toBe(target);
          for (const u of s.units) {
            expect(u.sharePaisa % 100n).toBe(0n);
            const diff = Number(u.sharePaisa) / 100 - u.exactShare;
            expect(Math.abs(diff)).toBeLessThan(1.0000001);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("breaks ties by sort order", () => {
    const r = largestRemainder(
      [
        { key: "b", sortOrder: 2, num: 150n, den: 1n },
        { key: "a", sortOrder: 1, num: 150n, den: 1n },
      ],
      100n,
    );
    expect(r).toEqual(new Map([["a", 200n], ["b", 100n]]));
  });
});

describe("money helpers", () => {
  it("parses rupee strings to paisa without float error", () => {
    expect(parseRupeesToPaisa("27,755.56")).toBe(2_775_556n);
    expect(parseRupeesToPaisa("0.1")).toBe(10n);
    expect(parseRupeesToPaisa("1000")).toBe(100_000n);
    expect(() => parseRupeesToPaisa("1.234")).toThrow();
    expect(() => parseRupeesToPaisa("abc")).toThrow();
  });

  it("formats paisa as PKR", () => {
    expect(formatPaisa(2_775_600n)).toBe("Rs 27,756");
    expect(formatPaisa(-875_500n)).toBe("−Rs 8,755");
    expect(formatPaisa(2_775_556n, { decimals: true })).toBe("Rs 27,755.56");
  });
});
