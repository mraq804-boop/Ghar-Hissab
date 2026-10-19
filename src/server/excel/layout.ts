import { paisaToNumber, splitFractions, splitKey, type Settlement, type SplitSpec, type UnitRef } from "@/lib/finance";
import { MONTHS_LONG } from "@/lib/periods";
import { SECTION_SHEET_TITLES, SECTION_TOTAL_LABELS, SECTIONS, type SectionKey } from "@/lib/household-defaults";

export type Cell = string | number | null;

export type RowStyle =
  | "title"
  | "header"
  | "band"
  | "item"
  | "itemAlt"
  | "total"
  | "grand"
  | "pool"
  | "share"
  | "settle"
  | "settleAlt"
  | "note";

export const COLS = ["B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;
export const ID_COL = "I";
export const KEY_COL = "J";

export type SheetRow = { r: number; style: RowStyle; cells: Cell[]; merge?: boolean; id?: string };

export type SheetLayout = {
  name: string;
  rows: SheetRow[];
  lastRow: number;
  lastCol: (typeof COLS)[number];
  checks: { cell: string; label: string; expected: number }[];
  columnWidths: Partial<Record<string, number>>;
  hiddenColumns: string[];
};

export type LayoutExpense = {
  id: string;
  sectionKey: SectionKey;
  title: string;
  notes: string | null;
  qtyText: string | null;
  qtyNum: number | null;
  rate: number | null;
  amountPaisa: bigint | null;
  spec: SplitSpec;
  ruleKey: string;
  ruleLabel: string;
  ruleDescription: string;
};

export const SHEET_TITLE = "Household & Grocery Shopping List";
export const SYNC_NOTE = "Managed by Ghar Hisaab. Make changes in the app; edits typed directly into this sheet are replaced on the next sync.";

const MONEY_COLS = 9;

export function text(v: string | null | undefined): string {
  const t = (v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
}
const pad = (cells: Cell[]): Cell[] => [...cells, ...Array(MONEY_COLS - cells.length).fill(null)];

function fractionTerm(cell: string, num: bigint, den: bigint): string {
  if (num === den) return cell;
  if (num === 1n) return `${cell}/${den}`;
  return `${cell}*${num}/${den}`;
}

export function renderPeriodSheet(input: {
  sheetName: string;
  month: number;
  units: UnitRef[];
  expenses: LayoutExpense[];
  paidByUnit: Map<string, bigint>;
  settlement: Settlement;
  poolOrder?: string[];
}): SheetLayout {
  const rows: SheetRow[] = [];
  const checks: SheetLayout["checks"] = [];
  const units = [...input.units].sort((a, b) => a.sortOrder - b.sortOrder);
  let r = 2;

  rows.push({ r, style: "title", merge: true, cells: pad([SHEET_TITLE]) });
  r = 4;
  rows.push({ r, style: "header", cells: pad(["Sr. No.", "Item Description", "Notes / Category", "Quantity (kg / L)", "Rate (per kg / L)", "Amount (PKR)", null, "id", "split"]) });
  r++;

  const totalCells: string[] = [];
  const firstItemRow = r + 1;
  let lastItemRow = r;

  for (const section of SECTIONS) {
    rows.push({ r, style: "band", merge: true, cells: pad([SECTION_SHEET_TITLES[section.key], null, null, null, null, null, null, `section:${section.key}`]) });
    r++;
    const items = input.expenses.filter((e) => e.sectionKey === section.key);
    const start = r;
    if (items.length === 0) {
      rows.push({ r, style: "item", cells: pad([]) });
      r++;
    }
    items.forEach((e, i) => {
      const priced = e.rate !== null && e.qtyNum !== null;
      rows.push({
        r,
        id: e.id,
        style: i % 2 === 0 ? "item" : "itemAlt",
        cells: pad([
          i + 1,
          text(e.title),
          text(e.notes),
          priced ? e.qtyNum : text(e.qtyText),
          priced ? e.rate : null,
          priced ? `=IF(F${r}="","",E${r}*F${r})` : e.amountPaisa === null ? null : paisaToNumber(e.amountPaisa),
          null,
          e.id,
          e.ruleKey,
        ]),
      });
      r++;
    });
    const end = r - 1;
    lastItemRow = end;
    const totalRow = r;
    rows.push({
      r,
      style: "total",
      cells: pad([
        null,
        SECTION_TOTAL_LABELS[section.key],
        null,
        section.key === "MILK_MEAT" ? `=SUM(E${start}:E${end})` : null,
        null,
        `=SUM(G${start}:G${end})`,
        null,
        `total:${section.key}`,
      ]),
    });
    totalCells.push(`G${totalRow}`);
    r += 2;
  }

  const grandRow = r;
  rows.push({ r, style: "grand", cells: pad([null, "Grand Total:", null, null, null, `=${totalCells.join("+")}`, null, "grand"]) });
  checks.push({ cell: `G${grandRow}`, label: "Grand total", expected: paisaToNumber(input.settlement.grandTotal) });
  r += 2;

  rows.push({ r, style: "band", merge: true, cells: pad([`SHARED SPLIT  -  ${units.map((u) => u.code).join(" / ")}`, null, null, null, null, null, null, "split"]) });
  r++;

  const keyRange = `$${KEY_COL}$${firstItemRow}:$${KEY_COL}$${lastItemRow}`;
  const amountRange = `$G$${firstItemRow}:$G$${lastItemRow}`;
  const pools: { key: string; cell: string; spec: SplitSpec }[] = [];
  const seen = new Set<string>();
  const order = (k: string) => {
    const i = input.poolOrder?.indexOf(k) ?? -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const poolSources = input.expenses
    .filter((e) => e.spec.type !== "none")
    .filter((e) => (seen.has(e.ruleKey) ? false : (seen.add(e.ruleKey), true)))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => order(a.e.ruleKey) - order(b.e.ruleKey) || a.i - b.i)
    .map((x) => x.e);
  for (const e of poolSources) {
    rows.push({
      r,
      style: "pool",
      cells: pad([null, text(`${e.ruleLabel}:`), text(e.ruleDescription), null, null, `=SUMIF(${keyRange},"${e.ruleKey}",${amountRange})`, null, `pool:${e.ruleKey}`]),
    });
    pools.push({ key: e.ruleKey, cell: `$G$${r}`, spec: e.spec });
    r++;
  }

  const shareRows: number[] = [];
  units.forEach((u, i) => {
    const terms: string[] = [];
    const words: string[] = [];
    for (const p of pools) {
      const f = poolFraction(p.spec, u.id);
      if (!f) continue;
      terms.push(fractionTerm(p.cell, f.num, f.den));
      words.push(f.num === f.den ? "all" : `${f.num}/${f.den}`);
    }
    rows.push({ r, style: "share", cells: pad([i + 1, text(u.code), words.join(" + ") || "nothing shared", null, null, terms.length ? `=${terms.join("+")}` : 0, null, `share:${u.code}`]) });
    shareRows.push(r);
    r++;
  });
  const splitTotalRow = r;
  rows.push({ r, style: "total", cells: pad([null, "Split Total:", null, null, null, `=SUM(G${shareRows[0]}:G${shareRows[shareRows.length - 1]})`, null, "split-total"]) });
  checks.push({ cell: `G${splitTotalRow}`, label: "Split total", expected: paisaToNumber(input.settlement.splitTotal) });
  r += 2;

  rows.push({ r, style: "band", merge: true, cells: pad([`PAYMENTS & SETTLEMENT  -  ${MONTHS_LONG[input.month - 1].toUpperCase()}`, null, null, null, null, null, null, "settlement"]) });
  r++;
  rows.push({ r, style: "header", cells: pad(["Sr.", "Person", "Status", "Share", "Paid", "Return (+) / To Pay (-)"]) });
  r++;
  const settleStart = r;
  units.forEach((u, i) => {
    const s = input.settlement.units.find((x) => x.unitId === u.id)!;
    const paid = input.paidByUnit.get(u.id);
    rows.push({
      r,
      style: i % 2 === 0 ? "settle" : "settleAlt",
      cells: pad([
        i + 1,
        text(u.code),
        `=IF(F${r}="","Not paid",IF(ROUND(G${r},0)=0,"Settled",IF(G${r}>0,"Gets back","To pay")))`,
        paisaToNumber(s.sharePaisa),
        paid === undefined ? null : paisaToNumber(paid),
        `=F${r}-E${r}`,
        null,
        `settle:${u.code}`,
      ]),
    });
    r++;
  });
  const settleEnd = r - 1;
  rows.push({
    r,
    style: "grand",
    cells: pad([null, "Totals:", null, `=SUM(E${settleStart}:E${settleEnd})`, `=SUM(F${settleStart}:F${settleEnd})`, `=SUM(G${settleStart}:G${settleEnd})`, null, "settle-total"]),
  });
  checks.push({ cell: `E${r}`, label: "Shares total", expected: paisaToNumber(input.settlement.totals.sharePaisa) });
  checks.push({ cell: `F${r}`, label: "Paid total", expected: paisaToNumber(input.settlement.totals.paidPaisa) });
  r += 2;

  const notes = [
    "Share (column E) is rounded to whole rupees so the three shares add up exactly to the split total; column G above keeps the exact figures.",
    "Settlement: Paid is the total of payments the administrator has approved in the app. Return (+) means they get money back; To Pay (-) means they still owe.",
    SYNC_NOTE,
  ];
  for (const n of notes) {
    rows.push({ r, style: "note", cells: pad([n]) });
    r++;
  }

  return {
    name: input.sheetName,
    rows,
    lastRow: r - 1,
    lastCol: "J",
    checks,
    columnWidths: { A: 3, B: 10, C: 28, D: 25, E: 20, F: 16.8, G: 16.8 },
    hiddenColumns: ["H:J"],
  };
}

function poolFraction(spec: SplitSpec, unitId: string): { num: bigint; den: bigint } | null {
  if (spec.type === "custom_amounts") {
    const total = spec.parts.reduce((a, p) => a + p.amountPaisa, 0n);
    const part = spec.parts.find((p) => p.unitId === unitId);
    if (!part || total === 0n || part.amountPaisa === 0n) return null;
    return reduce(part.amountPaisa, total);
  }
  const f = splitFractions(spec).get(unitId);
  return f && f.num !== 0n ? f : null;
}

function reduce(a: bigint, b: bigint) {
  let x = a;
  let y = b;
  while (y) [x, y] = [y, x % y];
  return { num: a / x, den: b / x };
}

export function ruleKeyFor(spec: SplitSpec, ruleCode: string | null, expenseId: string): string {
  if (ruleCode) return ruleCode;
  if (spec.type === "custom_amounts") return `CUSTOM-${expenseId.slice(0, 8)}`;
  return `X-${hash(splitKey(spec))}`;
}

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).toUpperCase();
}

