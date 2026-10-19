"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

export function CompleteSignIn() {
  const params = useSearchParams();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    const type = hash.get("type");
    const nextParam = params.get("next") ?? "/dashboard";
    const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";

    if (!access_token || !refresh_token) {
      window.location.replace("/login?error=link");
      return;
    }
    createSupabaseBrowser()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error }) => {
        history.replaceState(null, "", window.location.pathname + window.location.search);
        if (error) setFailed(true);
        else window.location.replace(type === "invite" || type === "recovery" || next === "/settings/password" ? "/settings/password" : next);
      });
  }, [params]);

  if (failed) {
    return (
      <p className="text-center">
        That sign-in link has expired or was already used. <Link href="/login" className="underline">Ask for a new one</Link>.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Signing you in…
    </p>
  );
}
