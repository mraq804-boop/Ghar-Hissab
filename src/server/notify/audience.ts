import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

type Member = { user_id: string; unit_id: string | null; role: "admin" | "member" };

/** Everyone who can sign in to the household, with their household unit and role. */
export async function householdPeople(db: SupabaseClient, householdId: string): Promise<Member[]> {
  const [{ data: roles }, { data: members }] = await Promise.all([
    db.from("household_roles").select("user_id, role").eq("household_id", householdId),
    db.from("members").select("user_id, unit_id").eq("household_id", householdId).eq("active", true).not("user_id", "is", null),
  ]);
  return (roles ?? []).map((r) => ({
    user_id: r.user_id,
    role: r.role as Member["role"],
    unit_id: members?.find((m) => m.user_id === r.user_id)?.unit_id ?? null,
  }));
}

export const admins = (people: Member[]) => people.filter((p) => p.role === "admin").map((p) => p.user_id);
export const everyone = (people: Member[]) => people.map((p) => p.user_id);
export const ofUnit = (people: Member[], unitId: string) => people.filter((p) => p.unit_id === unitId).map((p) => p.user_id);
