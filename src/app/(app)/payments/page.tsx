import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { periodLabel, resolvePeriod } from "@/lib/periods";
import { getContext, isAdmin, canSeeAllBalances } from "@/server/auth";
import { getPayments, getReference, toPaisa } from "@/server/data/ledger";
import { PaymentsBoard, type PaymentView } from "./payments-board";

export const metadata: Metadata = { title: "Payments" };

const PAGE_SIZE = 20;

export default function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-10 w-full rounded-full" /><Skeleton className="h-[28rem] rounded-2xl" /></div>}>
      <Payments searchParams={searchParams} />
    </Suspense>
  );
}

async function Payments({ searchParams }: { searchParams: PageProps<"/payments">["searchParams"] }) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const ctx = await getContext();
  const ref = await getReference();
  const admin = isAdmin(ctx);
  const allMonths = str("m") === "all";
  const period = allMonths ? null : resolvePeriod(ref.periods, str("m"));
  const status = (["pending", "approved", "rejected"] as const).find((s) => s === str("status"));
  const unit = ref.units.find((u) => u.code === str("unit"));
  const q = str("q")?.trim().toLowerCase() ?? "";
  const page = Math.max(1, Number(str("page") ?? 1) || 1);

  const all = await getPayments({ periodIds: period ? [period.id] : undefined, unitId: unit?.id });
  const counts = {
    all: all.length,
    pending: all.filter((p) => p.status === "pending").length,
    approved: all.filter((p) => p.status === "approved").length,
    rejected: all.filter((p) => p.status === "rejected").length,
  };
  const shaCount = new Map<string, number>();
  for (const p of all) for (const a of p.payment_attachments) shaCount.set(a.sha256, (shaCount.get(a.sha256) ?? 0) + 1);

  const filtered = all
    .filter((p) => !status || p.status === status)
    .filter((p) => !q || p.reference?.toLowerCase().includes(q) || p.notes?.toLowerCase().includes(q));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const code = (id: string) => ref.units.find((u) => u.id === id)?.code ?? "?";

  const rows: PaymentView[] = pageRows.map((p) => {
    const review = [...p.payment_reviews].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const per = ref.periods.find((x) => x.id === p.period_id);
    return {
      id: p.id,
      version: p.version,
      unitId: p.payer_unit_id,
      unitCode: code(p.payer_unit_id),
      amountPaisa: toPaisa(p.amount)!,
      paidOn: p.paid_on,
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      status: p.status,
      source: p.source,
      createdAt: p.created_at,
      hasProof: p.payment_attachments.length > 0,
      proofMime: p.payment_attachments[0]?.mime_type ?? null,
      duplicateProof: p.payment_attachments.some((a) => (shaCount.get(a.sha256) ?? 0) > 1),
      reviewReason: review?.reason ?? null,
      reviewedAt: review?.created_at ?? null,
      periodLabel: per ? periodLabel(per, true) : "",
      relatedExpense: p.related_expense_id != null,
      mine: p.payer_unit_id === ctx.unitId,
    };
  });

  const openPeriods = ref.periods.slice(0, 12).map((p) => ({ id: p.id, label: periodLabel(p, true) }));

  return (
    <PaymentsBoard
      admin={admin}
      householdId={ctx.householdId}
      userId={ctx.userId}
      myUnitId={ctx.unitId}
      units={ref.units.filter((u) => canSeeAllBalances(ctx) || u.id === ctx.unitId).map((u) => ({ id: u.id, code: u.code }))}
      formUnits={ref.units.map((u) => ({ id: u.id, code: u.code }))}
      periods={openPeriods}
      currentPeriodId={period?.id ?? openPeriods[0]?.id ?? ""}
      periodTitle={period ? periodLabel(period, true) : "All months"}
      rows={rows}
      counts={counts}
      page={page}
      pages={Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}
      total={filtered.length}
      maxUploadMb={ctx.settings.maxUploadMb}
      openNew={str("new") === "1"}
    />
  );
}
