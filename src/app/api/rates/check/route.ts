import { NextResponse } from "next/server";
import { getContext, isAdmin } from "@/server/auth";
import { POULTRY_SOURCE, parseRateListPage } from "@/lib/utilities/poultry-rates";
import { COMMODITIES_SOURCE, VEGETABLES_SOURCE } from "@/lib/utilities/market-rates";
import { getMarketRates } from "@/server/rates/market";

export const maxDuration = 60;

export async function GET() {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return NextResponse.json({ error: "admins only" }, { status: 403 });

  const pages = await Promise.all(
    [POULTRY_SOURCE, VEGETABLES_SOURCE, COMMODITIES_SOURCE].map(async (url) => {
      const t0 = Date.now();
      try {
        const res = await fetch(url, { headers: { "User-Agent": "GharHisaab/1.0 (family household app)" }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
        const html = await res.text();
        const entries = parseRateListPage(html, url);
        let picture: number | string = "not tried";
        if (entries[0]) {
          const p = await fetch(entries[0].url, { headers: { "User-Agent": "GharHisaab/1.0 (family household app)" }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
          picture = p.status;
        }
        return { url, status: res.status, ms: Date.now() - t0, entries: entries.length, newest: entries[0]?.date ?? null, picture };
      } catch (e) {
        return { url, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: Date.now() - t0 };
      }
    }),
  );

  const t0 = Date.now();
  let rates: unknown;
  try {
    const r = await getMarketRates();
    rates = { ok: true, ms: Date.now() - t0, poultry: r.poultry.map((p) => p.date), vegetables: r.vegetables.map((v) => `${v.date} (${v.items.length} items)`), commodities: r.commodities?.date ?? null };
  } catch (e) {
    rates = { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({ region: process.env.VERCEL_REGION ?? "local", geminiKey: Boolean(process.env.GEMINI_API_KEY), pages, rates }, { headers: { "cache-control": "no-store" } });
}
