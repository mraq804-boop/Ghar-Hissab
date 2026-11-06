export const POULTRY_SOURCE = "https://lahore.punjab.gov.pk/poultry-rate-list";

export type PoultryRates = {
  date: string;
  farmGateLive: number;
  broilerLiveWholesale: number;
  broilerLiveRetail: number;
  broilerMeatRetail: number;
  eggsCrate: number;
  eggsDozen: number;
};

/** The dated picture links on the Lahore poultry rate list page, newest first, one per date. */
export function parseRateListPage(html: string, base = POULTRY_SOURCE): { date: string; url: string }[] {
  const out: { date: string; url: string }[] = [];
  const row = /<time datetime="(\d{4}-\d{2}-\d{2})T[^"]*"[\s\S]*?<a href="([^"]+\.(?:jpe?g|png|webp))"/gi;
  for (let m = row.exec(html); m; m = row.exec(html)) {
    if (out.some((x) => x.date === m![1])) continue;
    out.push({ date: m[1], url: new URL(m[2].replace(/&amp;/g, "&"), base).toString() });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export const POULTRY_PROMPT = `This picture is the official daily retail rate list for chicken from the Market Committee Lahore, written in Urdu.
Read the date printed on it (DD-MM-YYYY) and the six numbers in the rate column, from top to bottom:
1. farm gate live rate per kg, 2. broiler live wholesale per kg, 3. broiler live retail per kg, 4. broiler meat retail per kg,
5. farm eggs wholesale per crate (peti), 6. farm eggs retail per dozen.
Reply only with JSON: {"date":"YYYY-MM-DD","rates":[n1,n2,n3,n4,n5,n6]} using whole numbers.`;

/** Checks Gemini's reading of the picture; returns null when it doesn't look like a real rate list. */
export function parsePoultryReply(text: string, listedDate: string): PoultryRates | null {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  const d = data as { date?: unknown; rates?: unknown };
  if (!Array.isArray(d.rates) || d.rates.length !== 6) return null;
  const r = d.rates.map((n) => (typeof n === "number" ? n : Number(String(n).replace(/,/g, ""))));
  if (r.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  const [farmGateLive, broilerLiveWholesale, broilerLiveRetail, broilerMeatRetail, eggsCrate, eggsDozen] = r.map(Math.round);
  const perKg = [farmGateLive, broilerLiveWholesale, broilerLiveRetail, broilerMeatRetail];
  if (perKg.some((n) => n < 100 || n > 5000)) return null;
  if (broilerMeatRetail < broilerLiveRetail || broilerLiveRetail < farmGateLive) return null;
  if (eggsCrate < 1000 || eggsCrate > 100_000 || eggsDozen < 50 || eggsDozen > 5000) return null;
  const date = typeof d.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : listedDate;
  return { date, farmGateLive, broilerLiveWholesale, broilerLiveRetail, broilerMeatRetail, eggsCrate, eggsDozen };
}
