import { formatPaisa, type Paisa } from "@/lib/finance/money";
import type { SettlementStatus } from "@/lib/finance/settlement";

export type SummaryInput = {
  monthLabel: string;
  sharedPaisa: Paisa;
  purseCode: string | null;
  units: { code: string; sharePaisa: Paisa; paidPaisa: Paisa; broughtForwardPaisa?: Paisa; balancePaisa: Paisa; status: SettlementStatus }[];
  /** The month balances were carried from, e.g. "October". */
  carriedFrom?: string | null;
  billsNotIssued: string[];
  pendingPayments: number;
  link: string | null;
};

function standing(u: SummaryInput["units"][number]) {
  switch (u.status) {
    case "settled":
      return "settled ✅";
    case "gets_back":
      return `gets back ${formatPaisa(u.balancePaisa)}`;
    case "to_pay":
      return `still to pay ${formatPaisa(-u.balancePaisa)}`;
    case "not_paid":
      return `not paid yet (${formatPaisa(u.sharePaisa)})`;
  }
}

/** A plain-text month summary in WhatsApp formatting (*bold*). */
export function buildMonthSummary(s: SummaryInput): string {
  const lines = [`*Ghar Hisaab · ${s.monthLabel}*`, `Shared spending: ${formatPaisa(s.sharedPaisa)}`, ""];
  for (const u of s.units) {
    const bf = u.broughtForwardPaisa ?? 0n;
    const carried =
      s.carriedFrom && (bf <= -50n || bf >= 50n) ? `${bf > 0n ? "extra" : "owed"} from ${s.carriedFrom} ${formatPaisa(bf > 0n ? bf : -bf)}, ` : "";
    lines.push(`*${u.code}*: ${carried}share ${formatPaisa(u.sharePaisa)}, paid ${formatPaisa(u.paidPaisa)}, ${standing(u)}`);
  }

  const owing = s.units.filter((u) => u.code !== s.purseCode && u.balancePaisa <= -50n);
  if (s.purseCode && owing.length) {
    lines.push("", `💰 Please pay ${s.purseCode}: ${owing.map((u) => `${u.code} ${formatPaisa(-u.balancePaisa)}`).join(", ")}`);
  }

  const notes: string[] = [];
  if (s.billsNotIssued.length) notes.push(`⏳ Not entered yet: ${s.billsNotIssued.join(", ")}. Shares will change when they are added.`);
  if (s.pendingPayments) notes.push(`🕓 ${s.pendingPayments} payment${s.pendingPayments === 1 ? "" : "s"} waiting for approval, not counted yet.`);
  if (notes.length) lines.push("", ...notes);
  if (s.link) lines.push("", `Details: ${s.link}`);
  return lines.join("\n");
}
