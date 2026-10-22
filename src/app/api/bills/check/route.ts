import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { checkAllMeters } from "@/server/lesco/check";
import { onBillArrived } from "@/server/notify/events";
import { createSupabaseAdmin } from "@/server/supabase/admin";

export const maxDuration = 300;

function authorized(request: NextRequest, secret: string) {
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: "bill check not configured" }, { status: 503 });
  if (!authorized(request, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
  const results = await checkAllMeters(createSupabaseAdmin(), today, 270_000, { onNewBill: onBillArrived });
  return NextResponse.json({ checked: results.length, results });
}

export const GET = handle;
export const POST = handle;
