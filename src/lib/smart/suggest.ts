export type HistoryItem = {
  title: string;
  categoryId: string | null;
  sectionId: string;
  splitRuleId: string | null;
  splitOverride: { type: string; unitIds?: string[]; parts?: { unitId: string; percent?: number; amountPaisa?: string | number }[] } | null;
  amount: string | null;
  rate: string | null;
  qtyNum: string | null;
  qtyText: string | null;
  periodLabel: string;
};

export type CategoryLite = { id: string; name: string; section_id: string; default_split_rule_id: string | null; active: boolean };

export type QuickEntry = { name: string; qty: string | null; qtyLabel: string | null; amount: string | null };

export type Suggestion = {
  source: "history" | "category";
  title: string;
  categoryId: string | null;
  sectionId: string;
  splitRuleId: string | null;
  splitOverride: HistoryItem["splitOverride"];
  pricing: "amount" | "rate";
  qty: string | null;
  qtyText: string | null;
  rate: string | null;
  amount: string | null;
  last: { amount: string | null; rate: string | null; qtyNum: string | null; qtyText: string | null; periodLabel: string } | null;
};

const SYNONYMS: Record<string, string> = {
  doodh: "milk",
  dudh: "milk",
  murgi: "chicken",
  murghi: "chicken",
  murgh: "chicken",
  gosht: "mutton",
  qeema: "keema",
  qima: "keema",
  kima: "keema",
  sabzian: "sabzi",
  sabziyan: "sabzi",
  vegetables: "sabzi",
  vegetable: "sabzi",
  bijli: "wapda",
  electricity: "wapda",
  light: "wapda",
  pani: "water",
  wifi: "internet",
  net: "internet",
  rice: "chawal",
  cheeni: "chini",
  sugar: "chini",
  tel: "oil",
  chai: "tea",
  patti: "tea",
  masoor: "massar",
  surf: "sarf",
  detergent: "sarf",
  toothpaste: "colgate",
  pampers: "pamper",
  diaper: "pamper",
  diapers: "pamper",
  maasi: "maid",
  masi: "maid",
  atta: "aata",
  ata: "aata",
  anday: "eggs",
  ande: "eggs",
  anda: "eggs",
  egg: "eggs",
  tissues: "tissue",
};

const CATEGORY_HINTS: [RegExp, RegExp][] = [
  [/\b(milk|dahi|yogurt|lassi)\b/, /milk/i],
  [/\b(chicken|mutton|keema|beef|fish|meat|eggs)\b/, /chicken|meat/i],
  [/\b(sabzi|aloo|pyaz|tamatar|onion|potato|tomato|fruit)\b/, /vegetable|sabzi/i],
  [/\b(wapda)\b/, /electric|wapda/i],
  [/\b(gas)\b/, /^gas/i],
  [/\b(water)\b/, /^water/i],
  [/\b(internet|ptcl)\b/, /internet/i],
  [/\b(maid|driver|guard|cook|staff|salary)\b/, /staff|house help/i],
  [/\b(sarf)\b/, /detergent|sarf/i],
  [/\b(shampoo|soap|tissue|colgate|brush|pamper|lotion|cream)\b/, /toiletr/i],
  [/\b(repair|plumber|electrician|paint|carpenter|mistri)\b/, /maintenance|repair/i],
  [/\b(chini|chawal|oil|tea|aata|daal|dal|masala|ghee|namak|salt|massar|chane)\b/, /grocer/i],
];

const UNIT = "(kg|kgs|kilo|kilos|g|gm|gms|gram|grams|l|ltr|ltrs|litre|litres|liter|liters)";

