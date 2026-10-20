import { formatPaisa, parseRupeesToPaisa } from "@/lib/finance/money";

export type ReadMethod = "jazzcash" | "easypaisa" | "raast" | "bank_transfer";

export type PaymentRead = {
  amount: string | null;
  paidOn: string | null;
  reference: string | null;
  method: ReadMethod | null;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const NUMBER = String.raw`(\d{1,3}(?:[,\s]\d{3})+|\d+)(?:\.(\d{1,2}))?`;
const AMOUNT_KEYWORDS = /\b(amount|total|sent|paid|transfer(?:red)?|payment|debited|send)\b/i;
const NOT_AMOUNT = /\b(fee|fees|charges?|balance|available|limit|tax|cashback|discount|commission)\b/i;

function toDecimal(whole: string, frac: string | undefined): string | null {
  const digits = whole.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(digits) || digits.length > 9) return null;
  try {
    const paisa = parseRupeesToPaisa(`${digits}.${(frac ?? "00").padEnd(2, "0")}`);
    if (paisa <= 0n) return null;
    return `${paisa / 100n}.${(paisa % 100n).toString().padStart(2, "0")}`;
  } catch {
    return null;
  }
}

function findAmount(lines: string[]): string | null {
  const candidates: { value: string; score: number; index: number }[] = [];
  lines.forEach((line, index) => {
    if (NOT_AMOUNT.test(line)) return;
    const currency = new RegExp(String.raw`(?:rs\.?|pkr|rupees)\s*:?\s*${NUMBER}`, "gi");
    for (const m of line.matchAll(currency)) {
      const value = toDecimal(m[1], m[2]);
      if (value) candidates.push({ value, score: 2 + (AMOUNT_KEYWORDS.test(line) ? 2 : 0), index });
    }
    if (/\bamount\b/i.test(line) && !currency.test(line)) {
      const m = new RegExp(String.raw`amount[^\d]{0,15}${NUMBER}`, "i").exec(line);
      const value = m && toDecimal(m[1], m[2]);
      if (value) candidates.push({ value, score: 3, index });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.value ?? null;
}

const REF_LABELS: [RegExp, number][] = [
  [/\b(?:TID|Trx\.?\s*ID|Txn\.?\s*ID|Transaction\s*(?:ID|No\.?|Number|Ref(?:erence)?(?:\s*No\.?)?))/i, 3],
  [/\b(?:Reference|Ref\.?)\s*(?:No\.?|Number|ID)?/i, 2],
  [/\b(?:RRN|STAN)\b/i, 1],
];

function findReference(lines: string[]): string | null {
  let best: { value: string; score: number } | null = null;
  for (const line of lines) {
    for (const [label, score] of REF_LABELS) {
      const m = new RegExp(label.source + String.raw`\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\- ]{4,34})`, "i").exec(line);
      if (!m) continue;
      const value = m[1].replace(/[\s-]+/g, "").toUpperCase();
      if (value.length < 6 || value.length > 30 || !/\d/.test(value)) continue;
      if (!best || score > best.score) best = { value, score };
    }
  }
  return best?.value ?? null;
}

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function findDate(text: string): string | null {
  const patterns: [RegExp, (m: RegExpExecArray) => string | null][] = [
    [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, (m) => isoDate(+m[1], +m[2], +m[3])],
    [/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/, (m) => isoDate(+m[3], +m[2], +m[1])],
    [/\b(\d{1,2})[\s\-]+([A-Za-z]{3,9})[,\s\-]+(\d{4})\b/, (m) => (MONTHS[m[2].slice(0, 3).toLowerCase()] ? isoDate(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]) : null)],
    [/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/, (m) => (MONTHS[m[1].slice(0, 3).toLowerCase()] ? isoDate(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]) : null)],
  ];
  let first: { index: number; value: string } | null = null;
  for (const [re, toIso] of patterns) {
    const g = new RegExp(re.source, "g");
    for (const m of text.matchAll(g)) {
      const value = toIso(m as unknown as RegExpExecArray);
      if (value && (!first || (m.index ?? 0) < first.index)) first = { index: m.index ?? 0, value };
    }
  }
  return first?.value ?? null;
}

function findMethod(text: string): ReadMethod | null {
  const t = text.toLowerCase();
  if (/jazz\s*cash/.test(t)) return "jazzcash";
  if (/easy\s*paisa/.test(t)) return "easypaisa";
  if (/\braast\b/.test(t)) return "raast";
  if (/\b(ibft|funds?\s*transfer|account|iban|bank|hbl|ubl|mcb|meezan|alfalah|faysal|askari|allied|js\s*bank|sadapay|nayapay)\b/.test(t)) return "bank_transfer";
  return null;
}

export function parsePaymentText(text: string): PaymentRead {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { amount: findAmount(lines), paidOn: findDate(text), reference: findReference(lines), method: findMethod(text) };
}

export type CheckResult = { field: "amount" | "date" | "reference"; status: "match" | "mismatch" | "unread"; message: string };

const norm = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const niceDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function compareWithScreenshot(read: PaymentRead, entered: { amount: string; paidOn: string; reference: string | null }): CheckResult[] {
  const out: CheckResult[] = [];
  const enteredPaisa = parseRupeesToPaisa(entered.amount);
  if (!read.amount) out.push({ field: "amount", status: "unread", message: "Couldn't read the amount from the screenshot" });
  else {
    const shot = parseRupeesToPaisa(read.amount);
    out.push(
      shot === enteredPaisa
        ? { field: "amount", status: "match", message: `Amount matches the screenshot (${formatPaisa(shot, { decimals: shot % 100n !== 0n })})` }
        : { field: "amount", status: "mismatch", message: `Screenshot shows ${formatPaisa(shot, { decimals: shot % 100n !== 0n })} but ${formatPaisa(enteredPaisa, { decimals: enteredPaisa % 100n !== 0n })} was entered` },
    );
  }
  if (!read.paidOn) out.push({ field: "date", status: "unread", message: "Couldn't read the date from the screenshot" });
  else
    out.push(
      read.paidOn === entered.paidOn
        ? { field: "date", status: "match", message: `Date matches (${niceDate(read.paidOn)})` }
        : { field: "date", status: "mismatch", message: `Screenshot is dated ${niceDate(read.paidOn)} but ${niceDate(entered.paidOn)} was entered` },
    );
  if (!read.reference) out.push({ field: "reference", status: "unread", message: "Couldn't read a transaction ID from the screenshot" });
  else if (!entered.reference) out.push({ field: "reference", status: "mismatch", message: `Screenshot has transaction ID ${read.reference} but none was entered` });
  else {
    const a = norm(read.reference);
    const b = norm(entered.reference);
    out.push(
      a === b || (b.length >= 6 && (a.includes(b) || b.includes(a)))
        ? { field: "reference", status: "match", message: "Transaction ID matches" }
        : { field: "reference", status: "mismatch", message: `Screenshot has transaction ID ${read.reference} but ${entered.reference} was entered` },
    );
  }
  return out;
}
