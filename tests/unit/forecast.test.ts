import { describe, expect, it } from "vitest";
import { billsToCome, priceShopping, restOfMonthDays } from "@/lib/forecast";

describe("rest of month forecast", () => {
  it("lists the days from tomorrow to the month end", () => {
    const days = restOfMonthDays("2026-11-06");
    expect(days[0]).toBe("2026-11-07");
    expect(days.at(-1)).toBe("2026-11-30");
    expect(days).toHaveLength(24);
    expect(restOfMonthDays("2026-11-30")).toEqual([]);
    expect(restOfMonthDays("2028-02-28")).toEqual(["2028-02-29"]);
  });

  it("prices keema and fish at the family rate and chicken at the official rate", () => {
    const items = priceShopping(
      [
        { group: "Meat", item: "Keema (mutton)", kg: 3, days: [] },
        { group: "Fish", item: "Fish", kg: 10, days: [] },
        { group: "Chicken", item: "Chicken", kg: 15.5, days: [] },
        { group: "Meat", item: "Mutton", kg: 3, days: [] },
      ],
      { perKg: 563, date: "2026-11-05" },
    );
    expect(items.map((i) => i.perKg)).toEqual([2800, 800, 563, null]);
    expect(items[2].rateFrom).toContain("2026-11-05");
    expect(priceShopping([{ group: "Chicken", item: "Chicken", kg: 1, days: [] }], null)[0].perKg).toBeNull();
  });

  it("finds last month's bills not entered yet, adding up repeated titles", () => {
    const out = billsToCome(
      [
        { title: "AB 1", category: "Electricity (Wapda)", amountPaisa: 339_200n },
        { title: "Internet", category: "Internet", amountPaisa: 220_000n },
        { title: "Gas", category: "Gas", amountPaisa: 873_000n },
        { title: "Water", category: "Water", amountPaisa: null },
        { title: "AB 1", category: "Electricity (Wapda)", amountPaisa: 100n },
      ],
      [{ title: "gas" }, { title: "Cable bill" }],
    );
    expect(out).toEqual([
      { title: "AB 1", category: "Electricity (Wapda)", lastMonthPaisa: 339_300n },
      { title: "Internet", category: "Internet", lastMonthPaisa: 220_000n },
    ]);
  });
});
