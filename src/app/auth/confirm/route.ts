import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/server/supabase/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/dashboard";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";

  if (!tokenHash && !code && !url.searchParams.get("error")) {
    const handoff = url.clone();
    handoff.pathname = "/auth/complete";
    handoff.search = `?next=${encodeURIComponent(next)}`;
    return NextResponse.redirect(handoff);
  }

  const supabase = await createSupabaseServer();
  let ok = false;
  if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  const target = url.clone();
  target.search = "";
  if (ok) {
    target.pathname = type === "invite" || type === "recovery" ? "/settings/password" : next;
  } else {
    target.pathname = "/login";
    target.searchParams.set("error", "link");
  }
  return NextResponse.redirect(target);
}
