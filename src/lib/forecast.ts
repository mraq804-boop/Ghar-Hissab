import { knownRate, type ShoppingRow } from "@/lib/shopping";

export type ForecastItem = { group: string; item: string; kg: number; perKg: number | null; rateFrom: string | null; days: string[] };
export type BillToCome = { title: string; category: string | null; lastMonthPaisa: bigint };

/** The dates from tomorrow to the last day of today's month. */
export function restOfMonthDays(today: string): string[] {
  const [y, m, d] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last - d }, (_, i) => `${today.slice(0, 8)}${String(d + 1 + i).padStart(2, "0")}`);
}

/** Prices each shopping row: the family's own rate first, then the official chicken rate. */
export function priceShopping(rows: ShoppingRow[], chicken: { perKg: number; date: string } | null): ForecastItem[] {
  return rows.map((r) => {
    const own = knownRate(r.item);
    if (own) return { group: r.group, item: r.item, kg: r.kg, perKg: own, rateFrom: "family's own rate", days: r.days };
    if (r.group === "Chicken" && chicken) return { group: r.group, item: r.item, kg: r.kg, perKg: chicken.perKg, rateFrom: `official broiler meat retail rate, ${chicken.date}`, days: r.days };
    return { group: r.group, item: r.item, kg: r.kg, perKg: null, rateFrom: null, days: r.days };
  });
}

/** Bills paid last month whose title isn't entered yet this month, with last month's amount. */
export function billsToCome(
  lastMonth: { title: string; category: string | null; amountPaisa: bigint | null }[],
  thisMonth: { title: string }[],
): BillToCome[] {
  const entered = new Set(thisMonth.map((e) => e.title.trim().toLowerCase()));
  const out = new Map<string, BillToCome>();
  for (const e of lastMonth) {
    const key = e.title.trim().toLowerCase();
    if (!e.amountPaisa || entered.has(key)) continue;
    const prev = out.get(key);
    out.set(key, { title: e.title.trim(), category: e.category, lastMonthPaisa: (prev?.lastMonthPaisa ?? 0n) + e.amountPaisa });
  }
  return [...out.values()];
}
