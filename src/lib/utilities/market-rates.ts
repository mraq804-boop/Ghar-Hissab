export const VEGETABLES_SOURCE = "https://lahore.punjab.gov.pk/vegetables-rate-list";
export const COMMODITIES_SOURCE = "https://lahore.punjab.gov.pk/commodities-rate-list";

export type VegetableRates = { date: string; items: { name: string; first: number | null; second: number | null }[] };
export type CommodityRates = { date: string; items: { name: string; unit: string; wholesale: number | null; retail: number | null }[] };

export const VEGETABLES_PROMPT = `This picture is the official daily retail rate list for vegetables (sabzi) from the Market Committee Lahore, in Urdu, prices in rupees per kg.
The table has two halves side by side. Each row has a vegetable name, the first grade (اول) price and the second grade (دوم) price.
Read every row of both halves. For each vegetable give its common name in Roman Urdu followed by English in brackets, for example "Tamatar first grade (tomato)", "Aloo (potato)", "Pyaz (onion)", "Bhindi (okra)", "Adrak Thai (ginger, Thailand)".
Use null for a price shown as "-". Also read the date printed on it.
Reply only with JSON: {"date":"YYYY-MM-DD","items":[{"name":"...","first":120,"second":114}]}`;

export const COMMODITIES_PROMPT = `This picture is an official notification from the Deputy Commissioner Lahore fixing the prices of essential commodities, in Urdu.
Read every numbered item in the price tables. For each give: its name in English with the Roman Urdu name in brackets, for example "Mutton, bone-in (chhota gosht)", "Beef, bone-in (bara gosht)", "Milk (doodh)", "Flour 20 kg bag (atta)";
the unit as written (per kg, per litre, 20 kg bag, 100 gram, and so on); and the wholesale and retail prices as whole numbers, or null when shown as "--".
If one item has two sub-rows (i and ii), give each sub-row as its own item. Also read the notification date.
Translate the Urdu carefully: مسور is masoor, مونگ is moong, ماش is mash, چنا is chana, کالا چنا is black chana (kala chana), سفید چنا is white chana (safaid chana), بیسن is besan, چاول is rice, آٹا is flour, دودھ is milk, چھوٹا گوشت is mutton, بڑا گوشت is beef, ہڈی والا is bone-in.
Reply only with JSON: {"date":"YYYY-MM-DD","items":[{"name":"...","unit":"...","wholesale":200,"retail":210}]}`;

function json(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
}

const price = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || v === "-" || v === "--") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  if (typeof v === "string" && !/\d/.test(v)) return null;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : NaN;
};

const text = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Checks Gemini's reading of the vegetables picture; null when it doesn't look like a real list. */
export function parseVegetablesReply(reply: string, listedDate: string): VegetableRates | null {
  const d = json(reply) as { items?: unknown } | null;
  if (!d || !Array.isArray(d.items)) return null;
  const items = d.items.map((x) => {
    const r = x as { name?: unknown; first?: unknown; second?: unknown };
    return { name: text(r.name), first: price(r.first), second: price(r.second) };
  });
  const sane = (n: number | null) => n === null || (n >= 5 && n <= 5000);
  if (items.length < 15 || items.some((i) => !i.name || Number.isNaN(i.first) || Number.isNaN(i.second) || !sane(i.first) || !sane(i.second))) return null;
  if (items.some((i) => i.first !== null && i.second !== null && i.second > i.first)) return null;
  return { date: listedDate, items };
}

/** Checks Gemini's reading of the essential commodities notice; null when it doesn't look right. */
export function parseCommoditiesReply(reply: string, listedDate: string): CommodityRates | null {
  const d = json(reply) as { items?: unknown } | null;
  if (!d || !Array.isArray(d.items)) return null;
  const items = d.items.map((x) => {
    const r = x as { name?: unknown; unit?: unknown; wholesale?: unknown; retail?: unknown };
    return { name: text(r.name), unit: text(r.unit, 30), wholesale: price(r.wholesale), retail: price(r.retail) };
  });
  const sane = (n: number | null) => n === null || (n >= 1 && n <= 50_000);
  if (items.length < 5 || items.some((i) => !i.name || Number.isNaN(i.wholesale) || Number.isNaN(i.retail) || !sane(i.wholesale) || !sane(i.retail))) return null;
  if (!items.some((i) => i.retail !== null)) return null;
  return { date: listedDate, items };
}
