import type { Metadata } from "next";
import { Suspense } from "react";
import { AlarmClock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/ledger/page-header";
import { karachi } from "@/lib/notify/rules";
import { getContext, isAdmin } from "@/server/auth";
import { RemindersBoard, type ReminderView } from "./reminders-board";

export const metadata: Metadata = { title: "Reminders" };

export default function RemindersPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 rounded-2xl" /></div>}>
      <Reminders />
    </Suspense>
  );
}

async function Reminders() {
  const ctx = await getContext();
  const { data, error } = await ctx.supabase.from("reminders").select("id, created_by, audience, title, note, next_at, repeat, active").order("next_at");
  if (error && ["42P01", "PGRST205"].includes(error.code)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Reminders" />
        <EmptyState icon={AlarmClock} title="One database update is needed">
          Run supabase/migrations/20261023000013_notifications.sql in the Supabase SQL Editor, then reload this page.
        </EmptyState>
      </div>
    );
  }
  if (error) throw error;
  const today = karachi(new Date());
  const reminders: ReminderView[] = (data ?? []).map((r) => {
    const local = karachi(new Date(r.next_at));
    return {
      id: r.id,
      title: r.title,
      note: r.note,
      audience: r.audience,
      repeat: r.repeat,
      active: r.active,
      date: local.date,
      time: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
      mine: r.created_by === ctx.userId,
      canEdit: r.created_by === ctx.userId || (r.audience === "family" && isAdmin(ctx)),
    };
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Reminders" description="For yourself or the whole family. They ring as notifications, quiet hours permitting." />
      <RemindersBoard reminders={reminders} today={today.date} />
    </div>
  );
}
