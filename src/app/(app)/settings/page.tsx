import type { Metadata } from "next";
import { Suspense } from "react";
import { ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader } from "@/components/ledger/page-header";
import { describeSpec, ruleToSpec } from "@/lib/finance";
import { getContext, isAdmin } from "@/server/auth";
import { getReference } from "@/server/data/ledger";
import { SettingsBoard } from "./settings-board";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Who can see what, how expenses are categorised, and the household's sharing rules." />
      <Suspense fallback={<Skeleton className="h-[30rem] rounded-2xl" />}>
        <Settings />
      </Suspense>
    </>
  );
}

async function Settings() {
  const ctx = await getContext();
  if (!isAdmin(ctx)) {
    return <EmptyState icon={ShieldAlert} title="Administrators only">You can change your own password from the account menu.</EmptyState>;
  }
  const ref = await getReference();
  const code = (id: string) => ref.units.find((u) => u.id === id)?.code ?? "?";
  return (
    <SettingsBoard
      settings={ctx.settings}
      units={ref.units.map((u) => ({ id: u.id, code: u.code }))}
      sections={ref.sections.map((s) => ({ id: s.id, title: s.title }))}
      categories={ref.categories}
      rules={ref.rules.map((r) => ({ id: r.id, name: r.name, description: r.description, system: r.is_system, active: r.active, summary: r.type === "custom_amounts" ? "Custom" : describeSpec(ruleToSpec(r), code) }))}
    />
  );
}
