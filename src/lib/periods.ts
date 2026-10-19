export type Period = { id: string; year: number; month: number; status: "open" | "closed"; sheet_name: string | null };

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function periodLabel(p: Pick<Period, "year" | "month">, long = false) {
  return `${(long ? MONTHS_LONG : MONTHS)[p.month - 1]} ${p.year}`;
}

export function periodSlug(p: Pick<Period, "year" | "month">) {
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

export function parsePeriodSlug(slug: string | null | undefined) {
  const m = slug ? /^(\d{4})-(\d{2})$/.exec(slug) : null;
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null;
}

export function resolvePeriod<P extends Pick<Period, "year" | "month">>(periods: P[], slug?: string | null, now = new Date()): P | null {
  const wanted = parsePeriodSlug(slug);
  if (wanted) {
    const found = periods.find((p) => p.year === wanted.year && p.month === wanted.month);
    if (found) return found;
  }
  const current = periods.find((p) => p.year === now.getFullYear() && p.month === now.getMonth() + 1);
  return current ?? periods[0] ?? null;
}

export function sheetNameFor(p: Pick<Period, "year" | "month">) {
  return `Grocery List - ${MONTHS[p.month - 1]} ${p.year}`;
}
