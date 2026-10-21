"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseRupeesToPaisa, paisaToDecimalString } from "@/lib/finance/money";
import { getContext } from "@/server/auth";
import { dbError, invalid, type ActionResult } from "@/server/actions/result";
import { onPersonalSpending } from "@/server/notify/events";

const amount = z
  .string()
  .trim()
  .transform((s) => s.replace(/,/g, ""))
  .refine((s) => /^\d+(\.\d{1,2})?$/.test(s) && Number(s) > 0, "Enter an amount in rupees.")
  .transform((s) => paisaToDecimalString(parseRupeesToPaisa(s)));

const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

const expenseSchema = z.object({
  id: z.uuid().optional(),
  categoryId: z.uuid().nullable(),
  amount,
  spentOn: z.iso.date("Choose the date."),
  note: z.string().trim().max(200, "Keep the note under 200 characters.").optional().default(""),
  receiptPath: z.string().max(200).nullable().optional(),
  receiptMime: z.enum(RECEIPT_TYPES).nullable().optional(),
});

function done(message: string): ActionResult {
  revalidatePath("/me");
  return { ok: true, data: undefined, message };
}

export async function savePersonalExpense(input: z.input<typeof expenseSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  if (v.receiptPath && !v.receiptPath.startsWith(`${ctx.userId}/`)) return { ok: false, error: "That receipt upload isn't valid. Upload it again." };

  const row = {
    category_id: v.categoryId,
    amount: v.amount,
    spent_on: v.spentOn,
    note: v.note || null,
    ...(v.receiptPath !== undefined ? { receipt_path: v.receiptPath, receipt_mime: v.receiptPath ? (v.receiptMime ?? null) : null } : {}),
    updated_at: new Date().toISOString(),
  };

  if (v.id) {
    const { data: before } = await ctx.supabase.from("personal_expenses").select("receipt_path").eq("id", v.id).maybeSingle();
    if (!before) return { ok: false, error: "That entry couldn't be found." };
    const { error } = await ctx.supabase.from("personal_expenses").update(row).eq("id", v.id);
    if (error) return dbError(error);
    if (v.receiptPath !== undefined && before.receipt_path && before.receipt_path !== v.receiptPath) {
      await ctx.supabase.storage.from("personal-receipts").remove([before.receipt_path]);
    }
    return done("Saved");
  }
  const { error } = await ctx.supabase.from("personal_expenses").insert(row);
  if (error) return dbError(error);
  onPersonalSpending(ctx.userId, ctx.householdId, v.spentOn);
  return done(`Added Rs ${Number(v.amount).toLocaleString("en-US")}`);
}

export async function deletePersonalExpense(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "That entry couldn't be found." };
  const { data, error } = await ctx.supabase.from("personal_expenses").delete().eq("id", id).select("receipt_path");
  if (error) return dbError(error);
  if (!data.length) return { ok: false, error: "That entry couldn't be found." };
  const path = data[0].receipt_path;
  if (path) await ctx.supabase.storage.from("personal-receipts").remove([path]);
  return done("Deleted");
}

const categorySchema = z.object({ id: z.uuid().optional(), name: z.string().trim().min(1, "Give the category a name.").max(40), active: z.boolean().optional() });

export async function savePersonalCategory(input: z.input<typeof categorySchema>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const { error } = v.id
    ? await ctx.supabase.from("personal_categories").update({ name: v.name, ...(v.active === undefined ? {} : { active: v.active }) }).eq("id", v.id)
    : await ctx.supabase.from("personal_categories").insert({ name: v.name, sort_order: 100 });
  if (error) return error.code === "23505" ? { ok: false, error: "You already have a category with that name." } : dbError(error);
  return done(v.id ? "Category saved" : `Category "${v.name}" added`);
}

const budgetSchema = z.object({ categoryId: z.uuid().nullable(), amount: z.union([z.literal(""), amount]) });

export async function savePersonalBudget(input: z.input<typeof budgetSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  const parsed = budgetSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const scope = v.categoryId ? ctx.supabase.from("personal_budgets").delete().eq("category_id", v.categoryId) : ctx.supabase.from("personal_budgets").delete().is("category_id", null);
  const removed = await scope;
  if (removed.error) return dbError(removed.error);
  if (v.amount === "") return done("Budget removed");
  const { error } = await ctx.supabase.from("personal_budgets").insert({ category_id: v.categoryId, amount: v.amount });
  if (error) return dbError(error);
  return done(`Monthly budget set to Rs ${Number(v.amount).toLocaleString("en-US")}`);
}

export async function personalReceiptUrl(id: string): Promise<ActionResult<{ url: string; mime: string | null }>> {
  const ctx = await getContext();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "That receipt couldn't be found." };
  const { data: row } = await ctx.supabase.from("personal_expenses").select("receipt_path, receipt_mime").eq("id", id).maybeSingle();
  if (!row?.receipt_path) return { ok: false, error: "That receipt couldn't be found." };
  const { data, error } = await ctx.supabase.storage.from("personal-receipts").createSignedUrl(row.receipt_path, 120);
  if (error || !data) return { ok: false, error: "The receipt couldn't be opened. Try again." };
  return { ok: true, data: { url: data.signedUrl, mime: row.receipt_mime } };
}
