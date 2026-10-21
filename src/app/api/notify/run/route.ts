import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runScheduled } from "@/server/notify/run";
import { createSupabaseAdmin } from "@/server/supabase/admin";

export const maxDuration = 60;

function authorized(request: NextRequest, secret: string) {
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: "notifications not configured" }, { status: 503 });
  if (!authorized(request, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runScheduled(createSupabaseAdmin()));
}

export const GET = handle;
export const POST = handle;
