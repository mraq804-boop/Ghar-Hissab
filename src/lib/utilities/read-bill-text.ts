export type BillTextRead = {
  billMonth: string | null;
  dueDate: string | null;
  payable: number | null;
  afterDue: number | null;
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const pad = (n: number) => String(n).padStart(2, "0");
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
const mon = (m: string) => MONTHS.indexOf(m.slice(0, 3).toUpperCase()) + 1;

const DATES = /\b\d{1,2}[\s\-./]+[A-Za-z]{3,9}[\s\-./,]+(?:\d{4}|\d{2})\b|\b\d{1,2}[\-./]\d{1,2}[\-./](?:\d{4}|\d{2})\b/g;
const MONTHS_IN = /\b[A-Za-z]{3,9}[\s\-./,]+(?:\d{4}|\d{2})\b/g;
const AMOUNTS = /\d{1,3}(?:[,.]\d{3})+(?!\d)|\d{2,7}/g;

function dateIn(s: string): string | null {
  let m = /\b(\d{1,2})[\s\-./]+([A-Za-z]{3,9})[\s\-./,]+(\d{4}|\d{2})\b/.exec(s);
  if (m && mon(m[2]) > 0) return `${year(m[3])}-${pad(mon(m[2]))}-${pad(Number(m[1]))}`;
  m = /\b(\d{1,2})[\-./](\d{1,2})[\-./](\d{4}|\d{2})\b/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) <= 31) return `${year(m[3])}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return null;
}

function monthIn(s: string): string | null {
  const m = /\b([A-Za-z]{3,9})[\s\-./,]+(\d{4}|\d{2})\b/.exec(s);
  return m && mon(m[1]) > 0 ? `${year(m[2])}-${pad(mon(m[1]))}` : null;
}

const toAmount = (s: string) => Number(s.replace(/[,.]/g, ""));

function amountIn(s: string): number | null {
  const m = s.replace(DATES, " ").match(AMOUNTS);
  return m ? toAmount(m[0]) : null;
}

type Kind = "month" | "date" | "amount";
const FIELDS: { key: keyof BillTextRead | null; kind: Kind; label: RegExp }[] = [
  { key: "billMonth", kind: "month", label: /bill(?:ing)?\s+month|month\s+of\s+bill/i },
  { key: null, kind: "date", label: /issue\s+date|reading\s+date|bill\s+date/i },
  { key: "dueDate", kind: "date", label: /(?<!within |after )due\s+date/i },
  { key: "payable", kind: "amount", label: /(?:amount\s+)?payable\s+within\s+due\s+date|net\s+payable|total\s+payable/i },
  { key: "afterDue", kind: "amount", label: /(?:amount\s+)?payable\s+after\s+due\s+date/i },
];

function valuesIn(line: string): Record<Kind, (string | number)[]> {
  const date = (line.match(DATES) ?? []).map(dateIn).filter((d) => d !== null);
  const rest = line.replace(DATES, " ");
  const months = (rest.match(MONTHS_IN) ?? []).filter((m) => monthIn(m) !== null);
  const amount = months.reduce((s, m) => s.replace(m, " "), rest).match(AMOUNTS)?.map(toAmount) ?? [];
  return { month: months.map((m) => monthIn(m)!), date, amount };
}

/** Bills often print headings side by side with their values in the row below; pairs them up by position. */
function readTables(lines: string[]): Partial<BillTextRead> {
  const found: Partial<BillTextRead> = {};
  for (let i = 0; i < lines.length - 1; i++) {
    let rest = lines[i];
    const hits: { field: (typeof FIELDS)[number]; at: number }[] = [];
    for (const field of FIELDS) {
      const m = field.label.exec(rest);
      if (!m) continue;
      hits.push({ field, at: m.index });
      rest = rest.slice(0, m.index) + " ".repeat(m[0].length) + rest.slice(m.index + m[0].length);
    }
    if (hits.length < 2 || /\d/.test(rest)) continue;
    const values = valuesIn(lines[i + 1]);
    for (const kind of ["month", "date", "amount"] as const) {
      const labels = hits.filter((h) => h.field.kind === kind).sort((a, b) => a.at - b.at);
      if (!labels.length || labels.length !== values[kind].length) continue;
      labels.forEach((h, j) => {
        if (h.field.key && found[h.field.key] === undefined) Object.assign(found, { [h.field.key]: values[kind][j] });
      });
    }
  }
  return found;
}

function afterLabel<T>(lines: string[], label: RegExp, read: (s: string) => T | null): T | null {
  for (let i = 0; i < lines.length; i++) {
    const hit = label.exec(lines[i]);
    if (!hit) continue;
    const rest = lines[i].slice(hit.index + hit[0].length);
    const v = read(rest) ?? (lines[i + 1] !== undefined ? read(lines[i + 1]) : null);
    if (v !== null) return v;
  }
  return null;
}

/** Reads month, due date and amounts from the text of a gas or water bill photo or screenshot. */
export function readBillText(text: string): BillTextRead {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").replace(/\b0(?=CT\b|ct\b)/g, "O").trim())
    .filter(Boolean);
  const table = readTables(lines);
  const payable =
    table.payable ??
    afterLabel(lines, /(?:amount\s+)?payable\s+within\s+due\s+date|within\s+due\s+date|net\s+payable|total\s+payable|amount\s+payable(?!\s+after)/i, amountIn);
  const afterDue = table.afterDue ?? afterLabel(lines, /(?:amount\s+)?payable\s+after\s+due\s+date|after\s+due\s+date/i, amountIn);
  const dueDate = table.dueDate ?? afterLabel(lines, /(?<!within |after )due\s+date/i, dateIn);
  const billMonth =
    table.billMonth ?? afterLabel(lines, /bill(?:ing)?\s+month|month\s+of\s+bill|bill\s+for/i, monthIn) ?? (dueDate ? dueDate.slice(0, 7) : null);
  return { billMonth, dueDate, payable, afterDue };
}

/** Turns a bill web page into plain lines of text for readBillText. */
export function htmlToLines(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(td|th|div|p|li|tr|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
