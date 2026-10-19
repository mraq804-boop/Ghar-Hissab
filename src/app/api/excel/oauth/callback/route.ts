import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getContext } from "@/server/auth";
import { serverEnv } from "@/server/env";
import { publicEnv } from "@/lib/env";
import { createSupabaseAdmin } from "@/server/supabase/admin";
import { encryptSecret } from "@/server/excel/crypto";
import { exchangeGoogleToken } from "@/server/excel/google";

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  const back = new URL("/sync", request.nextUrl);
  const fail = (code: string) => {
    back.searchParams.set("error", code);
    const res = NextResponse.redirect(back);
    res.cookies.delete({ name: "g_oauth", path: "/api/excel/oauth" });
    return res;
  };

  const ctx = await getContext();
  if (ctx.role !== "admin") return fail("forbidden");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return fail("denied");
  let saved: { state: string; verifier: string; h: string };
  try {
    saved = JSON.parse(request.cookies.get("g_oauth")?.value ?? "");
  } catch {
    return fail("state");
  }
  const code = params.get("code");
  if (!code || !same(params.get("state") ?? "", saved.state) || saved.h !== ctx.householdId) return fail("state");
  if (!(params.get("scope") ?? "").includes("https://www.googleapis.com/auth/spreadsheets")) return fail("scope");

  const env = serverEnv();
  try {
    const tokens = await exchangeGoogleToken(
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/excel/oauth/callback`,
        code_verifier: saved.verifier,
      },
      { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! },
    );
    if (!tokens.refreshToken) return fail("no_refresh");
    const admin = createSupabaseAdmin();
    const { error } = await admin.from("excel_connection").upsert(
      {
        household_id: ctx.householdId,
        account_email: tokens.email,
        refresh_token_enc: encryptSecret(tokens.refreshToken, env.EXCEL_TOKEN_ENC_KEY!),
        token_updated_at: new Date().toISOString(),
        connected_by: ctx.userId,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "household_id" },
    );
    if (error) return fail("save");
  } catch (e) {
    console.error("Google connection failed", e instanceof Error ? e.message : e);
    return fail("exchange");
  }

  back.searchParams.set("connected", "1");
  const res = NextResponse.redirect(back);
  res.cookies.delete({ name: "g_oauth", path: "/api/excel/oauth" });
  return res;
}
