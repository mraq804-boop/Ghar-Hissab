import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#1b2340] p-12 text-[#d9ddeb] lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-[#e2a322] font-heading text-base font-extrabold text-[#1b2340]">
            ح
          </span>
          <span className="font-heading text-xl font-bold text-white">Ghar Hisaab</span>
        </div>
        <div className="mt-auto max-w-md">
          <p className="font-heading text-[2.6rem] leading-[1.05] font-bold tracking-tight text-white">
            One home, three households, one honest account.
          </p>
          <p className="mt-5 text-base leading-relaxed text-[#b7bed6]">
            Every rupee spent on the house is split by the family&apos;s own rules, every payment is checked
            against its screenshot, and the Excel workbook stays in step.
          </p>
        </div>
        <LedgerLines />
      </aside>
      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-9 place-items-center rounded-lg bg-haldi font-heading text-base font-extrabold text-[#1b2340]">
              ح
            </span>
            <span className="font-heading text-xl font-bold">Ghar Hisaab</span>
          </div>
          <h1 className="font-heading text-3xl font-bold">Sign in</h1>
          <p className="mt-2 text-muted-foreground">Use the email address the family administrator invited.</p>
          <Suspense fallback={<div className="mt-8 h-64 animate-pulse rounded-xl bg-muted" />}>
            <LoginFormSlot searchParams={searchParams} />
          </Suspense>
        </div>
      </section>
    </div>
  );
}

async function LoginFormSlot({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/dashboard";
  const error = typeof sp.error === "string" ? sp.error : undefined;
  return <LoginForm next={next} initialError={error} />;
}

function LedgerLines() {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]" preserveAspectRatio="none">
      <defs>
        <pattern id="ruled" width="100%" height="36" patternUnits="userSpaceOnUse">
          <line x1="0" y1="35.5" x2="100%" y2="35.5" stroke="#ffffff" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#ruled)" />
      <line x1="88" y1="0" x2="88" y2="100%" stroke="#e2a322" strokeWidth="2" />
    </svg>
  );
}
