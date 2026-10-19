"use client";

import { useSearchParams } from "next/navigation";

export function usePeriodHref() {
  const params = useSearchParams();
  const m = params.get("m");
  return (href: string, keepPeriod?: boolean) => (keepPeriod && m ? `${href}?m=${m}` : href);
}
