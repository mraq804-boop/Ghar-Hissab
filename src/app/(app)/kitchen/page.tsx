import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ledger/page-header";
import { daysOfMonth } from "@/lib/kitchen";
import { getContext, isAdmin } from "@/server/auth";
import { KitchenBoard } from "./kitchen-board";

export const metadata: Metadata = { title: "Kitchen" };

export default function KitchenPage({ searchParams }: PageProps<"/kitchen">) {
  return (
    <>
      <PageHeader title="Kitchen" description="The 4-week menu and who cooks each day. Both are kept in step with the workbook." />
      <Suspense fallback={<Skeleton className="h-[32rem] rounded-2xl" />}>
        <Kitchen searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Kitchen({ searchParams }: { searchParams: PageProps<"/kitchen">["searchParams"] }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const now = new Date();
  const m = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [y, mo] = m.split("-").map(Number);
  const days = daysOfMonth(y, mo);

  const [slots, sabzi, duties, members] = await Promise.all([
    ctx.supabase.from("meal_slots").select("week, weekday, fixed_category, dish"),
    ctx.supabase.from("sabzi_options").select("id, name, sort_order").order("sort_order"),
    ctx.supabase.from("duty_days").select("day, breakfast_member_id, lunch_member_id, dinner_member_id, off_member_id, off_note").gte("day", days[0]).lte("day", days[days.length - 1]).order("day"),
    ctx.supabase.from("members").select("id, full_name, duty_label, active").order("duty_label", { nullsFirst: false }),
  ]);

  return (
    <KitchenBoard
      admin={isAdmin(ctx)}
      tab={sp.tab === "duties" ? "duties" : "menu"}
      slots={slots.data ?? []}
      sabzi={sabzi.data ?? []}
      month={{ year: y, month: mo, key: m }}
      days={days}
      duties={duties.data ?? []}
      members={(members.data ?? []).map((x) => ({ id: x.id, label: x.duty_label || x.full_name.split(" ")[0], name: x.full_name, active: x.active, hasLabel: Boolean(x.duty_label) }))}
    />
  );
}
