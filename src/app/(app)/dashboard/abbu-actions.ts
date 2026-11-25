"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext, isAdmin } from "@/server/auth";
import { dbError, forbidden, invalid, type ActionResult } from "@/server/actions/result";

const entrySchema = z.object({
  kind: z.enum(["paid", "returned"]),
  amount: z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter the amount in rupees").refine((a) => Number(a) > 0, "Enter the amount in rupees"),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date"),
  note: z.string().trim().max(200).optional().default(""),
});

export async function addAbbuEntry(input: z.input<typeof entrySchema>): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const { error } = await ctx.supabase
    .from("abbu_money")
    .insert({ household_id: ctx.householdId, kind: v.kind, amount: v.amount, on_date: v.onDate, note: v.note || null });
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: v.kind === "returned" ? "Return to Abbu saved" : "Abbu's payment saved" };
}

export async function deleteAbbuEntry(input: { id: string }): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { data: row } = await ctx.supabase.from("abbu_money").select("expense_id").eq("id", parsed.data.id).maybeSingle();
  if (row?.expense_id) return { ok: false, error: "This came from an expense. Change who paid on that expense instead." };
  const { error } = await ctx.supabase.from("abbu_money").delete().eq("id", parsed.data.id);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: "Entry removed" };
}
