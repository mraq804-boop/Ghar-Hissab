import type { Metadata } from "next";
import { Suspense } from "react";
import { Download, FileText, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/ledger/page-header";
import { StatusBadge } from "@/components/ledger/status-badge";
import { periodLabel, periodSlug } from "@/lib/periods";
import { canSeeAllBalances, getContext } from "@/server/auth";
import { getReference } from "@/server/data/ledger";
import { buildReport, cellText, parseFilters, ReportAccessError, REPORT_TYPES, reportType } from "@/server/reports";
import { cn } from "@/lib/utils";
import { ReportFiltersBar } from "./report-filters";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage({ searchParams }: PageProps<"/reports">) {
  return (
    <>
      <PageHeader title="Reports" description="Every figure comes from the same calculations as the dashboard. Exports contain exactly what is shown here." />
      <Suspense fallback={<div className="space-y-4"><Skeleton className="h-12 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Reports({ searchParams }: { searchParams: PageProps<"/reports">["searchParams"] }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const ref = await getReference();
  const type = reportType(sp.type);
  const filters = parseFilters(sp);
  const months = [...ref.periods].sort((a, b) => a.year - b.year || a.month - b.month).map((p) => ({ value: periodSlug(p), label: periodLabel(p, true) }));

  let report;
  try {
    report = await buildReport(type, filters);
  } catch (e) {
    if (e instanceof ReportAccessError) return <EmptyState icon={Lock} title="Not available">{e.message}</EmptyState>;
    throw e;
  }

  const qs = new URLSearchParams({ type, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string> });

  return (
    <div className="space-y-5">
      <ReportFiltersBar
        types={REPORT_TYPES.map((r) => ({ value: r.key, label: r.label }))}
        months={months}
        units={ref.units.filter((u) => canSeeAllBalances(ctx) || u.id === ctx.unitId).map((u) => u.code)}
        categories={ref.categories.map((c) => ({ value: c.id, label: c.name }))}
      />

      <section className="overflow-hidden rounded-2xl border bg-card">
        <header className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-heading text-lg font-semibold">{report.title}</h2>
            <p className="text-sm text-muted-foreground">{report.subtitle}, {report.rows.length} row{report.rows.length === 1 ? "" : "s"}</p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm"><a href={`/api/export/report?${qs}&format=xlsx`}><Download /> Excel</a></Button>
            <Button asChild variant="outline" size="sm"><a href={`/api/export/report?${qs}&format=pdf`}><FileText /> PDF</a></Button>
          </div>
        </header>
        {report.rows.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-muted-foreground">Nothing to report for these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                <tr className="text-left text-xs text-muted-foreground">
                  {report.columns.map((c) => (
                    <th key={c.key} scope="col" className={cn("px-4 py-2.5 font-medium whitespace-nowrap", c.kind === "money" && "text-right")}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    {report.columns.map((c) => (
                      <td key={c.key} className={cn("px-4 py-2.5 whitespace-nowrap", c.kind === "money" && "text-right", c.kind === "money" && typeof r[c.key] === "bigint" && (r[c.key] as bigint) < 0n && "text-destructive")}>
                        {c.kind === "status" && typeof r[c.key] === "string" ? <StatusBadge status={r[c.key] as string} compact={false} /> : c.kind === "money" && r[c.key] !== null && r[c.key] !== "" ? `Rs ${cellText(r[c.key], c.kind)}` : cellText(r[c.key] ?? null, c.kind)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {report.totals ? (
                <tfoot>
                  <tr className="border-t-2 bg-muted/40 font-semibold">
                    {report.columns.map((c) => (
                      <td key={c.key} className={cn("px-4 py-3 whitespace-nowrap", c.kind === "money" && "text-right")}>
                        {c.kind === "money" && report.totals![c.key] !== undefined && report.totals![c.key] !== null ? `Rs ${cellText(report.totals![c.key], c.kind)}` : cellText(report.totals![c.key] ?? null, "text")}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