function words(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

function canonical(text: string) {
  return words(text).map((w) => SYNONYMS[w] ?? w).join(" ");
}

function niceName(raw: string) {
  const t = raw.trim().replace(/\s+/g, " ");
  return t === t.toLowerCase() ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : t;
}

function trimNumber(n: number) {
  return String(Math.round(n * 1000) / 1000);
}

/** Splits "chicken 2kg" or "doodh 3000" into a name, a quantity and an amount. */
export function parseQuickEntry(text: string): QuickEntry {
  let rest = ` ${text} `;
  let qty: string | null = null;
  let qtyLabel: string | null = null;
  let amount: string | null = null;

  const qtyMatch = new RegExp(`\\s(\\d+(?:\\.\\d+)?)\\s*${UNIT}(?=\\s)`, "i").exec(rest);
  if (qtyMatch) {
    const n = Number(qtyMatch[1]);
    const grams = /^(g|gm|gms|gram|grams)$/i.test(qtyMatch[2]);
    qty = grams ? trimNumber(n / 1000) : trimNumber(n);
    qtyLabel = `${qty} ${/^(l|lt|ltr|ltrs|litre|litres|liter|liters)$/i.test(qtyMatch[2]) ? "L" : "Kg"}`;
    rest = rest.replace(qtyMatch[0], " ");
  }

  const amountMatch = /\s(?:rs\.?\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?(?:\s*(?:rs|rupees|\/-))?(?=\s)/i.exec(rest);
  if (amountMatch) {
    const n = Number(amountMatch[1].replace(/,/g, ""));
    if (n >= 10) {
      amount = String(n);
      rest = rest.replace(amountMatch[0], " ");
    }
  }

  return { name: niceName(rest), qty, qtyLabel, amount };
}

function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function similarity(query: string, title: string) {
  if (!query || !title) return 0;
  if (query === title) return 1;
  const qWords = query.split(" ");
  const tWords = title.split(" ");
  if (query.length >= 3 && (title.startsWith(query) || tWords.some((w) => w === query))) return 0.85;
  if (qWords.length > 0 && qWords.every((w) => tWords.includes(w))) return 0.8;
  const d = editDistance(query, title);
  if (query.length >= 4 && d === 1) return 0.75;
  if (query.length >= 7 && d === 2) return 0.7;
  if (tWords.some((w) => w.length >= 4 && query.length >= 4 && editDistance(query, w) <= 1)) return 0.65;
  return 0;
}

/**
 * Suggests category, split and price for a new expense from what the family entered before.
 * `history` must be newest first.
 */
export function suggestExpense(text: string, history: HistoryItem[], categories: CategoryLite[]): Suggestion | null {
  const entry = parseQuickEntry(text);
  const query = canonical(entry.name);
  if (query.length < 2) return null;

  let best: { item: HistoryItem; score: number } | null = null;
  for (const item of history) {
    const score = similarity(query, canonical(item.title));
    if (score > (best?.score ?? 0.6)) best = { item, score };
  }

  if (best) {
    const h = best.item;
    const byRate = h.rate !== null && entry.amount === null;
    return {
      source: "history",
      title: best.score === 1 || entry.name.length < 3 ? h.title : entry.name,
      categoryId: h.categoryId,
      sectionId: h.sectionId,
      splitRuleId: h.splitRuleId,
      splitOverride: h.splitOverride,
      pricing: byRate ? "rate" : "amount",
      qty: byRate ? entry.qty : null,
      qtyText: byRate ? null : entry.qtyLabel,
      rate: byRate ? h.rate : null,
      amount: entry.amount,
      last: { amount: h.amount, rate: h.rate, qtyNum: h.qtyNum, qtyText: h.qtyText, periodLabel: h.periodLabel },
    };
  }

  const active = categories.filter((c) => c.active);
  for (const [keywords, categoryName] of CATEGORY_HINTS) {
    if (!keywords.test(query)) continue;
    const c = active.find((x) => categoryName.test(x.name));
    if (!c) continue;
    return {
      source: "category",
      title: entry.name,
      categoryId: c.id,
      sectionId: c.section_id,
      splitRuleId: c.default_split_rule_id,
      splitOverride: null,
      pricing: "amount",
      qty: null,
      qtyText: entry.qtyLabel,
      rate: null,
      amount: entry.amount,
      last: null,
    };
  }
  return null;
}
