"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALL = "__all";

export function UrlSelect({
  param,
  options,
  allLabel,
  label,
  className,
}: {
  param: string;
  options: { value: string; label: string }[];
  allLabel: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const value = params.get(param) ?? ALL;

  return (
    <Select
      value={options.some((o) => o.value === value) ? value : ALL}
      onValueChange={(v) => {
        const next = new URLSearchParams(params);
        if (v === ALL) next.delete(param);
        else next.set(param, v);
        next.delete("page");
        start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
      }}
    >
      <SelectTrigger aria-label={label} className={cn("h-9 min-w-36 rounded-full bg-card", pending && "opacity-70", value !== ALL && "border-haldi/70", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
