import { AppSidebar } from "@/components/shell/app-sidebar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { CommandMenu } from "@/components/shell/command-menu";
import { PeriodSwitcher } from "@/components/shell/period-switcher";
import { SyncPill } from "@/components/shell/sync-pill";
import { getContext, isAdmin } from "@/server/auth";
import { getReference } from "@/server/data/ledger";
import { getSyncSummary } from "@/server/data/sync";

async function pendingReviewCount() {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return 0;
  const { count } = await ctx.supabase
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

export async function ShellSidebar() {
  const ctx = await getContext();
  const [ref, pending] = await Promise.all([getReference(), pendingReviewCount()]);
  const unit = ref.units.find((u) => u.id === ctx.unitId);
  return (
    <AppSidebar
      user={{
        name: ctx.memberName ?? ctx.email ?? "Family member",
        unitCode: unit?.code ?? null,
        role: ctx.role,
        householdName: ctx.householdName,
        pendingReviews: pending,
      }}
    />
  );
}

export async function ShellTopbarData() {
  const ctx = await getContext();
  const [ref, sync] = await Promise.all([getReference(), isAdmin(ctx) ? getSyncSummary() : null]);
  return (
    <>
      {sync ? <SyncPill summary={sync} /> : null}
      <PeriodSwitcher periods={ref.periods} />
    </>
  );
}

export async function ShellBottomNav() {
  return <BottomNav pendingReviews={await pendingReviewCount()} />;
}

export async function ShellCommandMenu() {
  const ctx = await getContext();
  return <CommandMenu role={ctx.role} />;
}
