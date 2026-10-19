import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createSupabaseServer } from "@/server/supabase/server";

export type Role = "admin" | "member";

export type AppContext = {
  userId: string;
  email: string | null;
  householdId: string;
  householdName: string;
  role: Role;
  unitId: string | null;
  memberId: string | null;
  memberName: string | null;
  settings: {
    membersSeeAllExpenses: boolean;
    membersSeeAllBalances: boolean;
    membersSeeReports: boolean;
    maxUploadMb: number;
  };
  supabase: Awaited<ReturnType<typeof createSupabaseServer>>;
};

export const getContext = cache(async (): Promise<AppContext> => {
  await connection();
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");

  const { data: role } = await supabase
    .from("household_roles")
    .select("household_id, role, households(name)")
    .eq("user_id", claims.sub)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!role) redirect("/no-access");

  const [{ data: member }, { data: settings }] = await Promise.all([
    supabase
      .from("members")
      .select("id, unit_id, full_name")
      .eq("household_id", role.household_id)
      .eq("user_id", claims.sub)
      .maybeSingle(),
    supabase.from("app_settings").select("*").eq("household_id", role.household_id).maybeSingle(),
  ]);

  const household = role.households as unknown as { name: string } | null;
  return {
    userId: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    householdId: role.household_id,
    householdName: household?.name ?? "Home",
    role: role.role as Role,
    unitId: member?.unit_id ?? null,
    memberId: member?.id ?? null,
    memberName: member?.full_name ?? null,
    settings: {
      membersSeeAllExpenses: settings?.members_see_all_expenses ?? true,
      membersSeeAllBalances: settings?.members_see_all_balances ?? true,
      membersSeeReports: settings?.members_see_reports ?? true,
      maxUploadMb: settings?.max_upload_mb ?? 5,
    },
    supabase,
  };
});

export function isAdmin(ctx: AppContext) {
  return ctx.role === "admin";
}

export function canSeeAllBalances(ctx: AppContext) {
  return isAdmin(ctx) || ctx.settings.membersSeeAllBalances;
}

export function canSeeReports(ctx: AppContext) {
  return isAdmin(ctx) || ctx.settings.membersSeeReports;
}
