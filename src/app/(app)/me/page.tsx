import type { Metadata } from "next";
import { Suspense } from "react";
import { Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/ledger/page-header";
import { budgetStatus, daysIn } from "@/lib/personal/budget";
import { MONTHS_LONG } from "@/lib/periods";
import { getContext } from "@/server/auth";
import { getPersonalMonth, previousMonth } from "@/server/data/personal";
import { planSummary, type PlanItem } from "@/lib/personal/plan";
import { PersonalBoard, type PersonalView } from "./personal-board";

export const metadata: Metadata = { title: "My spending" };

export default function MePage({ searchParams }: PageProps<"/me">) {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>}>
      <Me searchParams={searchParams} />
    </Suspense>
  );
}

async function monthPlan(month: string) {
  const ctx = await getContext();
  const { data, error } = await ctx.supabase.from("personal_plan_items").select("id, title, category_id, estimate, status, personal_expenses(amount)").eq("month", `${month}-01`);
  if (error || !data.length) return null;
  const items: PlanItem[] = (data as unknown as { id: string; title: string; category_id: string | null; estimate: string; status: PlanItem["status"]; personal_expenses: { amount: string } | null }[]).map((r) => ({
    id: r.id,
    title: r.title,
    categoryId: r.category_id,
    estimate: Number(r.estimate),
    dueDate: null,
    repeatMonthly: false,
    status: r.status,
    actual: r.personal_expenses ? Number(r.personal_expenses.amount) : null,
  }));
  const s = planSummary(items, null);
  return { planned: s.planned, remaining: s.remaining, toBuy: s.toBuy };
}

const label = (month: string) => `${MONTHS_LONG[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

async function Me({ searchParams }: { searchParams: PageProps<"/me">["searchParams"] }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
  const thisMonth = today.slice(0, 7);
  const month = typeof sp.m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) && sp.m <= thisMonth ? sp.m : thisMonth;

  let data: Awaited<ReturnType<typeof getPersonalMonth>>;
  try {
    data = await getPersonalMonth(month);
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code)) {
      return (
        <div className="space-y-6">
          <PageHeader title="My spending" />
          <EmptyState icon={Lock} title="One database update is needed">
            Run supabase/migrations/20261022000011_personal_expenses.sql in the Supabase SQL Editor, then reload this page.
          </EmptyState>
        </div>
      );
    }
    throw e;
  }

  const name = (id: string | null) => data.categories.find((c) => c.id === id)?.name ?? "Uncategorised";
  const sum = (rows: { amount: string }[]) => rows.reduce((a, r) => a + Number(r.amount), 0);
  const total = sum(data.expenses);
  const lastTotal = sum(data.lastMonth);

  const byCategory = new Map<string, { id: string | null; total: number; last: number }>();
  for (const e of data.expenses) {
    const k = name(e.category_id);
    const c = byCategory.get(k) ?? { id: e.category_id, total: 0, last: 0 };
    c.total += Number(e.amount);
    byCategory.set(k, c);
  }
  for (const e of data.lastMonth) {
    const k = name(e.category_id);
    const c = byCategory.get(k) ?? { id: e.category_id, total: 0, last: 0 };
    c.last += Number(e.amount);
    byCategory.set(k, c);
  }

  const dayOfMonth = month === thisMonth ? Number(today.slice(8, 10)) : null;
  const days = daysIn(month);
  const overall = data.budgets.find((b) => b.category_id === null);
  const budgets = data.budgets.map((b) => {
    const spent = b.category_id ? (byCategory.get(name(b.category_id))?.total ?? 0) : total;
    return { categoryId: b.category_id, name: b.category_id ? name(b.category_id) : "All spending", ...budgetStatus(spent, Number(b.amount), dayOfMonth, days) };
  });

  const view: PersonalView = {
    userId: ctx.userId,
    month,
    monthLabel: label(month),
    previousLabel: label(previousMonth(month)),
    prevMonth: previousMonth(month),
    nextMonth: month < thisMonth ? (Number(month.slice(5, 7)) === 12 ? `${Number(month.slice(0, 4)) + 1}-01` : `${month.slice(0, 4)}-${String(Number(month.slice(5, 7)) + 1).padStart(2, "0")}`) : null,
    today,
    total,
    lastTotal,
    overallBudget: overall ? budgets.find((b) => b.categoryId === null) ?? null : null,
    budgets: budgets.filter((b) => b.categoryId !== null).sort((a, b) => b.percent - a.percent),
    categories: data.categories,
    breakdown: [...byCategory].map(([n, c]) => ({ name: n, ...c })).filter((c) => c.total > 0 || c.last > 0).sort((a, b) => b.total - a.total),
    expenses: data.expenses.map((e) => ({ ...e, amount: Number(e.amount), categoryName: name(e.category_id) })),
    history: data.history,
    plan: await monthPlan(month),
  };

  return <PersonalBoard view={view} />;
}
