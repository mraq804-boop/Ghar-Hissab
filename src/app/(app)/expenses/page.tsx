import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarPlus, EyeOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/ledger/page-header";
import { allocateExpense, describeSpec } from "@/lib/finance";
import { periodLabel, resolvePeriod } from "@/lib/periods";
import { getContext, isAdmin } from "@/server/auth";
import { expenseSpec, getExpenseHistory, getPeriodLedgers, getReference, toExpenseInput, toPaisa, unitRefs } from "@/server/data/ledger";
import { getConnection, getScopeStates, recordStatus } from "@/server/data/sync";
import { ExpenseBoard, type ExpenseView } from "./expense-board";
import { StartMonth } from "./start-month";

export const metadata: Metadata = { title: "Expenses" };

export default function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  return (
    <Suspense fallback={<ExpensesSkeleton />}>
      <Expenses searchParams={searchParams} />
    </Suspense>
  );
}

async function Expenses({ searchParams }: { searchParams: PageProps<"/expenses">["searchParams"] }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const ref = await getReference();
  const admin = isAdmin(ctx);

  if (!admin && !ctx.settings.membersSeeAllExpenses) {
    return <EmptyState icon={EyeOff} title="Expenses are private in this household">Your shares and balance are on the dashboard.</EmptyState>;
  }

  const period = resolvePeriod(ref.periods, typeof sp.m === "string" ? sp.m : null);
  const now = new Date();
  const hasCurrent = ref.periods.some((p) => p.year === now.getFullYear() && p.month === now.getMonth() + 1);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const hasNext = ref.periods.some((p) => p.year === next.getFullYear() && p.month === next.getMonth() + 1);
  const startNext = !hasCurrent
    ? { year: now.getFullYear(), month: now.getMonth() + 1 }
    : !hasNext && now.getDate() >= 20
      ? { year: next.getFullYear(), month: next.getMonth() + 1 }
      : null;

  if (!period) {
    return (
      <>
        <PageHeader title="Expenses" />
        <EmptyState icon={CalendarPlus} title="No months yet" action={admin ? <StartMonth year={now.getFullYear()} month={now.getMonth() + 1} /> : null}>
          {admin ? "Start the current month to add household expenses." : "The administrator hasn't started a month yet."}
        </EmptyState>
      </>
    );
  }

  const [[ledger], states, connection, history] = await Promise.all([
    getPeriodLedgers([period]),
    getScopeStates(),
    admin ? getConnection() : null,
    admin ? getExpenseHistory(ref.periods) : [],
  ]);
  const connected = Boolean(connection?.has_token && connection.item_id);
  const scopeState = states.find((s) => s.scope === `period:${period.id}`);
  const units = unitRefs(ref.units);
  const code = (id: string) => ref.units.find((u) => u.id === id)?.code ?? "?";

  const expenses: ExpenseView[] = ledger.expenses.map((e) => {
    const spec = expenseSpec(e, ref.rules);
    const input = toExpenseInput(e, ref.rules, ref.sections);
    const rule = ref.rules.find((r) => r.id === e.split_rule_id);
    return {
      id: e.id,
      version: e.version,
      title: e.title,
      sectionId: e.section_id,
      categoryId: e.category_id,
      categoryName: ref.categories.find((c) => c.id === e.category_id)?.name ?? null,
      qtyText: e.qty_text,
      qtyNum: e.qty_num,
      rate: e.rate,
      amount: e.amount,
      amountPaisa: toPaisa(e.amount),
      splitLabel: rule?.name ?? describeSpec(spec, code),
      splitRuleId: e.split_rule_id,
      splitOverride: e.split_override,
      shares: input.amountPaisa === null || spec.type === "none" ? [] : allocateExpense(input, units, input.amountPaisa % 100n === 0n ? 100n : 1n).map((s) => ({ code: code(s.unitId), sharePaisa: s.sharePaisa })),
      paidByUnitId: e.paid_by_unit_id,
      paidByCode: e.paid_by_unit_id ? code(e.paid_by_unit_id) : null,
      notes: e.notes,
      expenseDate: e.expense_date,
      sync: admin ? recordStatus(e.updated_at, scopeState, connected) : null,
    };
  });

  return (
    <ExpenseBoard
      admin={admin}
      period={{ id: period.id, label: periodLabel(period, true), status: period.status, slug: `${period.year}-${String(period.month).padStart(2, "0")}` }}
      startNext={admin ? startNext : null}
      expenses={expenses}
      sectionTotals={Object.fromEntries(Object.entries(ledger.settlement.sectionTotals))}
      grandTotal={ledger.settlement.grandTotal}
      splitTotal={ledger.settlement.splitTotal}
      refData={{
        units: ref.units.map((u) => ({ id: u.id, code: u.code, sort_order: u.sort_order, is_purse_holder: u.is_purse_holder })),
        sections: ref.sections.map((s) => ({ id: s.id, key: s.key, title: s.title })),
        rules: ref.rules.map((r) => ({ id: r.id, type: r.type, name: r.name, description: r.description, active: r.active, parts: r.parts })),
        categories: ref.categories,
        history,
      }}
      openNew={sp.new === "1"}
      copyMonths={admin ? ref.periods.filter((p) => p.year * 12 + p.month < period.year * 12 + period.month).sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month)).slice(0, 12).map((p) => ({ id: p.id, label: periodLabel(p, true) })) : []}
    />
  );
}

function ExpensesSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2"><Skeleton className="h-9 w-56" /><Skeleton className="h-5 w-80" /></div>
      <Skeleton className="h-10 w-full rounded-full" />
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}
    </div>
  );
}
