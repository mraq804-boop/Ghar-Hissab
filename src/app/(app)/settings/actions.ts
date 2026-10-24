"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext, isAdmin } from "@/server/auth";
import { dbError, forbidden, invalid, type ActionResult } from "@/server/actions/result";
import { splitFractions } from "@/lib/finance";

const settingsSchema = z.object({
  membersSeeAllExpenses: z.boolean(),
  membersSeeAllBalances: z.boolean(),
  membersSeeReports: z.boolean(),
  maxUploadMb: z.number().int().min(1).max(10),
});

export async function saveSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const p = settingsSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await ctx.supabase
    .from("app_settings")
    .update({
      members_see_all_expenses: p.data.membersSeeAllExpenses,
      members_see_all_balances: p.data.membersSeeAllBalances,
      members_see_reports: p.data.membersSeeReports,
      max_upload_mb: p.data.maxUploadMb,
    })
    .eq("household_id", ctx.householdId);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: "Settings saved" };
}

const categorySchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Enter a name").max(60),
  sectionId: z.uuid(),
  ruleId: z.uuid().nullable(),
  active: z.boolean().default(true),
  kind: z.enum(["essential", "variable"]).default("essential"),
});

export async function saveCategory(input: z.input<typeof categorySchema>): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const p = categorySchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const row = { household_id: ctx.householdId, name: p.data.name, section_id: p.data.sectionId, default_split_rule_id: p.data.ruleId, active: p.data.active, kind: p.data.kind };
  const { error } = p.data.id
    ? await ctx.supabase.from("expense_categories").update(row).eq("id", p.data.id)
    : await ctx.supabase.from("expense_categories").insert({ ...row, sort_order: 100 });
  if (error) return dbError(error);
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true, data: undefined, message: p.data.id ? "Category updated" : "Category added" };
}

const ruleSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(60),
  description: z.string().trim().max(120).optional().default(""),
  type: z.enum(["equal_units", "weights", "percentage"]),
  parts: z.array(z.object({ unitId: z.uuid(), num: z.number().int().min(0).optional(), den: z.number().int().min(1).optional(), percent: z.number().min(0).max(100).optional() })).min(1, "Choose at least one household"),
});

export async function createRule(input: z.input<typeof ruleSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const p = ruleSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  try {
    if (v.type === "weights") splitFractions({ type: "weights", parts: v.parts.map((x) => ({ unitId: x.unitId, num: x.num ?? 0, den: x.den ?? 1 })) });
    if (v.type === "percentage") splitFractions({ type: "percentage", parts: v.parts.map((x) => ({ unitId: x.unitId, percent: x.percent ?? 0 })) });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const code = `R-${v.name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10) || "RULE"}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const { data: rule, error } = await ctx.supabase
    .from("split_rules")
    .insert({ household_id: ctx.householdId, name: v.name, code, type: v.type, description: v.description || null, is_system: false })
    .select("id")
    .single();
  if (error) return dbError(error);
  const { error: partsErr } = await ctx.supabase.from("split_rule_parts").insert(
    v.parts.map((x) => ({ rule_id: rule.id, unit_id: x.unitId, num: v.type === "weights" ? x.num : null, den: v.type === "weights" ? x.den : null, percent: v.type === "percentage" ? x.percent : null })),
  );
  if (partsErr) {
    await ctx.supabase.from("split_rules").delete().eq("id", rule.id);
    return dbError(partsErr);
  }
  revalidatePath("/settings");
  return { ok: true, data: undefined, message: "Rule created" };
}

export async function setRuleActive(id: string, active: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx) || !z.uuid().safeParse(id).success) return forbidden;
  const { error } = await ctx.supabase.from("split_rules").update({ active }).eq("id", id);
  if (error) return dbError(error);
  revalidatePath("/settings");
  return { ok: true, data: undefined, message: active ? "Rule enabled" : "Rule hidden from new expenses" };
}

const passwordSchema = z
  .object({ password: z.string().min(10, "Use at least 10 characters").max(72), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords don't match" });

export async function changePassword(input: z.input<typeof passwordSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  const p = passwordSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await ctx.supabase.auth.updateUser({ password: p.data.password });
  if (error) return { ok: false, error: error.message.includes("same") ? "Choose a password you haven't used before." : "The password could not be changed. Try again." };
  return { ok: true, data: undefined, message: "Password saved" };
}
