import "server-only";
import { a1, SheetsClient, SheetsError, type SheetInfo } from "./google";
import { COLS, sheetValues, type Cell, type RowStyle, type SheetLayout } from "./layout";

const NAVY = "#1F4E78";
const BLUE = "#2F5597";
const ZEBRA = "#F2F5F9";
const TOTAL = "#D9E1F2";
const LINE = "#D9D9D9";

export class LayoutDriftError extends Error {}

type Ref = { spreadsheetId: string; sheet: SheetInfo };

const colIndex = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function grid(sheetId: number, range: string) {
  const m = /^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(range);
  if (!m) throw new Error(`Bad range ${range}`);
  const out: Record<string, number> = { sheetId, startColumnIndex: colIndex(m[1]), endColumnIndex: colIndex(m[3] ?? m[1]) + 1 };
  if (m[2]) {
    out.startRowIndex = Number(m[2]) - 1;
    out.endRowIndex = Number(m[4] ?? m[2]);
  }
  return out;
}

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}

export function typedValue(v: Cell): Record<string, unknown> {
  if (v === null || v === "") return {};
  if (typeof v === "number") return { userEnteredValue: { numberValue: v } };
  if (v.startsWith("=")) return { userEnteredValue: { formulaValue: v } };
  return { userEnteredValue: { stringValue: v.startsWith("'") ? v.slice(1) : v } };
}

function valueRows(values: Cell[][]) {
  return values.map((row) => ({ values: row.map(typedValue) }));
}

export async function ensureSheet(client: SheetsClient, spreadsheetId: string, title: string): Promise<SheetInfo & { created: boolean }> {
  const ss = await client.spreadsheet(spreadsheetId);
  const found = ss.sheets.find((s) => s.title.toLowerCase() === title.toLowerCase());
  if (found) return { ...found, created: false };
  const res = (await client.batchUpdate(spreadsheetId, [{ addSheet: { properties: { title } } }])) as {
    replies: { addSheet: { properties: { sheetId: number; title: string; gridProperties?: { rowCount: number; columnCount: number } } } }[];
  };
  const p = res.replies[0].addSheet.properties;
  return { sheetId: p.sheetId, title: p.title, rowCount: p.gridProperties?.rowCount ?? 1000, columnCount: p.gridProperties?.columnCount ?? 26, created: true };
}

export async function readUsed(client: SheetsClient, ref: Ref) {
  const [values] = await client.getValues(ref.spreadsheetId, [a1(ref.sheet.title, "A1:Z2000")]);
  return { row: values.length, cols: Math.max(0, ...values.map((r) => r.length)) };
}

export async function assertManagedSheet(client: SheetsClient, ref: Ref, kind: "money" | "duties") {
  const [values] = await client.getValues(ref.spreadsheetId, [a1(ref.sheet.title, "B2:C4")]);
  const title = String(values[0]?.[0] ?? "");
  const header = String(values[2]?.[0] ?? "");
  const ok = kind === "money" ? /grocery shopping list/i.test(title) && /^sr/i.test(header) : /kitchen duties/i.test(title) && /^date$/i.test(header);
  if (!ok) {
    throw new LayoutDriftError(
      `Sheet "${ref.sheet.title}" doesn't look like the one the app manages (title "${title.slice(0, 60)}"). It was not changed. Check it, or use Rebuild sheet on the Excel sync page.`,
    );
  }
}

