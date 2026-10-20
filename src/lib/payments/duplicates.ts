import { formatPaisa, parseRupeesToPaisa } from "@/lib/finance/money";

export type PaymentLike = {
  id: string;
  payerCode: string;
  amount: string;
  paidOn: string;
  reference: string | null;
  status: "pending" | "approved" | "rejected";
  shas: string[];
};

const normRef = (r: string | null) => (r ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Warnings shown to the administrator before approving. Rejected payments are ignored. */
export function duplicateWarnings(payments: PaymentLike[]): Map<string, string[]> {
  const live = payments.filter((p) => p.status !== "rejected");
  const out = new Map<string, string[]>();
  for (const p of live) {
    const warnings: string[] = [];
    const others = live.filter((o) => o.id !== p.id);
    const ref = normRef(p.reference);
    const sameRef = ref.length >= 4 ? others.find((o) => normRef(o.reference) === ref) : undefined;
    if (sameRef) {
      warnings.push(`Transaction ID ${p.reference} is also on ${sameRef.payerCode}'s payment of ${formatPaisa(parseRupeesToPaisa(sameRef.amount))} on ${day(sameRef.paidOn)}`);
    }
    const twin = others.find((o) => o.payerCode === p.payerCode && o.paidOn === p.paidOn && parseRupeesToPaisa(o.amount) === parseRupeesToPaisa(p.amount));
    if (twin && twin !== sameRef) {
      warnings.push(`${p.payerCode} has another payment of the same amount on the same day (${day(p.paidOn)}). It may have been entered twice.`);
    }
    if (p.shas.some((s) => others.some((o) => o.shas.includes(s)))) {
      warnings.push("This exact screenshot is attached to another payment. Check it isn't being counted twice.");
    }
    if (warnings.length) out.set(p.id, warnings);
  }
  return out;
}
