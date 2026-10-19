import ExcelJS from "exceljs";
import type { SectionKey } from "@/lib/household-defaults";

export type ParsedExpense = {
  section: SectionKey;
  title: string;
  notes: string | null;
  qtyText: string | null;
  qtyNum: number | null;
  rate: number | null;
  amount: number | null;
  category: string;
  rule: "POOL3" | "WAPDA" | "SARF" | "NONE";
  row: number;
};

export type ParsedWorkbook = {
  periodSheet: string;
  month: number;
  year: number;
  expenses: ParsedExpense[];
  paid: Record<string, number | null>;
  cached: Record<string, number>;
  menu: { week: number; weekday: number; fixedCategory: string; dish: string }[];
  sabzi: string[];
  menuNotes: string[];
  duties: { day: string; breakfast: string | null; lunch: string | null; dinner: string | null; off: string | null; offNote: string | null }[];
  dutyNotes: string[];
  dutyMonth: string | null;
  warnings: string[];
};

const BANDS: [RegExp, SectionKey][] = [
  [/^NOT SHARED/i, "NOT_SHARED"],
  [/^SHARED$/i, "SHARED"],
  [/^MILK, SABZI/i, "MILK_MEAT"],
  [/^HOUSE HELP/i, "HOUSE_HELP"],
  [/^BILLS/i, "BILLS"],
];

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

function val(c: ExcelJS.CellValue): string | number | null {
  if (c === null || c === undefined) return null;
  if (typeof c === "object") {
    if ("result" in c) return (c.result as string | number | null) ?? null;
    if ("richText" in c) return c.richText.map((r) => r.text).join("");
    if (c instanceof Date) return c.toISOString();
    return null;
  }
  return c as string | number;
}

const str = (c: ExcelJS.CellValue) => {
  const v = val(c);
  return v === null ? null : String(v).trim() || null;
};
const num = (c: ExcelJS.CellValue) => {
  const v = val(c);
  return typeof v === "number" ? v : v !== null && /^-?\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : null;
};

export function categorize(section: SectionKey, title: string, notes: string | null): { category: string; rule: ParsedExpense["rule"] } {
  const t = title.toLowerCase();
  if (section === "NOT_SHARED") return { category: "personal", rule: "NONE" };
  if (/\bsarf\b/.test(t) || /ab 1\/9/i.test(notes ?? "")) return { category: "detergent", rule: "SARF" };
  if (section === "BILLS") {
    if (/wapda|electric/.test(t) || /^split ak \+ ab$/i.test(notes?.trim() ?? "")) return { category: "electricity", rule: "WAPDA" };
    if (/gas/.test(t)) return { category: "gas", rule: "POOL3" };
    if (/water/.test(t)) return { category: "water", rule: "POOL3" };
    if (/internet|wifi/.test(t)) return { category: "internet", rule: "POOL3" };
    return { category: "other", rule: "POOL3" };
  }
  if (section === "HOUSE_HELP") return { category: "domestic_staff", rule: "POOL3" };
  if (section === "MILK_MEAT") {
    if (/milk|doodh/.test(t)) return { category: "milk", rule: "POOL3" };
    if (/sabzi|vegetable/.test(t)) return { category: "vegetables", rule: "POOL3" };
    return { category: "meat", rule: "POOL3" };
  }
  if (/colgate|shampoo|tissue|soap/.test(t)) return { category: "toiletries", rule: "POOL3" };
  return { category: "groceries", rule: "POOL3" };
}

