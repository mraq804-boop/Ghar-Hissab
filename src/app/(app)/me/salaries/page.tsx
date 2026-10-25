import type { Metadata } from "next";
import { Suspense } from "react";
import { Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/ledger/page-header";
import { MONTHS_LONG } from "@/lib/periods";
import type { SalaryPayment, Staff } from "@/lib/personal/salaries";
import { getContext } from "@/server/auth";
import { MeTabs } from "../plan/plan-board";
import { SalariesBoard } from "./salaries-board";

export const metadata: Metadata = { title: "Salaries" };

export default function SalariesPage({ searchParams }: PageProps<"/me/salaries">) {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>}>
      <Salaries searchParams={searchParams} />
    </Suspense>
  );
}

const label = (m: string) => `${MONTHS_LONG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shift = (m: string, by: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

type StaffRow = { id: string; name: string; role: string | null; monthly_salary: string; pay_day: number | null; active: boolean };
type PaymentRow = { id: string; staff_id: string; month: string; kind: SalaryPayment["kind"]; amount: string; paid_on: string; note: string | null };

async function Salaries({ searchParams }: { searchParams: PageProps<"/me/salaries">["searchParams"] }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
  const thisMonth = today.slice(0, 7);
  const wanted = typeof sp.m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? sp.m : thisMonth;
  const month = wanted < shift(thisMonth, -24) || wanted > shift(thisMonth, 1) ? thisMonth : wanted;
  const year = month.slice(0, 4);

  const [staff, payments] = await Promise.all([
    ctx.supabase.from("personal_staff").select("id, name, role, monthly_salary, pay_day, active").order("sort_order").order("created_at"),
    ctx.supabase.from("personal_salary_payments").select("id, staff_id, month, kind, amount, paid_on, note").gte("month", `${year}-01-01`).lte("month", `${year}-12-01`).order("paid_on", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  const missing = [staff.error, payments.error].find((e) => e && ["42P01", "PGRST205"].includes(e.code));
  if (missing) {
    return (
      <div className="space-y-6">
        <MeTabs active="salaries" />
        <PageHeader title="Salaries" />
        <EmptyState icon={Lock} title="One database update is needed">
          Run <code className="break-all">supabase/migrations/20261025000016_personal_salaries.sql</code> in the Supabase SQL Editor, then reload this page.
        </EmptyState>
      </div>
    );
  }
  if (staff.error) throw staff.error;
  if (payments.error) throw payments.error;

  const all: SalaryPayment[] = (payments.data as PaymentRow[]).map((p) => ({
    id: p.id,
    staffId: p.staff_id,
    month: p.month.slice(0, 7),
    kind: p.kind,
    amount: Number(p.amount),
    paidOn: p.paid_on,
    note: p.note,
  }));

  return (
    <SalariesBoard
      month={month}
      monthLabel={label(month)}
      year={year}
      prevMonth={shift(month, -1)}
      nextMonth={month < shift(thisMonth, 1) ? shift(month, 1) : null}
      today={today}
      staff={(staff.data as StaffRow[]).map((s): Staff => ({ id: s.id, name: s.name, role: s.role, monthlySalary: Number(s.monthly_salary), payDay: s.pay_day, active: s.active }))}
      payments={all.filter((p) => p.month === month)}
      yearTotals={Object.fromEntries((staff.data as StaffRow[]).map((s) => [s.id, all.filter((p) => p.staffId === s.id).reduce((a, p) => a + p.amount, 0)]))}
    />
  );
}
