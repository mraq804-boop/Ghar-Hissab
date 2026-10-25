import type { Metadata } from "next";
import { Suspense } from "react";
import { Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/ledger/page-header";
import { planSummary, rollForward, type PlanItem } from "@/lib/personal/plan";
import { MONTHS_LONG } from "@/lib/periods";
import { getContext } from "@/server/auth";
import { getPersonalCategories, previousMonth } from "@/server/data/personal";
import { PlanBoard } from "./plan-board";

export const metadata: Metadata = { title: "My plan" };

export default function PlanPage({ searchParams }: PageProps<"/me/plan">) {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>}>
      <Plan searchParams={searchParams} />
    </Suspense>
  );
}

const label = (m: string) => `${MONTHS_LONG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shift = (m: string, by: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const COLUMNS = "id, title, category_id, estimate, due_date, repeat_monthly, status, personal_expenses(amount)";
type Row = { id: string; title: string; category_id: string | null; estimate: string; due_date: string | null; repeat_monthly: boolean; status: PlanItem["status"]; personal_expenses: { amount: string } | null };
const toItem = (r: Row): PlanItem => ({
  id: r.id,
  title: r.title,
  categoryId: r.category_id,
  estimate: Number(r.estimate),
  dueDate: r.due_date,
  repeatMonthly: r.repeat_monthly,
  status: r.status,
  actual: r.personal_expenses ? Number(r.personal_expenses.amount) : null,
});

async function Plan({ searchParams }: { searchParams: PageProps<"/me/plan">["searchParams"] }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
  const thisMonth = today.slice(0, 7);
  const wanted = typeof sp.m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : shift(thisMonth, 1);
  const month = wanted < shift(thisMonth, -12) || wanted > shift(thisMonth, 12) ? shift(thisMonth, 1) : wanted;

  const loadMonth = async (m: string) => {
    const r = await ctx.supabase.from("personal_plan_items").select(COLUMNS).eq("month", `${m}-01`).order("sort_order").order("created_at");
    return r.error ? { error: r.error, items: [] as PlanItem[] } : { error: null, items: (r.data as unknown as Row[]).map(toItem) };
  };

  let current = await loadMonth(month);
  if (current.error && ["42P01", "PGRST205"].includes(current.error.code)) {
    return (
      <div className="space-y-6">
        <PageHeader title="My plan" />
        <EmptyState icon={Lock} title="One database update is needed">
          Run <code className="break-all">supabase/migrations/20261024000014_personal_plans.sql</code> in the Supabase SQL Editor, then reload this page.
        </EmptyState>
      </div>
    );
  }
  if (current.error) throw current.error;

  if (!current.items.length && month >= thisMonth) {
    const previous = await loadMonth(previousMonth(month));
    const carry = rollForward(previous.items, [], month);
    if (carry.length) {
      await ctx.supabase
        .from("personal_plan_items")
        .insert(carry.map((c, n) => ({ month: `${month}-01`, title: c.title, category_id: c.categoryId, estimate: c.estimate.toFixed(2), due_date: c.dueDate, repeat_monthly: true, sort_order: n })));
      current = await loadMonth(month);
      if (current.error) throw current.error;
    }
  }

  const [categories, { data: budget }] = await Promise.all([
    getPersonalCategories(),
    ctx.supabase.from("personal_budgets").select("amount").is("category_id", null).maybeSingle(),
  ]);

  return (
    <PlanBoard
      userId={ctx.userId}
      month={month}
      monthLabel={label(month)}
      prevMonth={shift(month, -1)}
      nextMonth={month < shift(thisMonth, 12) ? shift(month, 1) : null}
      today={today}
      items={current.items}
      categories={categories}
      summary={planSummary(current.items, budget ? Number(budget.amount) : null)}
    />
  );
}
