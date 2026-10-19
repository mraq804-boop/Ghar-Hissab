import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { periodLabel, periodSlug } from "@/lib/periods";
import { canSeeAllBalances, getContext, isAdmin } from "@/server/auth";
import { getPeriodLedgers, getReference } from "@/server/data/ledger";
import { FamilyBoard, type MemberView, type UnitHistory } from "./family-board";

export const metadata: Metadata = { title: "Family" };

export default function FamilyPage() {
  return (
    <Suspense fallback={<div className="space-y-6"><Skeleton className="h-10 w-48" /><div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}</div></div>}>
      <Family />
    </Suspense>
  );
}

async function Family() {
  const ctx = await getContext();
  const ref = await getReference();
  const admin = isAdmin(ctx);
  const [members, roles, invites, ledgers] = await Promise.all([
    ctx.supabase.from("members").select("id, unit_id, full_name, phone, email, relation, duty_label, joined_on, active, user_id").order("joined_on"),
    ctx.supabase.from("household_roles").select("user_id, role"),
    admin ? ctx.supabase.from("household_invites").select("member_id, created_at").is("accepted_at", null) : Promise.resolve({ data: [] as { member_id: string; created_at: string }[] }),
    getPeriodLedgers(ref.periods),
  ]);

  const roleOf = new Map((roles.data ?? []).map((r) => [r.user_id, r.role as "admin" | "member"]));
  const invited = new Set((invites.data ?? []).map((i) => i.member_id));
  const seeAll = canSeeAllBalances(ctx);

  const view: MemberView[] = (members.data ?? []).map((m) => ({
    id: m.id,
    unitId: m.unit_id,
    fullName: m.full_name,
    phone: admin || m.user_id === ctx.userId ? m.phone : null,
    email: admin || m.user_id === ctx.userId ? m.email : null,
    relation: m.relation,
    dutyLabel: m.duty_label,
    joinedOn: m.joined_on,
    active: m.active,
    hasAccount: Boolean(m.user_id),
    role: m.user_id ? (roleOf.get(m.user_id) ?? null) : null,
    invited: invited.has(m.id),
    isMe: m.user_id === ctx.userId,
  }));

  const history: UnitHistory[] = ref.units
    .filter((u) => seeAll || u.id === ctx.unitId)
    .map((u) => ({
      unitId: u.id,
      code: u.code,
      rows: ledgers.map((l) => {
        const s = l.settlement.units.find((x) => x.unitId === u.id)!;
        return {
          slug: periodSlug(l.period),
          label: periodLabel(l.period, true),
          sharePaisa: s.sharePaisa,
          paidPaisa: s.paidPaisa,
          balancePaisa: s.balancePaisa,
          status: s.status,
          pending: l.payments.filter((p) => p.payer_unit_id === u.id && p.status === "pending").length,
        };
      }),
    }));

  return (
    <FamilyBoard
      admin={admin}
      units={ref.units.map((u) => ({ id: u.id, code: u.code, name: u.name, isPurseHolder: u.is_purse_holder }))}
      members={view}
      history={history}
    />
  );
}
