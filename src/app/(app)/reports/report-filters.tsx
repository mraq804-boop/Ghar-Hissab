"use client";

import { UrlSelect } from "@/components/ledger/url-select";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ReportFiltersBar({
  types,
  months,
  units,
  categories,
}: {
  types: { value: string; label: string }[];
  months: { value: string; label: string }[];
  units: string[];
  categories: { value: string; label: string }[];
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const type = params.get("type") ?? "monthly";
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    n.set(k, v);
    router.replace(`${pathname}?${n}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-card p-3 md:flex-row md:flex-wrap md:items-center">
      <Select value={type} onValueChange={(v) => set("type", v)}>
        <SelectTrigger aria-label="Report" className="h-9 w-full rounded-full font-medium md:w-72"><SelectValue /></SelectTrigger>
        <SelectContent>{types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
      </Select>
      <div className="grid grid-cols-2 gap-2 md:flex">
        <UrlSelect param="from" label="From month" allLabel="From the start" options={months} />
        <UrlSelect param="to" label="To month" allLabel="Up to now" options={months} />
      </div>
      <div className="grid grid-cols-2 gap-2 md:flex">
        {units.length > 1 ? <UrlSelect param="unit" label="Household" allLabel="All households" options={units.map((u) => ({ value: u, label: `${u} household` }))} /> : null}
        {["categories", "expenses"].includes(type) ? <UrlSelect param="category" label="Category" allLabel="All categories" options={categories} /> : null}
        {type === "payments" ? (
          <UrlSelect param="status" label="Status" allLabel="Any status" options={[{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }]} />
        ) : null}
      </div>
    </div>
  );
}
