import type { Paisa } from "@/lib/finance/money";
import { computeSettlement, type PaymentInput } from "@/lib/finance/settlement";
import type { SplitSpec, UnitRef } from "@/lib/finance/split";
import { itemKey } from "./alerts";

export type ForecastItem = { title: string; sectionKey: string; amountPaisa: Paisa | null; split: SplitSpec };
export type ForecastMonth = { label: string; items: ForecastItem[] };

export type Forecast = {
  recordedPaisa: Paisa;
  projectedPaisa: Paisa;
  expected: { title: string; amountPaisa: Paisa; basedOn: string }[];
  unknown: string[];
  units: { unitId: string; code: string; projectedSharePaisa: Paisa; paidPaisa: Paisa; projectedBalancePaisa: Paisa }[];
};

const MONTHLY_SECTIONS = new Set(["MILK_MEAT", "HOUSE_HELP", "BILLS"]);

/**
 * Estimates where the month will end: what is already recorded plus the regular items that
 * have not been entered yet, each at its usual amount and split. `previous` is newest first.
 */
export function forecastMonth(input: { units: UnitRef[]; current: ForecastMonth; previous: ForecastMonth[]; payments: PaymentInput[] }): Forecast | null {
  const recent = input.previous.slice(0, 3);
  if (!recent.length) return null;

  const present = new Set(input.current.items.filter((i) => i.amountPaisa !== null).map((i) => itemKey(i.title)));
  const pending = input.current.items.filter((i) => i.amountPaisa === null);
  const pendingKeys = new Set(pending.map((i) => itemKey(i.title)));

  const history = new Map<string, { item: ForecastItem; amounts: Paisa[]; months: string[] }>();
  for (const m of recent) {
    const totals = new Map<string, { item: ForecastItem; total: Paisa }>();
    for (const i of m.items) {
      if (i.amountPaisa === null) continue;
      const k = itemKey(i.title);
      totals.set(k, { item: totals.get(k)?.item ?? i, total: (totals.get(k)?.total ?? 0n) + i.amountPaisa });
    }
    for (const [k, { item, total }] of totals) {
      const h = history.get(k) ?? { item, amounts: [], months: [] };
      h.amounts.push(total);
      h.months.push(m.label);
      history.set(k, h);
    }
  }

  const expected: Forecast["expected"] = [];
  const extra: ForecastItem[] = [];
  for (const [k, h] of history) {
    if (present.has(k)) continue;
    const regular = pendingKeys.has(k) || (recent.length === 1 ? MONTHLY_SECTIONS.has(h.item.sectionKey) : h.amounts.length >= 2);
    if (!regular || h.item.split.type === "custom_amounts" || h.item.split.type === "none") continue;
    const amountPaisa = ((h.amounts.reduce((a, b) => a + b, 0n) / BigInt(h.amounts.length) + 50n) / 100n) * 100n;
    expected.push({ title: h.item.title, amountPaisa, basedOn: h.months.length === 1 ? h.months[0] : `last ${h.months.length} months` });
    extra.push({ ...h.item, amountPaisa });
  }
  const unknown = pending.filter((i) => !history.has(itemKey(i.title))).map((i) => i.title);
  if (!expected.length && !unknown.length) return null;

  const toInput = (items: ForecastItem[]) =>
    items.map((i, n) => ({ id: String(n), amountPaisa: i.amountPaisa, split: i.split, section: i.sectionKey }));
  const now = computeSettlement({ units: input.units, expenses: toInput(input.current.items), payments: input.payments });
  const projected = computeSettlement({ units: input.units, expenses: toInput([...input.current.items, ...extra]), payments: input.payments });

  return {
    recordedPaisa: now.splitTotal,
    projectedPaisa: projected.splitTotal,
    expected: expected.sort((a, b) => (b.amountPaisa > a.amountPaisa ? 1 : -1)),
    unknown,
    units: projected.units.map((u) => ({
      unitId: u.unitId,
      code: u.code,
      projectedSharePaisa: u.sharePaisa,
      paidPaisa: u.paidPaisa,
      projectedBalancePaisa: u.balancePaisa,
    })),
  };
}