export async function parseWorkbook(buffer: ArrayBuffer | Buffer, fallbackYear: number): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const warnings: string[] = [];
  const money = wb.getWorksheet("Grocery List");
  if (!money) throw new Error('The workbook has no "Grocery List" sheet.');

  const expenses: ParsedExpense[] = [];
  const cached: Record<string, number> = {};
  const paid: Record<string, number | null> = {};
  let section: SectionKey | null = null;
  let month = 0;
  let mode: "items" | "split" | "settle" | "notes" = "items";

  money.eachRow({ includeEmpty: false }, (row, r) => {
    const b = str(row.getCell("B").value);
    const c = str(row.getCell("C").value);
    const g = num(row.getCell("G").value);
    const band = b && BANDS.find(([re]) => re.test(b));
    if (band) {
      section = band[1];
      mode = "items";
      return;
    }
    if (b && /^SHARED SPLIT/i.test(b)) {
      mode = "split";
      section = null;
      return;
    }
    if (b && /^PAYMENTS & SETTLEMENT/i.test(b)) {
      mode = "settle";
      const m = MONTHS.findIndex((x) => b.toUpperCase().includes(x));
      if (m >= 0) month = m + 1;
      return;
    }
    if (c && /totals?:$/i.test(c)) {
      if (g !== null) cached[c.replace(/:$/, "")] = g;
      if (mode === "settle") {
        const e = num(row.getCell("E").value);
        const f = num(row.getCell("F").value);
        if (e !== null) cached["settle:share"] = e;
        if (f !== null) cached["settle:paid"] = f;
      }
      if (mode === "items") section = null;
      return;
    }
    if (mode === "items" && section && typeof num(row.getCell("B").value) === "number" && c) {
      const notes = str(row.getCell("D").value);
      const eRaw = row.getCell("E").value;
      const rate = num(row.getCell("F").value);
      const qtyNum = rate !== null ? num(eRaw) : null;
      const { category, rule } = categorize(section, c, notes);
      expenses.push({
        section,
        title: c,
        notes: notes && !/^shared$/i.test(notes) ? notes : null,
        qtyText: rate !== null ? null : (str(eRaw) ?? null),
        qtyNum,
        rate,
        amount: g,
        category,
        rule,
        row: r,
      });
      return;
    }
    if (mode === "split" && c && g !== null) {
      cached[`split:${c.replace(/:$/, "")}`] = g;
      return;
    }
    if (mode === "settle" && c && /^[A-Z0-9]{1,8}$/.test(c)) {
      paid[c] = num(row.getCell("F").value);
      const e = num(row.getCell("E").value);
      if (e !== null) cached[`settle:${c}`] = e;
    }
  });

  const menu: ParsedWorkbook["menu"] = [];
  const sabzi: string[] = [];
  const menuNotes: string[] = [];
  const food = wb.getWorksheet("Weekly Food Schedule");
  if (food) {
    for (let r = 5; r <= 11; r++) {
      const row = food.getRow(r);
      const fixed = str(row.getCell("C").value) ?? "";
      for (let w = 1; w <= 4; w++) {
        menu.push({ week: w, weekday: r - 4, fixedCategory: fixed, dish: str(row.getCell(String.fromCharCode(67 + w)).value) ?? "" });
      }
    }
    for (let r = 18; r <= 21; r++) for (const col of ["B", "C", "D", "E", "F", "G"]) {
      const s = str(food.getRow(r).getCell(col).value);
      if (s) sabzi.push(s);
    }
    for (const r of [13, 14, 15, 16]) {
      const s = str(food.getRow(r).getCell("B").value);
      if (s) menuNotes.push(s);
    }
  } else warnings.push('No "Weekly Food Schedule" sheet found; the menu was not imported.');

  const duties: ParsedWorkbook["duties"] = [];
  const dutyNotes: string[] = [];
  let dutyMonth = null as string | null;
  const kd = wb.getWorksheet("Kitchen Duties");
  if (kd) {
    kd.eachRow({ includeEmpty: false }, (row) => {
      const d = row.getCell("B").value;
      const date = d instanceof Date ? d : typeof d === "number" ? new Date(Date.UTC(1899, 11, 30) + d * 86_400_000) : null;
      if (date && !Number.isNaN(date.getTime())) {
        const day = date.toISOString().slice(0, 10);
        dutyMonth ??= day.slice(0, 7);
        const offRaw = str(row.getCell("G").value);
        const m = offRaw ? /^(\S+)\s*\((.+)\)$/.exec(offRaw) : null;
        duties.push({
          day,
          breakfast: str(row.getCell("D").value),
          lunch: str(row.getCell("E").value),
          dinner: str(row.getCell("F").value),
          off: m ? m[1] : offRaw,
          offNote: m ? m[2].trim() : null,
        });
      }
      const b = str(row.getCell("B").value);
      if (b && b.length > 40 && !/kitchen duties/i.test(b)) dutyNotes.push(b);
    });
  } else warnings.push('No "Kitchen Duties" sheet found; the roster was not imported.');

  if (!month) {
    month = Number(dutyMonth?.slice(5, 7)) || 1;
    warnings.push("Could not read the month from the settlement title; used the duty roster month.");
  }
  const year = dutyMonth && Number(dutyMonth.slice(5, 7)) === month ? Number(dutyMonth.slice(0, 4)) : fallbackYear;
  return { periodSheet: money.name, month, year, expenses, paid, cached, menu, sabzi, menuNotes, duties, dutyNotes, dutyMonth, warnings };
}
