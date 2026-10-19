import { computeSettlement, paisaToNumber, parseRupeesToPaisa, type Settlement, type SplitSpec, type UnitRef } from "@/lib/finance";
import type { ParsedWorkbook } from "./parse-workbook";

export const IMPORT_UNITS: UnitRef[] = [
  { id: "AQ", code: "AQ", sortOrder: 1 },
  { id: "AK", code: "AK", sortOrder: 2 },
  { id: "AB", code: "AB", sortOrder: 3 },
];

const SPECS: Record<string, SplitSpec> = {
  POOL3: { type: "equal_units", unitIds: ["AQ", "AK", "AB"] },
  WAPDA: { type: "equal_units", unitIds: ["AK", "AB"] },
  SARF: { type: "weights", parts: [{ unitId: "AQ", num: 4, den: 9 }, { unitId: "AK", num: 4, den: 9 }, { unitId: "AB", num: 1, den: 9 }] },
  NONE: { type: "none" },
};

export type ReconcileLine = { label: string; sheet: number; app: number; ok: boolean };

const toPaisa = (n: number) => parseRupeesToPaisa(n.toFixed(2));

export function settlementFromParsed(p: ParsedWorkbook): Settlement {
  return computeSettlement({
    units: IMPORT_UNITS,
    expenses: p.expenses.map((e, i) => ({ id: String(i), amountPaisa: e.amount === null ? null : toPaisa(e.amount), split: SPECS[e.rule], section: e.section })),
    payments: Object.entries(p.paid)
      .filter(([, v]) => v !== null && v > 0)
      .map(([unitId, v]) => ({ unitId, amountPaisa: toPaisa(v!) })),
  });
}

export function reconcile(p: ParsedWorkbook, s: Settlement = settlementFromParsed(p)): ReconcileLine[] {
  const lines: ReconcileLine[] = [];
  const add = (label: string, sheet: number | undefined, app: number) => {
    if (sheet === undefined) return;
    lines.push({ label, sheet, app, ok: Math.abs(sheet - app) < 0.005 });
  };
  add("Shared total", p.cached["Shared Total"], paisaToNumber(s.sectionTotals.SHARED ?? 0n));
  add("Not shared total", p.cached["Not Shared Total"], paisaToNumber(s.sectionTotals.NOT_SHARED ?? 0n));
  add("Milk / sabzi / meat total", p.cached["Milk / Sabzi / Meat Total"], paisaToNumber(s.sectionTotals.MILK_MEAT ?? 0n));
  add("House help total", p.cached["House Help Total"], paisaToNumber(s.sectionTotals.HOUSE_HELP ?? 0n));
  add("Bills total", p.cached["Bills Total"], paisaToNumber(s.sectionTotals.BILLS ?? 0n));
  add("Grand total", p.cached["Grand Total"], paisaToNumber(s.grandTotal));
  const pool = (k: string) => paisaToNumber(s.rulePools.find((x) => x.key === k)?.amountPaisa ?? 0n);
  add("Three-way pool", p.cached["split:Three-Way Pool"], pool("equal:AB,AK,AQ"));
  add("Two-way (Wapda)", p.cached["split:Two-Way (Wapda)"], pool("equal:AB,AK"));
  add("Sarf", p.cached["split:Sarf (special)"], pool("weights:AB=1/9,AK=4/9,AQ=4/9"));
  for (const u of s.units) add(`${u.code} share (exact)`, p.cached[`split:${u.code}`], u.exactShare);
  add("Split total", p.cached["Split Total"], paisaToNumber(s.splitTotal));
  add("Paid total", p.cached["settle:paid"], paisaToNumber(s.totals.paidPaisa));
  return lines;
}
