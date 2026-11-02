import { formatPaisa, type Paisa } from "./money";

/** "Rs 9,398 extra from October" or "Rs 7,865 owed from October"; null when nothing came across. */
export function broughtForwardText(broughtForwardPaisa: Paisa, fromMonth: string) {
  if (broughtForwardPaisa > -50n && broughtForwardPaisa < 50n) return null;
  return broughtForwardPaisa > 0n ? `${formatPaisa(broughtForwardPaisa)} extra from ${fromMonth}` : `${formatPaisa(-broughtForwardPaisa)} owed from ${fromMonth}`;
}

/** How a month's payments were used: "Rs 7,865 cleared October, Rs 2,135 for November". */
export function paymentUseText(paidPaisa: Paisa, clearedPreviousPaisa: Paisa, fromMonth: string, thisMonth: string) {
  if (clearedPreviousPaisa <= 0n) return null;
  const rest = paidPaisa - clearedPreviousPaisa;
  return rest > 0n ? `${formatPaisa(clearedPreviousPaisa)} cleared ${fromMonth}, ${formatPaisa(rest)} for ${thisMonth}` : `${formatPaisa(clearedPreviousPaisa)} went to clear ${fromMonth}`;
}

/** Share of this month covered by credit and payments, as a whole percent (0 to 100). */
export function coveredPercent(sharePaisa: Paisa, broughtForwardPaisa: Paisa, paidPaisa: Paisa) {
  if (sharePaisa <= 0n) return 0;
  const covered = broughtForwardPaisa + paidPaisa;
  if (covered <= 0n) return 0;
  return Math.min(100, Math.round((Number(covered) / Number(sharePaisa)) * 100));
}
