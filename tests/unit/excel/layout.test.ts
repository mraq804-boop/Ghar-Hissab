import { describe, expect, it } from "vitest";
import { computeSettlement, splitKey } from "@/lib/finance";
import { COLS, renderDutySheet, renderMenuValues, renderPeriodSheet, type LayoutExpense } from "@/server/excel/layout";
import type { SectionKey } from "@/lib/household-defaults";
import { OCTOBER_EXPENSES, OCTOBER_PAYMENTS, POOL3, SARF, UNITS, WAPDA } from "../../fixtures/october-2026";
import { Sheet } from "../../helpers/formula";

const RULES: Record<string, { key: string; label: string; description: string }> = {
  [splitKey(POOL3)]: { key: "POOL3", label: "Three-Way Pool", description: "Equal 3-way, Sarf removed" },
  [splitKey(WAPDA)]: { key: "WAPDA", label: "Two-Way (Wapda)", description: "AK + AB only" },
  [splitKey(SARF)]: { key: "SARF", label: "Sarf (special)", description: "AB 1/9, AQ & AK 4/9 each" },
  none: { key: "NONE", label: "Not shared", description: "" },
};

function octoberLayout() {
  const settlement = computeSettlement({ units: UNITS, expenses: OCTOBER_EXPENSES, payments: OCTOBER_PAYMENTS });
  const expenses: LayoutExpense[] = OCTOBER_EXPENSES.map((e) => {
    const rule = RULES[splitKey(e.split)];
    const meat = ["Chicken", "Mutton", "Keema"].includes(e.title);
    const qr: Record<string, [number, number]> = { Chicken: [21, 500], Mutton: [4, 2600], Keema: [4, 1400] };
    return {
      id: e.id,
      sectionKey: e.section as SectionKey,
      title: e.title,
      notes: null,
      qtyText: null,
      qtyNum: meat ? qr[e.title][0] : null,
      rate: meat ? qr[e.title][1] : null,
      amountPaisa: e.amountPaisa,
      spec: e.split,
      ruleKey: rule.key,
      ruleLabel: rule.label,
      ruleDescription: rule.description,
    };
  });
  return renderPeriodSheet({
    sheetName: "Grocery List",
    month: 10,
    units: UNITS,
    expenses,
    paidByUnit: new Map(OCTOBER_PAYMENTS.map((p) => [p.unitId, p.amountPaisa])),
    settlement,
    poolOrder: ["POOL3", "WAPDA", "SARF"],
  });
}

function load(layout: ReturnType<typeof octoberLayout>) {
  const sheet = new Sheet();
  for (const row of layout.rows) row.cells.forEach((v, i) => v !== null && sheet.set(`${COLS[i]}${row.r}`, v));
  return sheet;
}

