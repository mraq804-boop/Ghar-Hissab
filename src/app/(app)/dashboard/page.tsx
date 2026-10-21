import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { format } from "date-fns";
import { AlertTriangle, CalendarClock, Telescope, Zap, CalendarPlus, Clock3, Copy, FileWarning, Receipt, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/ledger/money";
import { EmptyState, Panel } from "@/components/ledger/page-header";
import { StatusBadge } from "@/components/ledger/status-badge";
import { UrlSelect } from "@/components/ledger/url-select";
import { CategoryChart, TrendChart } from "@/components/dashboard/charts";
import { formatPaisa, paisaToNumber } from "@/lib/finance";
import { periodLabel, periodSlug } from "@/lib/periods";
import { getDashboard } from "@/server/data/dashboard";
import { toPaisa } from "@/server/data/ledger";
import { cn } from "@/lib/utils";
import { methodLabel } from "@/lib/labels";
import { publicEnv } from "@/lib/env";
import { buildMonthSummary } from "@/lib/smart/summary";
import { ShareSummary } from "@/components/ledger/share-summary";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

async function Dashboard({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  const sp = await searchParams;
  const d = await getDashboard({ m: one(sp.m), unit: one(sp.unit), cat: one(sp.cat) });

  if (d.empty) {
    return (
      <EmptyState
        icon={CalendarPlus}
        title="No months recorded yet"
        action={d.isAdmin ? <Button asChild><Link href="/expenses">Start this month</Link></Button> : null}
      >
        {d.isAdmin
          ? "Import the existing workbook or start the current month to begin tracking household spending."
          : "The family administrator hasn't set up any months yet."}
      </EmptyState>
    );
  }

  const s = d.settlement;
  const slug = periodSlug(d.period);
  const change =
    d.previousSplitTotal && d.previousSplitTotal > 0n
      ? Math.round(((paisaToNumber(s.splitTotal) - paisaToNumber(d.previousSplitTotal)) / paisaToNumber(d.previousSplitTotal)) * 100)
      : null;
  const householdWord = s.units.length === 1 ? "household" : "households";
  const summary = d.seeAll
    ? buildMonthSummary({
        monthLabel: periodLabel(d.period, true),
        sharedPaisa: s.splitTotal,
        purseCode: d.units.find((u) => u.is_purse_holder)?.code ?? null,
        units: s.units,
        billsNotIssued: d.billsNotIssued,
        pendingPayments: d.pendingPayments,
        link: `${publicEnv.NEXT_PUBLIC_SITE_URL}/division?m=${slug}`,
      })
    : null;

  return (
    <div className="space-y-6 md:space-y-8">
      <section aria-labelledby="statement" className="relative">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              {periodLabel(d.period, true)}
              {d.period.status === "closed" ? <StatusBadge status="closed" compact /> : null}
            </p>
            <h1 id="statement" className="mt-2 font-heading text-[2rem] leading-[1.08] font-bold text-balance sm:text-[2.6rem] lg:text-[3rem]">
              <span className="num">{formatPaisa(s.splitTotal)}</span> shared across {s.units.length} {householdWord}.
            </h1>
            <p className="mt-3 text-lg text-muted-foreground sm:text-xl">
              {d.outstanding > 0n ? (
                <>
                  <span className="num font-semibold text-foreground">{formatPaisa(d.outstanding)}</span> still to collect.
                </>
              ) : (
                "Everyone has settled their share."
              )}{" "}
              {change !== null && d.previousPeriod ? (
                <span>
                  {change === 0 ? "Same as" : change > 0 ? `Up ${change}% on` : `Down ${Math.abs(change)}% on`} {periodLabel(d.previousPeriod, true)}.
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {summary ? <ShareSummary text={summary} monthLabel={periodLabel(d.period, true)} /> : null}
            <UrlSelect
              param="unit"
              label="Household"
              allLabel="All households"
              options={d.units.map((u) => ({ value: u.code, label: `${u.code} household` }))}
            />
            <UrlSelect
              param="cat"
              label="Category"
              allLabel="All categories"
              options={d.categoriesList.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
        </div>

        <div className={cn("mt-7 grid overflow-hidden rounded-2xl border bg-card", d.visibleUnits.length > 1 && "md:grid-cols-3")}>
          {d.visibleUnits.map((u, i) => {
            const pct = u.sharePaisa > 0n ? Math.min(100, Math.round((paisaToNumber(u.paidPaisa) / paisaToNumber(u.sharePaisa)) * 100)) : 0;
            const unit = d.units.find((x) => x.id === u.unitId);
            return (
              <article
                key={u.unitId}
                className={cn(
                  "relative p-5 md:p-6",
                  i > 0 && "border-t md:border-t-0 md:border-l",
                  d.unitFilter?.id === u.unitId && "bg-accent/40",
                )}
              >
                <header className="flex items-center justify-between gap-3">
                  <div className="flex items-baseline gap-2">
                    <h2 className="font-heading text-2xl font-extrabold">{u.code}</h2>
                    {unit?.is_purse_holder ? <span className="text-xs text-muted-foreground">holds the purse</span> : null}
                  </div>
                  <StatusBadge status={u.status} />
                </header>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Share</dt>
                  <dd className="text-right font-medium"><Money paisa={u.sharePaisa} /></dd>
                  <dt className="text-muted-foreground">Paid</dt>
                  <dd className="text-right font-medium"><Money paisa={u.paidPaisa} /></dd>
                </dl>
                <div
                  className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label={`${u.code} has paid ${pct}% of their share`}
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="h-full rounded-full bg-chart-2 transition-[width] duration-700" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-4 flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">{u.balancePaisa >= 0n ? "Balance" : "Still owes"}</span>
                  <Money paisa={u.balancePaisa < 0n ? -u.balancePaisa : u.balancePaisa} signed={u.balancePaisa > 0n} tone={u.balancePaisa < 0n ? undefined : "auto"} className={cn("font-heading text-xl font-bold", u.balancePaisa < 0n && "text-destructive")} />
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {d.forecast ? (
        <Panel
          title="Month-end forecast"
          description={`Recorded so far plus regular items not entered yet, at their usual amounts`}
        >
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div>
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Telescope className="size-4" /> Likely to end near</p>
              <p className="num mt-1 font-heading text-3xl font-bold">{formatPaisa(d.forecast.projectedPaisa)}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="num">{formatPaisa(d.forecast.recordedPaisa)}</span> recorded,
                about <span className="num">{formatPaisa(d.forecast.projectedPaisa - d.forecast.recordedPaisa)}</span> still to come.
              </p>
              <dl className="mt-4 space-y-1.5 text-sm">
                {d.forecast.units.map((u) => (
                  <div key={u.unitId} className="flex items-baseline justify-between gap-3">
                    <dt className="font-semibold">{u.code}</dt>
                    <dd className="text-right">
                      share about <Money paisa={u.projectedSharePaisa} className="font-medium" />
                      {u.projectedBalancePaisa < -50n ? (
                        <span className="text-muted-foreground">, <Money paisa={-u.projectedBalancePaisa} /> left to pay</span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-sm font-medium">Still expected this month</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {d.forecast.expected.map((x) => (
                  <li key={x.title} className="flex justify-between gap-3">
                    <span>{x.title} <span className="text-xs text-muted-foreground">({x.basedOn})</span></span>
                    <span className="num shrink-0">~{formatPaisa(x.amountPaisa)}</span>
                  </li>
                ))}
                {d.forecast.unknown.map((t) => (
                  <li key={t} className="flex justify-between gap-3 text-muted-foreground">
                    <span>{t}</span>
                    <span className="shrink-0 text-xs">no earlier amount</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">An estimate from earlier months. Real amounts replace it as they are entered.</p>
            </div>
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Shared spending and payments"
          description={d.categoryFilter ? `${d.categoryFilter.name}, last ${d.trend.length} months` : `Last ${d.trend.length} months${d.unitFilter ? `, ${d.unitFilter.code} household` : ""}`}
        >
          <TrendChart data={d.trend} sharedLabel={d.unitFilter ? `${d.unitFilter.code} share` : d.categoryFilter ? d.categoryFilter.name : undefined} />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View as table</summary>
            <table className="num mt-2 w-full text-left">
              <thead className="text-muted-foreground"><tr><th className="py-1 font-medium">Month</th><th className="py-1 text-right font-medium">Shared</th><th className="py-1 text-right font-medium">Approved</th></tr></thead>
              <tbody>
                {d.trend.map((t) => (
                  <tr key={t.slug} className="border-t"><td className="py-1.5">{t.month}</td><td className="py-1.5 text-right">Rs {t.shared.toLocaleString("en-US")}</td><td className="py-1.5 text-right">Rs {t.collected.toLocaleString("en-US")}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </Panel>

        <Panel title="Needs attention" bodyClassName="p-0">
          <ul className="divide-y">
            {d.isAdmin && d.pendingPayments > 0 ? (
              <AttentionItem href={`/payments?m=${slug}&status=pending`} icon={Clock3} tone="warning" title={`${d.pendingPayments} payment${d.pendingPayments === 1 ? "" : "s"} to verify`}>
                {formatPaisa(d.pendingAmount)} waiting for your review
              </AttentionItem>
            ) : null}
            {!d.isAdmin && d.pendingPayments > 0 ? (
              <AttentionItem href={`/payments?m=${slug}`} icon={Clock3} tone="warning" title="Payments awaiting verification">
                They count once the administrator approves them
              </AttentionItem>
            ) : null}
            {d.overdue.map((o) => (
              <AttentionItem key={`${o.period.id}-${o.unit.unitId}`} href={`/division?m=${periodSlug(o.period)}`} icon={AlertTriangle} tone="danger" title={`${o.unit.code} owes ${formatPaisa(-o.unit.balancePaisa)}`}>
                From {periodLabel(o.period, true)}
              </AttentionItem>
            ))}
            {d.billNotices.map((b) => (
              <AttentionItem
                key={`${b.kind}-${b.id}`}
                href={b.kind === "arrived" ? "/bills" : `/bills/view?id=${b.id}`}
                icon={Zap}
                tone={b.kind === "due" ? "warning" : "neutral"}
                title={b.kind === "arrived" ? `${b.label} bill arrived: ${formatPaisa(BigInt(Math.round(b.amount * 100)))}` : `${b.label} bill due ${b.dueDate ? format(new Date(`${b.dueDate}T00:00:00`), "d MMM") : "soon"}`}
              >
                {b.kind === "arrived"
                  ? `Due ${b.dueDate ? format(new Date(`${b.dueDate}T00:00:00`), "d MMM") : "soon"}.${d.isAdmin ? " Tap to add it to expenses." : ""}`
                  : `${formatPaisa(BigInt(Math.round(b.amount * 100)))} to pay LESCO by then`}
              </AttentionItem>
            ))}
            {d.alerts.map((a) => (
              <AttentionItem
                key={a.title}
                href={`/expenses?m=${slug}`}
                icon={a.kind === "duplicate" ? Copy : a.kind === "missing" ? CalendarClock : TrendingUp}
                tone={a.kind === "missing" ? "neutral" : "warning"}
                title={a.title}
              >
                {a.detail}
              </AttentionItem>
            ))}
            {s.pendingBillCount > 0 ? (
              <AttentionItem href={`/expenses?m=${slug}`} icon={FileWarning} tone="neutral" title={`${s.pendingBillCount} bill${s.pendingBillCount === 1 ? "" : "s"} not issued yet`}>
                Shares will change when the amounts are entered
              </AttentionItem>
            ) : null}
            {d.pendingPayments === 0 && d.overdue.length === 0 && d.alerts.length === 0 && d.billNotices.length === 0 && s.pendingBillCount === 0 ? (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing needs attention right now.</li>
            ) : null}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          title={d.unitFilter ? `Where ${d.unitFilter.code}'s share goes` : "Spending by category"}
          description={`${periodLabel(d.period, true)}, ${d.expenseCount} expense${d.expenseCount === 1 ? "" : "s"}`}
        >
          {d.categories.length ? (
            <CategoryChart data={d.categories} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No expenses match these filters.</p>
          )}
        </Panel>

        <Panel
          className="lg:col-span-2"
          title="Recent payments"
          actions={<Button asChild variant="ghost" size="sm"><Link href={`/payments?m=${slug}`}>See all</Link></Button>}
          bodyClassName="p-0"
        >
          {d.recentPayments.length ? (
            <ol className="divide-y">
              {d.recentPayments.map((p) => {
                const unit = d.units.find((u) => u.id === p.payer_unit_id);
                return (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted font-heading text-xs font-bold">{unit?.code}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.reference ? `Ref ${p.reference}` : methodLabel(p.method)}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(p.paid_on), "d MMM")}, {methodLabel(p.method)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Money paisa={toPaisa(p.amount)} className="text-sm font-semibold" />
                      <StatusBadge status={p.status} compact />
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="flex flex-col items-center px-5 py-10 text-center">
              <Wallet className="size-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">No payments recorded this month.</p>
              <Button asChild size="sm" className="mt-4"><Link href="/payments?new=1">Record a payment</Link></Button>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function AttentionItem({ href, icon: Icon, tone, title, children }: { href: string; icon: typeof Receipt; tone: "warning" | "danger" | "neutral"; title: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex gap-3 px-5 py-3.5 outline-none hover:bg-muted/60 focus-visible:bg-muted">
        <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", tone === "warning" && "bg-warning-soft text-warning", tone === "danger" && "bg-danger-soft text-destructive", tone === "neutral" && "bg-muted text-muted-foreground")}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{children}</span>
        </span>
      </Link>
    </li>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8" aria-busy>
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-12 w-full max-w-2xl" />
        <Skeleton className="h-6 w-80" />
      </div>
      <div className="grid gap-px overflow-hidden rounded-2xl border md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3 bg-card p-6">
            <Skeleton className="h-7 w-14" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-6 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}
