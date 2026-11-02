import type { LescoBill } from "@/lib/lesco/parse";
import { htmlToLines, readBillText } from "./read-bill-text";

export type SngplPage =
  | { ok: true; bill: Omit<LescoBill, "referenceNo"> }
  | { ok: false; reason: "wrong_code" | "not_found" | "other_consumer" | "unreadable" };

/** Reads the page SNGPL returns after the consumer number and picture code are sent. */
export function readSngplPage(html: string, consumer: string): SngplPage {
  const read = readBillText(htmlToLines(html));
  if (read.payable && read.billMonth) {
    if (!html.replace(/\D/g, "").includes(consumer)) return { ok: false, reason: "other_consumer" };
    return {
      ok: true,
      bill: {
        billMonth: read.billMonth,
        readingDate: null,
        issueDate: null,
        dueDate: read.dueDate,
        units: null,
        payable: read.payable,
        currentBill: null,
        latePayments: read.afterDue ? [{ until: null, amount: read.afterDue }] : [],
        previousReading: null,
        presentReading: null,
        history: [],
      },
    };
  }
  if (/txtCaptcha|captchaimg/i.test(html) || /captcha[^<]{0,40}(invalid|incorrect|wrong|not match)|(invalid|incorrect|wrong)[^<]{0,40}captcha/i.test(html)) return { ok: false, reason: "wrong_code" };
  if (/no record|not found|invalid consumer|record does not exist/i.test(html)) return { ok: false, reason: "not_found" };
  return { ok: false, reason: "unreadable" };
}
