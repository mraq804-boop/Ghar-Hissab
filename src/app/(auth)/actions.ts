"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/server/supabase/server";
import { publicEnv } from "@/lib/env";

export type AuthState = { error?: string; sent?: string } | undefined;

const safeNext = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/dashboard";
};

const passwordSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function signInWithPassword(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = passwordSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "That email and password don't match. Check them, or use a sign-in link instead." };
  redirect(safeNext(form.get("next")));
}

export async function sendSignInLink(_: AuthState, form: FormData): Promise<AuthState> {
  const email = z.email().safeParse(form.get("email"));
  if (!email.success) return { error: "Enter a valid email address" };
  const mailer = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const next = safeNext(form.get("next"));
  const { error } = await mailer.auth.signInWithOtp({
    email: email.data,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });
  if (error && !/signups not allowed|not found/i.test(error.message)) {
    console.error("Sign-in link failed", error.status, error.message);
    if (error.status === 429 || /rate limit|security purposes/i.test(error.message)) {
      return { error: "Too many sign-in emails were sent recently. Wait a few minutes, or use the most recent email you already received." };
    }
    return { error: "The sign-in link could not be sent. Try again in a minute." };
  }
  return { sent: `If ${email.data} has been invited, a sign-in link is on its way.` };
}

export async function signOut() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
