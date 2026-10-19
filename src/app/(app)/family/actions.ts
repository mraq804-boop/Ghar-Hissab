"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { getContext, isAdmin } from "@/server/auth";
import { dbError, forbidden, invalid, type ActionResult } from "@/server/actions/result";
import { createSupabaseAdmin } from "@/server/supabase/admin";

const memberSchema = z.object({
  id: z.uuid().optional(),
  unitId: z.uuid("Choose a household"),
  fullName: z.string().trim().min(1, "Enter a name").max(120),
  phone: z.string().trim().max(30).regex(/^[+\d\s()-]*$/, "Use digits, spaces and + only").optional().default(""),
  email: z.email("Enter a valid email address").or(z.literal("")).optional().default(""),
  relation: z.string().trim().max(60).optional().default(""),
  dutyLabel: z.string().trim().max(20).optional().default(""),
  joinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the joining date"),
});

export async function saveMember(input: z.input<typeof memberSchema>): Promise<ActionResult<{ id: string }>> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const row = {
    household_id: ctx.householdId,
    unit_id: v.unitId,
    full_name: v.fullName,
    phone: v.phone || null,
    email: v.email || null,
    relation: v.relation || null,
    duty_label: v.dutyLabel || null,
    joined_on: v.joinedOn,
  };
  const q = v.id
    ? ctx.supabase.from("members").update(row).eq("id", v.id).select("id").single()
    : ctx.supabase.from("members").insert(row).select("id").single();
  const { data, error } = await q;
  if (error) return dbError(error);
  revalidatePath("/family");
  return { ok: true, data: { id: data.id }, message: v.id ? "Member updated" : "Member added" };
}

export async function setMemberActive(memberId: string, active: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx) || !z.uuid().safeParse(memberId).success) return forbidden;
  const { error } = await ctx.supabase.rpc("set_member_active", { member: memberId, is_active: active });
  if (error) return dbError(error);
  revalidatePath("/family");
  return { ok: true, data: undefined, message: active ? "Member reactivated" : "Member deactivated. Their history is kept." };
}

export async function setMemberRole(memberId: string, role: "admin" | "member"): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx) || !z.uuid().safeParse(memberId).success || !["admin", "member"].includes(role)) return forbidden;
  const { error } = await ctx.supabase.rpc("set_member_role", { member: memberId, new_role: role });
  if (error) return dbError(error);
  revalidatePath("/family");
  return { ok: true, data: undefined, message: role === "admin" ? "Now an administrator" : "Now a family member" };
}

export async function inviteMember(memberId: string, role: "admin" | "member"): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx) || !z.uuid().safeParse(memberId).success) return forbidden;
  const { data: member } = await ctx.supabase.from("members").select("id, email, user_id, active").eq("id", memberId).single();
  if (!member?.email) return { ok: false, error: "Add an email address to this member first." };
  if (member.user_id) return { ok: false, error: "This member already has an account." };
  if (!member.active) return { ok: false, error: "Reactivate this member before inviting them." };

  await ctx.supabase.from("household_invites").delete().eq("member_id", memberId).is("accepted_at", null);
  const { error: invErr } = await ctx.supabase
    .from("household_invites")
    .insert({ household_id: ctx.householdId, member_id: memberId, email: member.email.toLowerCase(), role, invited_by: ctx.userId });
  if (invErr) return dbError(invErr);

  const admin = createSupabaseAdmin();
  const { error } = await admin.auth.admin.inviteUserByEmail(member.email, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/dashboard`,
  });
  if (error) {
    if (/already been registered|already registered|exists/i.test(error.message)) {
      const { data: uid } = await admin.rpc("link_existing_user", { invite_email: member.email });
      if (uid) {
        revalidatePath("/family");
        return { ok: true, data: undefined, message: "They already had an account and now have access." };
      }
    }
    console.error("Invite failed", error.message);
    return { ok: false, error: "The invitation email could not be sent. Check the email address and try again." };
  }
  revalidatePath("/family");
  return { ok: true, data: undefined, message: `Invitation sent to ${member.email}` };
}
