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

function amountIn(s: string): number | null {
  const m = /(?:Rs\.?|PKR)?\s*(\d{1,3}(?:,\d{3})+|\d{2,7})(?:\.\d{1,2})?\b/i.exec(s);
  return m ? Number(m[1].replace(/,/g, "")) : null;
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
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const payable =
    afterLabel(lines, /(?:amount\s+)?payable\s+within\s+due\s+date|within\s+due\s+date|net\s+payable|total\s+payable|amount\s+payable(?!\s+after)/i, amountIn);
  const afterDue = afterLabel(lines, /(?:amount\s+)?payable\s+after\s+due\s+date|after\s+due\s+date/i, amountIn);
  const dueDate = afterLabel(lines, /due\s+date/i, dateIn);
  const billMonth = afterLabel(lines, /bill(?:ing)?\s+month|month\s+of\s+bill|bill\s+for/i, monthIn) ?? (dueDate ? dueDate.slice(0, 7) : null);
  return { billMonth, dueDate, payable, afterDue };
}
