export type LescoBill = {
  referenceNo: string;
  billMonth: string;
  readingDate: string | null;
  issueDate: string | null;
  dueDate: string | null;
  units: number | null;
  payable: number;
  currentBill: number | null;
  latePayments: { until: string | null; amount: number }[];
  previousReading: number | null;
  presentReading: number | null;
  history: { month: string; units: number; bill: number | null; payment: number | null }[];
};

export type LescoParseResult = { ok: true; bill: LescoBill } | { ok: false; reason: "captcha" | "not_found" | "unreadable" };

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function toText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function after(text: string, label: string, pattern: RegExp, within = 160) {
  const i = text.indexOf(label);
  if (i < 0) return null;
  return pattern.exec(text.slice(i + label.length, i + label.length + within));
}

function month(mon: string) {
  const m = MONTHS.indexOf(mon.toUpperCase());
  return m < 0 ? null : m + 1;
}

const pad = (n: number) => String(n).padStart(2, "0");

function date(m: RegExpExecArray | null) {
  if (!m) return null;
  const mm = month(m[2]);
  return mm ? `20${m[3]}-${pad(mm)}-${pad(Number(m[1]))}` : null;
}

const amount = (s: string) => Number(s.replace(/,/g, ""));

/** Reads the figures from a bill page of bill.pitc.com.pk/lescobill. */
export function parseLescoBill(html: string): LescoParseResult {
  const text = toText(html);
  if (!text.includes("BILL MONTH")) {
    if (/<img[^>]*captcha|name="[^"]*captcha/i.test(html)) return { ok: false, reason: "captcha" };
    return { ok: false, reason: /search your electricity bill|not found|invalid/i.test(text) ? "not_found" : "unreadable" };
  }

  const bm = after(text, "BILL MONTH", /\b([A-Z]{3})\s+(\d{2})\b/);
  const billMonthNum = bm ? month(bm[1]) : null;
  const payableM = after(text, "PAYABLE WITHIN DUE DATE", /\b(\d[\d,]*)\b/, 120);
  if (!bm || !billMonthNum || !payableM) return { ok: false, reason: "unreadable" };

  const dueDate = date(after(text, "DUE DATE", /\b(\d{2})\s+([A-Z]{3})\s+(\d{2})\b/));
  const refM = after(text, "REFERENCE NO", /\b(\d{2})\s*(\d{5})\s*(\d{7})(?:\s*U|\s*R)?\b/, 120);
  const unitsM = /UNITS<\/span>[\s\S]{0,200}?class="val-space">\s*(\d+)/i.exec(html);
  const currentM = /Current Bill<\/span>[\s\S]{0,200}?charges-bd-val">\s*([\d,]+)/i.exec(html);
  const readingAfter = (label: string) => {
    const m = new RegExp(`${label}<\\/span>[\\s\\S]{0,200}?class="val-space">\\s*(\\d+)`, "i").exec(html);
    return m ? Number(m[1]) : null;
  };

  const history: LescoBill["history"] = [];
  for (const chunk of html.split(/<div class="history-row">/i).slice(1)) {
    const cells = [...chunk.matchAll(/<div class="history-cell">([\s\S]*?)<\/div>/gi)].slice(0, 5).map((c) => c[1].replace(/<[^>]+>/g, "").trim());
    const mm = /^([A-Z]{3})(\d{2})$/i.exec(cells[0] ?? "");
    const mon = mm ? month(mm[1]) : null;
    if (!mm || !mon || !/^\d+$/.test(cells[2] ?? "")) continue;
    history.push({
      month: `20${mm[2]}-${pad(mon)}`,
      units: Number(cells[2]),
      bill: cells[3] && /^[\d,]+$/.test(cells[3]) ? amount(cells[3]) : null,
      payment: cells[4] && /^[\d,]+$/.test(cells[4]) ? amount(cells[4]) : null,
    });
  }

  const latePayments: LescoBill["latePayments"] = [];
  const lateText = after(text, "PAYABLE AFTER DUE DATE", /([\s\S]*)/, 200)?.[1] ?? "";
  for (const m of lateText.matchAll(/\b(Till|After)\s+(\d{1,2})\S*\s+([\d,]+)/g)) {
    let until: string | null = null;
    if (m[1] === "Till" && dueDate) {
      const [y, mo, d] = dueDate.split("-").map(Number);
      const day = Number(m[2]);
      const next = day < d ? new Date(Date.UTC(y, mo, day)) : new Date(Date.UTC(y, mo - 1, day));
      until = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
    }
    latePayments.push({ until, amount: amount(m[3]) });
    if (latePayments.length === 2) break;
  }

  return {
    ok: true,
    bill: {
      referenceNo: refM ? `${refM[1]}${refM[2]}${refM[3]}` : "",
      billMonth: `20${bm[2]}-${pad(billMonthNum)}`,
      readingDate: date(after(text, "READING DATE", /\b(\d{2})\s+([A-Z]{3})\s+(\d{2})\b/)),
      issueDate: date(after(text, "ISSUE DATE", /\b(\d{2})\s+([A-Z]{3})\s+(\d{2})\b/)),
      dueDate,
      units: unitsM ? Number(unitsM[1]) : null,
      payable: amount(payableM[1]),
      currentBill: currentM ? amount(currentM[1]) : null,
      latePayments,
      previousReading: readingAfter("PREVIOUS READING"),
      presentReading: readingAfter("PRESENT READING"),
      history,
    },
  };
}
