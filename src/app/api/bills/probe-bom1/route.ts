import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const maxDuration = 60;
export const preferredRegion = "bom1";

function authorized(request: NextRequest, secret: string) {
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checks whether LESCO's bill site answers from this Vercel region. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorized(request, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  try {
    const res = await fetch("https://bill.pitc.com.pk/lescobill", { signal: AbortSignal.timeout(45_000), cache: "no-store" });
    return NextResponse.json({ region: process.env.VERCEL_REGION ?? "bom1", status: res.status, seconds: (Date.now() - started) / 1000 });
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } };
    return NextResponse.json({ region: process.env.VERCEL_REGION ?? "bom1", error: err.cause?.code ?? err.name ?? "failed", seconds: (Date.now() - started) / 1000 });
  }
}
