import { describe, expect, it } from "vitest";
import { forecastMonth, type ForecastItem } from "@/lib/smart/forecast";
import type { SplitSpec } from "@/lib/finance/split";

const units = [
  { id: "aq", code: "AQ", sortOrder: 1 },
  { id: "ak", code: "AK", sortOrder: 2 },
  { id: "ab", code: "AB", sortOrder: 3 },
];
const pool3: SplitSpec = { type: "equal_units", unitIds: ["aq", "ak", "ab"] };
const akab: SplitSpec = { type: "equal_units", unitIds: ["ak", "ab"] };
const rs = (n: number) => BigInt(n) * 100n;
const item = (title: string, amount: number | null, sectionKey = "SHARED", split: SplitSpec = pool3): ForecastItem => ({
  title,
  sectionKey,
  amountPaisa: amount === null ? null : rs(amount),
  split,
});

describe("forecastMonth", () => {
  it("needs at least one earlier month", () => {
    expect(forecastMonth({ units, current: { label: "Oct 2026", items: [item("Oil", 900)] }, previous: [], payments: [] })).toBeNull();
  });

  it("adds regular monthly items not yet entered, with their usual split", () => {
    const previous = [
      {
        label: "Oct 2026",
        items: [item("Milk", 12000, "MILK_MEAT"), item("Wapda (electricity)", 10000, "BILLS", akab), item("Garam Masala", 600), item("Pamper", 2000, "NOT_SHARED", { type: "none" })],
      },
    ];
    const f = forecastMonth({
      units,
      current: { label: "Nov 2026", items: [item("Oil", 9000), item("Wapda", null, "BILLS", akab)] },
      previous,
      payments: [{ unitId: "ak", amountPaisa: rs(5000) }],
    })!;
    expect(f.expected).toEqual([
      { title: "Milk", amountPaisa: rs(12000), basedOn: "Oct 2026" },
      { title: "Wapda (electricity)", amountPaisa: rs(10000), basedOn: "Oct 2026" },
    ]);
    expect(f.unknown).toEqual([]);
    expect(f.recordedPaisa).toBe(rs(9000));
    expect(f.projectedPaisa).toBe(rs(31000));
    expect(f.units.map((u) => [u.code, u.projectedSharePaisa, u.projectedBalancePaisa])).toEqual([
      ["AQ", rs(7000), rs(-7000)],
      ["AK", rs(12000), rs(-7000)],
      ["AB", rs(12000), rs(-12000)],
    ]);
  });

  it("uses the average of the months an item appeared in, and lists bills it cannot estimate", () => {
    const f = forecastMonth({
      units,
      current: { label: "Dec 2026", items: [item("Water", null, "BILLS")] },
      previous: [
        { label: "Nov 2026", items: [item("Tea", 1000)] },
        { label: "Oct 2026", items: [item("Tea", 1200), item("Capri", 450)] },
      ],
      payments: [],
    })!;
    expect(f.expected).toEqual([{ title: "Tea", amountPaisa: rs(1100), basedOn: "last 2 months" }]);
    expect(f.unknown).toEqual(["Water"]);
  });

  it("returns nothing when every regular item is already in", () => {
    const previous = [{ label: "Oct 2026", items: [item("Milk", 12000, "MILK_MEAT")] }];
    expect(forecastMonth({ units, current: { label: "Nov 2026", items: [item("milk", 11000, "MILK_MEAT")] }, previous, payments: [] })).toBeNull();
  });
});
