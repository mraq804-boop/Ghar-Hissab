import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { getContext } from "@/server/auth";
import { excelConfigured, serverEnv } from "@/server/env";
import { publicEnv } from "@/lib/env";
import { SCOPES } from "@/server/excel/google";

export async function GET(request: NextRequest) {
  const ctx = await getContext();
  const back = new URL("/sync", request.nextUrl);
  if (ctx.role !== "admin") {
    back.searchParams.set("error", "forbidden");
    return NextResponse.redirect(back);
  }
  if (!excelConfigured()) {
    back.searchParams.set("error", "not_configured");
    return NextResponse.redirect(back);
  }

  const env = serverEnv();
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    response_type: "code",
    redirect_uri: `${publicEnv.NEXT_PUBLIC_SITE_URL}/api/excel/oauth/callback`,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  }).toString();

  const res = NextResponse.redirect(auth);
  res.cookies.set("g_oauth", JSON.stringify({ state, verifier, h: ctx.householdId }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/excel/oauth",
    maxAge: 600,
  });
  return res;
}
