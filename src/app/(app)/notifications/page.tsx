import type { Metadata } from "next";
import { Suspense } from "react";
import { BellOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/ledger/page-header";
import { getContext } from "@/server/auth";
import { pushConfigured, vapidPublicKey } from "@/server/notify/push";
import { NotificationsBoard, type Prefs } from "./notifications-board";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>}>
      <Notifications />
    </Suspense>
  );
}

const DEFAULTS: Prefs = { quietStart: "22:00", quietEnd: "08:00", payments: true, bills: true, meters: true, money: true, summary: true, reminders: true, personal: true };

async function Notifications() {
  const ctx = await getContext();
  const [list, prefs, devices] = await Promise.all([
    ctx.supabase.from("notifications").select("id, category, title, body, url, created_at, read_at, sent_at, deliver_after").order("created_at", { ascending: false }).limit(50),
    ctx.supabase.from("notification_prefs").select("*").maybeSingle(),
    ctx.supabase.from("push_subscriptions").select("id, endpoint, user_agent, created_at, last_ok_at").order("created_at", { ascending: false }),
  ]);
  if ([list.error, prefs.error, devices.error].some((e) => e && ["42P01", "PGRST205", "42703"].includes(e.code))) {
    return (
      <div className="space-y-6">
        <PageHeader title="Notifications" />
        <EmptyState icon={BellOff} title="One database update is needed">
          Run supabase/migrations/20261023000013_notifications.sql in the Supabase SQL Editor, then reload this page.
        </EmptyState>
      </div>
    );
  }
  const p = prefs.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" description="Alerts on this phone for payments, bills, meters and reminders, plus a list of everything sent to you." />
      <NotificationsBoard
        vapidKey={pushConfigured() ? vapidPublicKey() : null}
        prefs={p ? { quietStart: p.quiet_start.slice(0, 5), quietEnd: p.quiet_end.slice(0, 5), payments: p.payments, bills: p.bills, meters: p.meters, money: p.money, summary: p.summary, reminders: p.reminders, personal: p.personal } : DEFAULTS}
        devices={(devices.data ?? []).map((d) => ({ id: d.id, endpoint: d.endpoint, userAgent: d.user_agent, createdAt: d.created_at, lastOkAt: d.last_ok_at }))}
        items={(list.data ?? []).map((n) => ({ id: n.id, category: n.category, title: n.title, body: n.body, url: n.url, createdAt: n.created_at, read: Boolean(n.read_at), held: !n.sent_at }))}
      />
    </div>
  );
}
