import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Zap } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ledger/page-header";
import { getContext, isAdmin } from "@/server/auth";
import { getReference } from "@/server/data/ledger";
import { getMeterWatches } from "@/server/data/meter-watch";
import { isProvider } from "@/lib/utilities/providers";
import { BillsBoard, type BillView, type MeterView } from "./bills-board";

export const metadata: Metadata = { title: "Bills" };
export const maxDuration = 300;

export default function BillsPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 rounded-2xl" /></div>}>
      <Bills />
    </Suspense>
  );
}

async function Bills() {
  const ctx = await getContext();
  const ref = await getReference();
  const admin = isAdmin(ctx);

  const [{ data: meters, error: mErr }, { data: bills, error: bErr }] = await Promise.all([
    ctx.supabase.from("utility_meters").select("id, provider, label, reference_no, category_id, active, last_checked_at, last_error").order("created_at"),
    ctx.supabase
      .from("utility_bills")
      .select("id, meter_id, bill_month, issue_date, due_date, units, payable, late_payments, expense_id, fetched_at, source, expenses(amount, deleted_at)")
      .order("bill_month", { ascending: false })
      .limit(60),
  ]);
  const watches = await getMeterWatches();
  const missing = [mErr, bErr].some((e) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(e?.code ?? ""));
  if (missing) {
    return (
      <div className="space-y-6">
        <PageHeader title="Bills" />
        <EmptyState icon={Zap} title="One database update is needed">
          {admin
            ? "Run the newest files in supabase/migrations (20261021000009_utility_bills.sql, then 20261021000010_more_utilities.sql) in the Supabase SQL Editor, then reload this page."
            : "The family administrator needs to finish setting up bills."}
        </EmptyState>
      </div>
    );
  }
  if (mErr) throw mErr;
  if (bErr) throw bErr;

  const meterViews: MeterView[] = (meters ?? []).filter((m) => isProvider(m.provider)).map((m) => ({
    id: m.id,
    provider: m.provider,
    label: m.label,
    refEnding: m.reference_no.slice(-4),
    referenceNo: admin ? m.reference_no : null,
    categoryId: m.category_id,
    categoryName: ref.categories.find((c) => c.id === m.category_id)?.name ?? null,
    active: m.active,
    lastCheckedAt: m.last_checked_at,
    lastError: m.last_error,
  }));

  const billViews: BillView[] = (bills ?? []).map((b) => {
    const exp = b.expenses as unknown as { amount: string | null; deleted_at: string | null } | null;
    const linked = exp && !exp.deleted_at ? exp : null;
    return {
      id: b.id,
      meterId: b.meter_id,
      billMonth: b.bill_month,
      issueDate: b.issue_date,
      dueDate: b.due_date,
      units: b.units,
      payable: Number(b.payable),
      latePayments: (b.late_payments ?? []) as { until: string | null; amount: number }[],
      expenseAmount: linked?.amount !== undefined && linked?.amount !== null ? Number(linked.amount) : null,
      linked: Boolean(linked),
      uploaded: b.source === "upload",
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Bills" description="Electricity, water and gas bills with a saved copy of each one. LESCO and WASA bills are fetched every day; SNGPL bills are uploaded." />
      <BillsBoard
        admin={admin}
        householdId={ctx.householdId}
        watches={watches}
        meters={meterViews}
        bills={billViews}
        today={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date())}
        categories={ref.categories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
