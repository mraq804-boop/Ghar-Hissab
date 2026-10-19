import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowRight, Scale } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/ledger/money";
import { EmptyState, PageHeader, Panel } from "@/components/ledger/page-header";
import { StatusBadge } from "@/components/ledger/status-badge";
import { describeSpec, formatPaisa, largestRemainder, paisaToNumber, ruleToSpec, splitFractions, splitKey, type SplitSpec } from "@/lib/finance";
import { periodLabel, resolvePeriod } from "@/lib/periods";
import { canSeeAllBalances, getContext } from "@/server/auth";
import { getPeriodLedgers, getReference } from "@/server/data/ledger";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Expense division" };

export default function DivisionPage({ searchParams }: PageProps<"/division">) {
  return (
    <Suspense fallback={<div className="space-y-6"><Skeleton className="h-10 w-72" /><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>}>
      <Division searchParams={searchParams} />
    </Suspense>
  );
}

function poolShares(spec: SplitSpec, amount: bigint, unitIds: string[]) {
  if (spec.type === "custom_amounts") return new Map(spec.parts.map((p) => [p.unitId, p.amountPaisa]));
  if (spec.type === "none") return new Map<string, bigint>();
  const f = splitFractions(spec);
  return largestRemainder(
    unitIds.filter((id) => f.has(id)).map((id, i) => ({ key: id, sortOrder: i, num: amount * f.get(id)!.num, den: f.get(id)!.den })),
    1n,
  );
}

async function Division({ searchParams }: { searchParams: PageProps<"/division">["searchParams"] }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const ref = await getReference();
  const period = resolvePeriod(ref.periods, typeof sp.m === "string" ? sp.m : null);
  if (!period) return <EmptyState icon={Scale} title="No months yet">Once a month has expenses, this page shows exactly how they are divided.</EmptyState>;

  const [ledger] = await getPeriodLedgers([period]);
  const s = ledger.settlement;
  const seeAll = canSeeAllBalances(ctx);
  const units = ref.units;
  const code = (id: string) => units.find((u) => u.id === id)?.code ?? "?";
  const purse = units.find((u) => u.is_purse_holder);
  const rules = ref.rules;
  const ruleName = (key: string) =>
    rules.find((r) => r.type !== "custom_amounts" && splitKey(ruleToSpec(r)) === key)?.name;

  const pools = s.rulePools
    .filter((p) => p.split.type !== "none")
    .map((p) => ({
      key: p.key,
      name: ruleName(p.key) ?? describeSpec(p.split, code),
      description: describeSpec(p.split, code),
      amount: p.amountPaisa,
      count: p.expenseCount,
      shares: poolShares(p.split, p.amountPaisa, units.map((u) => u.id)),
    }));
  const unsplit = s.rulePools.find((p) => p.split.type === "none");
  const visible = s.units.filter((u) => seeAll || u.unitId === ctx.unitId);
  const maxShare = Math.max(1, ...s.units.map((u) => paisaToNumber(u.sharePaisa)));

  const settleUp = s.units
    .filter((u) => purse && u.unitId !== purse.id && (u.balancePaisa <= -50n || u.balancePaisa >= 50n))
    .filter((u) => seeAll || u.unitId === ctx.unitId)
    .map((u) => (u.balancePaisa < 0n ? { from: u.code, to: purse!.code, amount: -u.balancePaisa } : { from: purse!.code, to: u.code, amount: u.balancePaisa }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>Expense division <span className="text-muted-foreground">· {periodLabel(period, true)}</span></>}
        description="How this month's shared spending is divided between the households, using the family's own rules from the workbook."
      />

      <Panel title="Shared pools" description={`${formatPaisa(s.splitTotal)} shared${unsplit ? `, ${formatPaisa(unsplit.amountPaisa)} personal and not divided` : ""}${s.pendingBillCount ? `, ${s.pendingBillCount} bill${s.pendingBillCount === 1 ? "" : "s"} not issued yet` : ""}`} bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Pool</th>
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                {units.map((u) => <th key={u.id} className="px-3 py-2.5 text-right font-medium">{u.code}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {pools.map((p) => (
                <tr key={p.key}>
                  <td className="px-5 py-3">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.description}, {p.count} item{p.count === 1 ? "" : "s"}</p>
                  </td>
                  <td className="px-3 py-3 text-right font-medium"><Money paisa={p.amount} /></td>
                  {units.map((u) => {
                    const v = p.shares.get(u.id);
                    return (
                      <td key={u.id} className="px-3 py-3 text-right">
                        {v ? <Money paisa={v} decimals={v % 100n !== 0n} /> : <span className="text-muted-foreground">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40 font-semibold">
                <td className="px-5 py-3">Share (rounded)</td>
                <td className="px-3 py-3 text-right"><Money paisa={s.splitTotal} /></td>
                {s.units.map((u) => <td key={u.unitId} className="px-3 py-3 text-right"><Money paisa={u.sharePaisa} /></td>)}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          Exact shares are {s.units.map((u) => `${u.code} ${u.exactShare.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(", ")}. Each is rounded to whole rupees and the leftover rupee goes to the largest fraction, so the shares always add up to the total.
        </p>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="Settlement" description="Share against approved payments" bodyClassName="p-0">
          <ul className="divide-y">
            {visible.map((u) => {
              const paidPct = u.sharePaisa > 0n ? Math.min(100, (paisaToNumber(u.paidPaisa) / paisaToNumber(u.sharePaisa)) * 100) : 0;
              return (
                <li key={u.unitId} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="font-heading text-xl font-extrabold">{u.code}</span>
                      <StatusBadge status={u.status} />
                    </div>
                    <Money paisa={u.balancePaisa} signed tone="auto" className="font-heading text-lg font-bold" />
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted" style={{ width: `${(paisaToNumber(u.sharePaisa) / maxShare) * 100}%` }}>
                    <div className="h-full rounded-full bg-chart-2" style={{ width: `${paidPct}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Paid <Money paisa={u.paidPaisa} className="text-foreground" /> of <Money paisa={u.sharePaisa} className="text-foreground" />
                  </p>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-between border-t bg-muted/40 px-5 py-3 text-sm font-semibold">
            <span>Totals</span>
            <span className="flex gap-4">
              <span>Paid <Money paisa={s.totals.paidPaisa} /></span>
              <Money paisa={s.totals.balancePaisa} signed tone="auto" />
            </span>
          </div>
        </Panel>

        <Panel className="lg:col-span-2" title="Settle up" description={purse ? `${purse.code} holds the household purse` : undefined}>
          {settleUp.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Everyone is square for this month.</p>
          ) : (
            <ul className="space-y-3">
              {settleUp.map((t, i) => (
                <li key={i} className={cn("flex items-center gap-3 rounded-xl border p-3")}>
                  <span className="grid size-9 place-items-center rounded-full bg-primary font-heading text-xs font-bold text-primary-foreground">{t.from}</span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                  <span className="grid size-9 place-items-center rounded-full bg-muted font-heading text-xs font-bold">{t.to}</span>
                  <span className="ml-auto text-right">
                    <Money paisa={t.amount} className="font-semibold" />
                    <span className="block text-xs text-muted-foreground">{t.from} pays {t.to}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