export function layoutRequests(ref: Ref, layout: SheetLayout, previous: { row: number; cols: number }) {
  const id = ref.sheet.sheetId;
  const lastCol = layout.lastCol;
  const formatCol = layout.hiddenColumns.length ? "G" : lastCol;
  const lastColIdx = Math.max(colIndex(lastCol), previous.cols - 1);
  const clearRow = Math.max(previous.row, layout.lastRow) + 2;
  const reqs: unknown[] = [];

  if (ref.sheet.rowCount < clearRow) reqs.push({ appendDimension: { sheetId: id, dimension: "ROWS", length: clearRow - ref.sheet.rowCount } });
  if (ref.sheet.columnCount < colIndex(lastCol) + 1) {
    reqs.push({ appendDimension: { sheetId: id, dimension: "COLUMNS", length: colIndex(lastCol) + 1 - ref.sheet.columnCount } });
  }
  const clearRange = { sheetId: id, startRowIndex: 1, endRowIndex: clearRow, startColumnIndex: 1, endColumnIndex: Math.max(lastColIdx + 1, 2) };
  reqs.push({ unmergeCells: { range: clearRange } });
  reqs.push({ updateCells: { range: clearRange, fields: "userEnteredValue,userEnteredFormat" } });
  reqs.push({ updateDimensionProperties: { range: { sheetId: id, dimension: "COLUMNS", startIndex: 0, endIndex: colIndex(lastCol) + 1 }, properties: { hiddenByUser: false }, fields: "hiddenByUser" } });

  const values = sheetValues(layout).map((row) => row.slice(0, colIndex(lastCol)));
  reqs.push({
    updateCells: {
      start: { sheetId: id, rowIndex: 1, columnIndex: 1 },
      rows: valueRows(values),
      fields: "userEnteredValue",
    },
  });

  const repeat = (range: string, format: Record<string, unknown>, fields: string) =>
    reqs.push({ repeatCell: { range: grid(id, range), cell: { userEnteredFormat: format }, fields: `userEnteredFormat(${fields})` } });
  const fill = (range: string, color: string) => repeat(range, { backgroundColor: rgb(color) }, "backgroundColor");
  const font = (range: string, f: { family?: string; size?: number; bold?: boolean; italic?: boolean; color?: string }) =>
    repeat(
      range,
      { textFormat: { fontFamily: f.family ?? "Segoe UI", fontSize: f.size ?? 10, bold: !!f.bold, italic: !!f.italic, foregroundColor: rgb(f.color ?? "#000000") } },
      "textFormat",
    );
  const align = (range: string, h: "LEFT" | "CENTER" | "RIGHT") => repeat(range, { horizontalAlignment: h, verticalAlignment: "MIDDLE" }, "horizontalAlignment,verticalAlignment");
  const border = (range: string, edges: Record<string, { style: string; color: string }>) => {
    const b: Record<string, unknown> = { range: grid(id, range) };
    for (const [k, v] of Object.entries(edges)) b[k] = { style: v.style, color: rgb(v.color) };
    reqs.push({ updateBorders: b });
  };
  const rowHeight = (from: number, to: number, px: number) =>
    reqs.push({ updateDimensionProperties: { range: { sheetId: id, dimension: "ROWS", startIndex: from - 1, endIndex: to }, properties: { pixelSize: px }, fields: "pixelSize" } });

  for (const [col, width] of Object.entries(layout.columnWidths)) {
    const i = colIndex(col);
    reqs.push({ updateDimensionProperties: { range: { sheetId: id, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: Math.round(width! * 7 + 5) }, fields: "pixelSize" } });
  }
  for (const cols of layout.hiddenColumns) {
    const [a, b] = cols.split(":");
    reqs.push({ updateDimensionProperties: { range: { sheetId: id, dimension: "COLUMNS", startIndex: colIndex(a), endIndex: colIndex(b ?? a) + 1 }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } });
  }

  const table = layout.rows.filter((r) => r.style !== "note" && r.style !== "title");
  if (table.length) {
    const first = Math.min(...table.map((r) => r.r));
    const last = Math.max(...table.map((r) => r.r));
    font(`B${first}:${formatCol}${last}`, {});
    for (const [a, b] of segments(table.map((r) => r.r))) {
      const range = `B${a}:${formatCol}${b}`;
      fill(range, "#FFFFFF");
      const line = { style: "SOLID", color: LINE };
      border(range, { top: line, bottom: line, left: line, right: line, innerHorizontal: line, innerVertical: line });
      rowHeight(a, b, 27);
    }
    for (const r of table) {
      if (r.style === "itemAlt" || r.style === "settleAlt") fill(`B${r.r}:${formatCol}${r.r}`, ZEBRA);
      const h = pxHeight(r.style);
      if (h !== 27) rowHeight(r.r, r.r, h);
    }
    if (layout.hiddenColumns.length) {
      align(`B${first}:B${last}`, "CENTER");
      align(`C${first}:D${last}`, "LEFT");
      align(`E${first}:E${last}`, "CENTER");
      align(`F${first}:G${last}`, "RIGHT");
      repeat(`F${first}:G${last}`, { numberFormat: { type: "NUMBER", pattern: "#,##0" } }, "numberFormat");
    } else {
      align(`B${first}:${formatCol}${last}`, "CENTER");
      const dates = layout.rows.filter((r) => (r.style === "item" || r.style === "itemAlt") && typeof r.cells[0] === "number");
      if (dates.length) {
        repeat(`B${Math.min(...dates.map((d) => d.r))}:B${Math.max(...dates.map((d) => d.r))}`, { numberFormat: { type: "DATE", pattern: "dd-mmm-yyyy" } }, "numberFormat");
      }
    }
  }

  for (const r of layout.rows) {
    const range = `B${r.r}:${formatCol}${r.r}`;
    switch (r.style) {
      case "title":
        reqs.push({ mergeCells: { range: grid(id, range), mergeType: "MERGE_ALL" } });
        fill(range, NAVY);
        font(range, { size: 16, bold: true, color: "#FFFFFF" });
        align(range, "CENTER");
        rowHeight(r.r, r.r, 47);
        break;
      case "header":
        fill(range, BLUE);
        font(range, { size: 11, bold: true, color: "#FFFFFF" });
        align(range, "CENTER");
        border(range, { top: { style: "SOLID_MEDIUM", color: NAVY }, bottom: { style: "SOLID_MEDIUM", color: NAVY } });
        break;
      case "band":
        reqs.push({ mergeCells: { range: grid(id, range), mergeType: "MERGE_ALL" } });
        fill(range, NAVY);
        font(range, { size: 11, bold: true, color: "#FFFFFF" });
        align(range, "LEFT");
        break;
      case "total":
      case "grand":
        fill(range, TOTAL);
        font(range, { bold: true, color: NAVY });
        align(`C${r.r}:C${r.r}`, "RIGHT");
        if (r.style === "grand") border(range, { top: { style: "SOLID_MEDIUM", color: NAVY } });
        break;
      case "note":
        font(`B${r.r}:B${r.r}`, { family: "Calibri", italic: true, color: "#404040" });
        break;
      default:
        break;
    }
  }
  return reqs;
}

