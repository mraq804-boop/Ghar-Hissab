"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { MOBILE_TABS, NAV } from "./nav";
import { usePeriodHref } from "./use-period-href";

export function BottomNav({ pendingReviews = 0 }: { pendingReviews?: number }) {
  const pathname = usePathname();
  const hrefFor = usePeriodHref();
  const { setOpenMobile } = useSidebar();
  const tabs = NAV.filter((n) => MOBILE_TABS.includes(n.href));
  const moreActive = !tabs.some((t) => pathname.startsWith(t.href));

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-safe backdrop-blur-md supports-[backdrop-filter]:bg-card/80 md:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {tabs.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={hrefFor(t.href, t.keepPeriod)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground outline-none focus-visible:bg-muted",
                  active && "text-foreground",
                )}
              >
                {active ? <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-haldi" /> : null}
                <span className="relative">
                  <t.icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
                  {t.href === "/payments" && pendingReviews > 0 ? (
                    <span className="num absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-haldi px-1 text-center text-[10px] leading-4 font-bold text-[#1b2340]">
                      {pendingReviews}
                    </span>
                  ) : null}
                </span>
                {t.label === "Expense division" ? "Division" : t.label}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setOpenMobile(true)}
            className={cn(
              "flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground outline-none focus-visible:bg-muted",
              moreActive && "text-foreground",
            )}
          >
            <Menu className="size-5" strokeWidth={1.8} />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