describe("October money sheet layout", () => {
  const layout = octoberLayout();
  const sheet = load(layout);
  const formula = (addr: string) => layout.rows.find((r) => r.r === Number(addr.slice(1)))!.cells[COLS.indexOf(addr[0] as (typeof COLS)[number])];

  it("lands every block on the same rows as the original workbook", () => {
    expect(formula("G27")).toBe("=SUM(G6:G26)");
    expect(formula("G35")).toBe("=SUM(G30:G34)");
    expect(formula("G43")).toBe("=SUM(G38:G42)");
    expect(formula("E43")).toBe("=SUM(E38:E42)");
    expect(formula("G47")).toBe("=SUM(G46:G46)");
    expect(formula("G54")).toBe("=SUM(G50:G53)");
    expect(formula("G56")).toBe("=G27+G35+G43+G47+G54");
    expect(formula("G40")).toBe('=IF(F40="","",E40*F40)');
    expect(formula("G62")).toBe("=$G$59/3+$G$61*4/9");
    expect(formula("G63")).toBe("=$G$59/3+$G$60/2+$G$61*4/9");
    expect(formula("G64")).toBe("=$G$59/3+$G$60/2+$G$61/9");
    expect(formula("G65")).toBe("=SUM(G62:G64)");
    expect(formula("D69")).toBe('=IF(F69="","Not paid",IF(ROUND(G69,0)=0,"Settled",IF(G69>0,"Gets back","To pay")))');
    expect(layout.rows.find((r) => r.r === 74)?.style).toBe("note");
  });

  it("computes the same figures as the original workbook", () => {
    expect(sheet.get("G27")).toBe(23700);
    expect(sheet.get("G35")).toBe(4960);
    expect(sheet.get("G43")).toBe(48500);
    expect(sheet.get("G56")).toBe(87360);
    expect(sheet.get("G59")).toBe(79800);
    expect(sheet.get("G60")).toBe(0);
    expect(sheet.get("G61")).toBe(2600);
    expect(sheet.get("G62")).toBeCloseTo(27755.5556, 3);
    expect(sheet.get("G64")).toBeCloseTo(26888.8889, 3);
    expect(sheet.get("G65")).toBeCloseTo(82400, 6);
  });

  it("writes the app's rounded settlement", () => {
    expect([sheet.get("E69"), sheet.get("E70"), sheet.get("E71")]).toEqual([27756, 27755, 26889]);
    expect([sheet.get("D69"), sheet.get("D70"), sheet.get("D71")]).toEqual(["Gets back", "To pay", "Not paid"]);
    expect(sheet.get("G72")).toBe(46900 - 82400);
  });

  it("passes its own read-back checks", () => {
    for (const c of layout.checks) expect(sheet.get(c.cell)).toBeCloseTo(c.expected, 6);
  });

  it("puts the record id in hidden column I for every item row", () => {
    const items = layout.rows.filter((r) => r.id);
    expect(items).toHaveLength(OCTOBER_EXPENSES.length);
    for (const r of items) expect(r.cells[COLS.indexOf("I")]).toBe(r.id);
  });

  it("is deterministic, so re-syncing writes identical values", () => {
    expect(octoberLayout()).toEqual(layout);
  });

  it("keeps SUM ranges valid when a section is empty", () => {
    const settlement = computeSettlement({ units: UNITS, expenses: [], payments: [] });
    const empty = renderPeriodSheet({ sheetName: "x", month: 11, units: UNITS, expenses: [], paidByUnit: new Map(), settlement });
    const s = load(empty);
    for (const c of empty.checks) expect(s.get(c.cell)).toBe(c.expected);
  });

  it("handles custom splits as their own pool", () => {
    const custom = {
      id: "c1",
      amountPaisa: 100_000n,
      split: { type: "custom_amounts" as const, parts: [{ unitId: "aq", amountPaisa: 70_000n }, { unitId: "ab", amountPaisa: 30_000n }] },
    };
    const settlement = computeSettlement({ units: UNITS, expenses: [custom], payments: [] });
    const l = renderPeriodSheet({
      sheetName: "x",
      month: 11,
      units: UNITS,
      expenses: [{ ...custom, sectionKey: "SHARED", title: "Repair", notes: null, qtyText: null, qtyNum: null, rate: null, spec: custom.split, ruleKey: "CUSTOM-c1", ruleLabel: "Custom", ruleDescription: "" }],
      paidByUnit: new Map(),
      settlement,
    });
    const s = load(l);
    for (const c of l.checks) expect(s.get(c.cell)).toBeCloseTo(c.expected, 6);
  });
});

describe("kitchen sheets", () => {
  it("renders the 4-week menu grid in place", () => {
    const v = renderMenuValues({
      slots: [{ week: 1, weekday: 1, fixed_category: "Sabzi + Chicken", dish: "Sabzi (seasonal) + Chicken" }],
      sabzi: ["Aloo Gobi", "Lauki"],
    });
    expect(v.grid).toHaveLength(7);
    expect(v.grid[0].slice(0, 3)).toEqual(["Monday", "Sabzi + Chicken", "Sabzi (seasonal) + Chicken"]);
    expect(v.options[0].slice(0, 3)).toEqual(["Aloo Gobi", "Lauki", ""]);
  });

  it("counts meals per person with COUNTIF", () => {
    const l = renderDutySheet({
      sheetName: "Kitchen Duties",
      year: 2026,
      month: 10,
      days: [
        { day: "2026-10-01", breakfast: "P1", lunch: "P2", dinner: "P1", off: "P3" },
        { day: "2026-10-02", breakfast: "P2", lunch: "P2", dinner: "P1", off: "P3" },
      ],
      people: ["P1", "P2", "P3"],
      notes: [],
    });
    const s = new Sheet();
    for (const row of l.rows) row.cells.forEach((v, i) => v !== null && s.set(`${"BCDEFG"[i]}${row.r}`, v));
    expect(s.get("B5")).toBe(46296);
    expect(s.get("C5")).toBe("Thursday");
    for (const c of l.checks) expect(s.get(c.cell)).toBe(c.expected);
  });
});