function pxHeight(style: RowStyle) {
  return style === "header" || style === "band" ? 32 : style === "total" || style === "grand" ? 29 : 27;
}

export function segments(rows: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const r of [...new Set(rows)].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && r === last[1] + 1) last[1] = r;
    else out.push([r, r]);
  }
  return out;
}

export async function writeLayout(client: SheetsClient, ref: Ref, layout: SheetLayout, previous: { row: number; cols: number }) {
  await client.batchUpdate(ref.spreadsheetId, layoutRequests(ref, layout, previous));
}

export async function writeValues(client: SheetsClient, ref: Ref, startCell: string, values: Cell[][]) {
  const g = grid(ref.sheet.sheetId, startCell);
  await client.batchUpdate(ref.spreadsheetId, [
    {
      updateCells: {
        start: { sheetId: ref.sheet.sheetId, rowIndex: g.startRowIndex, columnIndex: g.startColumnIndex },
        rows: valueRows(values),
        fields: "userEnteredValue",
      },
    },
  ]);
}

export async function verifyChecks(client: SheetsClient, ref: Ref, checks: SheetLayout["checks"]) {
  if (!checks.length) return;
  const results = await client.getValues(ref.spreadsheetId, checks.map((c) => a1(ref.sheet.title, c.cell)));
  const bad: string[] = [];
  checks.forEach((c, i) => {
    const raw = results[i]?.[0]?.[0];
    const actual = Number(raw);
    if (!Number.isFinite(actual) || Math.abs(actual - c.expected) > 0.005) bad.push(`${c.label} (${c.cell}) is ${raw ?? "empty"} in the sheet but ${c.expected} in the app`);
  });
  if (bad.length) throw new SheetsError(`Read-back check failed: ${bad.join("; ")}`, 422, "verification_failed", null);
}

export { COLS };