export function sheetValues(layout: SheetLayout): Cell[][] {
  const out: Cell[][] = [];
  const byRow = new Map(layout.rows.map((row) => [row.r, row]));
  for (let r = 2; r <= layout.lastRow; r++) {
    out.push(byRow.get(r)?.cells ?? Array(COLS.length).fill(null));
  }
  return out;
}

// Kitchen sheets ------------------------------------------------------------

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function renderMenuValues(input: {
  slots: { week: number; weekday: number; fixed_category: string; dish: string }[];
  sabzi: string[];
}) {
  const grid: Cell[][] = WEEKDAYS.map((day, i) => {
    const wd = i + 1;
    const slot = (w: number) => input.slots.find((s) => s.week === w && s.weekday === wd);
    return [day, text(slot(1)?.fixed_category), text(slot(1)?.dish), text(slot(2)?.dish), text(slot(3)?.dish), text(slot(4)?.dish)];
  });
  const options: Cell[][] = [];
  for (let row = 0; row < 4; row++) {
    options.push(Array.from({ length: 6 }, (_, c) => text(input.sabzi[row * 6 + c])));
  }
  const summary: Cell[][] = WEEKDAYS.map((day, i) => {
    const dishes = [1, 2, 3, 4]
      .map((w) => input.slots.find((s) => s.week === w && s.weekday === i + 1)?.dish ?? "")
      .filter(Boolean);
    const unique = [...new Set(dishes)];
    return [day, text(unique.join("  /  "))];
  });
  return { grid, gridAddress: "B5:G11", options, optionsAddress: "B18:G21", summary, summaryAddress: "B23:C29" };
}

