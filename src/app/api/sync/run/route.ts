import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runSyncWorker } from "@/server/excel/worker";

export const maxDuration = 60;

function authorized(request: NextRequest, secret: string) {
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return NextResponse.json({ error: "sync endpoint not configured" }, { status: 503 });
  if (!authorized(request, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await runSyncWorker({ maxJobs: 10, budgetMs: 50_000 });
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
