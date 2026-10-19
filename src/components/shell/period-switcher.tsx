"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarDays, Lock } from "lucide-react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { periodLabel, periodSlug, resolvePeriod, type Period } from "@/lib/periods";
import { cn } from "@/lib/utils";

export function PeriodSwitcher({ periods, className }: { periods: Period[]; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const current = resolvePeriod(periods, params.get("m"));

  if (periods.length === 0) return null;

  const years = [...new Set(periods.map((p) => p.year))];

  return (
    <Select
      value={current ? periodSlug(current) : undefined}
      onValueChange={(v) => {
        const next = new URLSearchParams(params);
        next.set("m", v);
        next.delete("page");
        start(() => router.push(`${pathname}?${next.toString()}`));
      }}
    >
      <SelectTrigger
        aria-label="Month"
        className={cn("h-9 w-auto min-w-36 gap-2 rounded-full bg-card pr-3 pl-3 font-medium", pending && "opacity-70", className)}
      >
        <CalendarDays className="size-4 text-muted-foreground" />
        <SelectValue placeholder="Month" />
      </SelectTrigger>
      <SelectContent align="end">
        {years.map((y) => (
          <SelectGroup key={y}>
            <SelectLabel>{y}</SelectLabel>
            {periods
              .filter((p) => p.year === y)
              .map((p) => (
                <SelectItem key={p.id} value={periodSlug(p)}>
                  <span className="flex items-center gap-2">
                    {periodLabel(p, true)}
                    {p.status === "closed" ? <Lock className="size-3 text-muted-foreground" aria-label="Closed" /> : null}
                  </span>
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