export function renderDutySheet(input: {
  sheetName: string;
  year: number;
  month: number;
  days: { day: string; breakfast: string | null; lunch: string | null; dinner: string | null; off: string | null }[];
  people: string[];
  notes: string[];
}): SheetLayout {
  const rows: SheetRow[] = [];
  let r = 2;
  rows.push({ r, style: "title", merge: true, cells: [`Kitchen Duties  -  ${input.days.length} Day Plan (${MONTHS_LONG[input.month - 1]} ${input.year})`, null, null, null, null, null] });
  r = 4;
  rows.push({ r, style: "header", cells: ["Date", "Day", "Breakfast", "Lunch", "Dinner", "Off Duty"] });
  r++;
  const first = r;
  input.days.forEach((d, i) => {
    const date = new Date(`${d.day}T00:00:00Z`);
    rows.push({
      r,
      style: i % 2 === 0 ? "item" : "itemAlt",
      cells: [excelSerial(date), WEEKDAYS[(date.getUTCDay() + 6) % 7], text(d.breakfast), text(d.lunch), text(d.dinner), text(d.off)],
    });
    r++;
  });
  const last = Math.max(first, r - 1);
  r++;
  rows.push({ r, style: "band", merge: true, cells: ["MEAL COUNT PER PERSON", null, null, null, null, null] });
  r++;
  const countStart = r;
  for (const p of input.people) {
    rows.push({ r, style: "share", cells: [text(p), `=COUNTIF($D$${first}:$F$${last},"${p.replace(/"/g, '""')}")`, "meals in the month", null, null, null] });
    r++;
  }
  rows.push({ r, style: "total", cells: ["Total", `=SUM(C${countStart}:C${Math.max(countStart, r - 1)})`, null, null, null, null] });
  const checks = [{ cell: `C${r}`, label: "Meals counted", expected: input.days.reduce((a, d) => a + [d.breakfast, d.lunch, d.dinner].filter((x) => x && input.people.includes(x)).length, 0) }];
  r += 2;
  for (const n of [...input.notes.map(text), SYNC_NOTE]) {
    rows.push({ r, style: "note", cells: [n, null, null, null, null, null] });
    r++;
  }
  return { name: input.sheetName, rows, lastRow: r - 1, lastCol: "G", checks, columnWidths: { A: 3, B: 12, C: 12, D: 14, E: 14, F: 14, G: 18 }, hiddenColumns: [] };
}

export function excelSerial(d: Date): number {
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86_400_000);
}
