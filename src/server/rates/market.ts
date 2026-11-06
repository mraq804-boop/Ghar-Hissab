import "server-only";
import { cacheLife } from "next/cache";
import { POULTRY_PROMPT, POULTRY_SOURCE, parsePoultryReply, parseRateListPage, type PoultryRates } from "@/lib/utilities/poultry-rates";
import {
  COMMODITIES_PROMPT,
  COMMODITIES_SOURCE,
  VEGETABLES_PROMPT,
  VEGETABLES_SOURCE,
  parseCommoditiesReply,
  parseVegetablesReply,
  type CommodityRates,
  type VegetableRates,
} from "@/lib/utilities/market-rates";
import { readImageWithGemini } from "@/server/chat/gemini";

const UA = "GharHisaab/1.0 (family household app)";
type Kind = "poultry" | "vegetables" | "commodities";

const SOURCES: Record<Kind, { page: string; prompt: string; tokens: number }> = {
  poultry: { page: POULTRY_SOURCE, prompt: POULTRY_PROMPT, tokens: 512 },
  vegetables: { page: VEGETABLES_SOURCE, prompt: VEGETABLES_PROMPT, tokens: 8192 },
  commodities: { page: COMMODITIES_SOURCE, prompt: COMMODITIES_PROMPT, tokens: 8192 },
};

async function readPicture(kind: Kind, url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!res.ok) throw new Error(`${kind} picture ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > 6 * 1024 * 1024) throw new Error(`${kind} picture too large`);
  const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return readImageWithGemini(SOURCES[kind].prompt, { mimeType, base64: bytes.toString("base64") }, SOURCES[kind].tokens);
}

async function readPoultry(url: string, date: string): Promise<PoultryRates> {
  "use cache: remote";
  cacheLife("max");
  const r = parsePoultryReply(await readPicture("poultry", url), date);
  if (!r) throw new Error("poultry picture unreadable");
  return r;
}

async function readVegetables(url: string, date: string): Promise<VegetableRates> {
  "use cache: remote";
  cacheLife("max");
  const r = parseVegetablesReply(await readPicture("vegetables", url), date);
  if (!r) throw new Error("vegetables picture unreadable");
  return r;
}

async function readCommodities(url: string, date: string): Promise<CommodityRates> {
  "use cache: remote";
  cacheLife("max");
  const r = parseCommoditiesReply(await readPicture("commodities", url), date);
  if (!r) throw new Error("commodities picture unreadable");
  return r;
}

async function latest(kind: Kind, count: number) {
  const res = await fetch(SOURCES[kind].page, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!res.ok) throw new Error(`${kind} list ${res.status}`);
  return parseRateListPage(await res.text(), SOURCES[kind].page).slice(0, count);
}

async function settled<T>(jobs: Promise<T>[]): Promise<T[]> {
  return (await Promise.allSettled(jobs)).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

export type MarketRates = { poultry: PoultryRates[]; vegetables: VegetableRates[]; commodities: CommodityRates | null };

/**
 * Official Lahore market rates: chicken and eggs for the last 3 days, sabzi for the last 2 days, and the newest
 * essential commodities notice (mutton, beef, milk, daal). Each picture is read once; the lists are checked hourly.
 */
export async function getMarketRates(): Promise<MarketRates> {
  "use cache: remote";
  cacheLife("hours");
  const [poultryList, vegList, commList] = await Promise.all([
    latest("poultry", 3).catch(() => []),
    latest("vegetables", 2).catch(() => []),
    latest("commodities", 1).catch(() => []),
  ]);
  const [poultry, vegetables, commodities] = await Promise.all([
    settled(poultryList.map((e) => readPoultry(e.url, e.date))),
    settled(vegList.map((e) => readVegetables(e.url, e.date))),
    settled(commList.map((e) => readCommodities(e.url, e.date))),
  ]);
  if (!poultry.length && !vegetables.length && !commodities.length) throw new Error("no market rates read");
  return { poultry, vegetables, commodities: commodities[0] ?? null };
}
