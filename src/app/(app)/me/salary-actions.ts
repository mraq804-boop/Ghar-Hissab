"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseRupeesToPaisa, paisaToDecimalString } from "@/lib/finance/money";
import { salaryNote } from "@/lib/personal/salaries";
import { getContext } from "@/server/auth";
import { dbError, invalid, type ActionResult } from "@/server/actions/result";
import { onPersonalSpending } from "@/server/notify/events";

const amount = z
  .string()
  .trim()
  .transform((s) => s.replace(/,/g, ""))
  .refine((s) => /^\d+(\.\d{1,2})?$/.test(s) && Number(s) > 0, "Enter an amount in rupees.")
  .transform((s) => paisaToDecimalString(parseRupeesToPaisa(s)));

const done = (message: string): ActionResult => {
  revalidatePath("/me");
  return { ok: true, data: undefined, message };
};

const staffSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Enter a name.").max(60),
  role: z.string().trim().max(40).optional().default(""),
  monthlySalary: amount,
  payDay: z.number().int().min(1).max(31).nullable(),
  active: z.boolean().optional().default(true),
});

export async function saveStaff(input: z.input<typeof staffSchema>): Promise<ActionResult> {
  const ctx = await getContext();
  const p = staffSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const row = { name: p.data.name, role: p.data.role || null, monthly_salary: p.data.monthlySalary, pay_day: p.data.payDay, active: p.data.active };
  const { error } = p.data.id
    ? await ctx.supabase.from("personal_staff").update(row).eq("id", p.data.id)
    : await ctx.supabase.from("personal_staff").insert(row);
  if (error) return dbError(error);
  return done(p.data.id ? `${p.data.name} updated` : `${p.data.name} added`);
}

export async function deleteStaff(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "That person couldn't be found." };
  const { count } = await ctx.supabase.from("personal_salary_payments").select("id", { count: "exact", head: true }).eq("staff_id", id);
  if (count) {
    const { error } = await ctx.supabase.from("personal_staff").update({ active: false }).eq("id", id);
    if (error) return dbError(error);
    return done("Moved to past staff. Their payments stay in your spending.");
  }
  const { error } = await ctx.supabase.from("personal_staff").delete().eq("id", id);
  if (error) return dbError(error);
  return done("Removed");
}

const paySchema = z
  .object({
    staffId: z.uuid(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month."),
    kind: z.enum(["salary", "advance", "bonus"]),
    amount,
    paidOn: z.iso.date("Choose the date."),
    note: z.string().trim().max(120).optional().default(""),
  });

/** Records a payment to a staff member and the matching entry in the person's own spending. */
export async function paySalary(input: z.input<typeof paySchema>): Promise<ActionResult> {
  const ctx = await getContext();
  const p = paySchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;

  const { data: staff } = await ctx.supabase.from("personal_staff").select("id, name, role").eq("id", v.staffId).maybeSingle();
  if (!staff) return { ok: false, error: "That person couldn't be found." };

  const categoryId = await salariesCategory();
  if (typeof categoryId !== "string") return categoryId;

  const { data: expense, error } = await ctx.supabase
    .from("personal_expenses")
    .insert({ category_id: categoryId, amount: v.amount, spent_on: v.paidOn, note: salaryNote(v.kind, staff, v.note) })
    .select("id")
    .single();
  if (error) return dbError(error);
  const link = await ctx.supabase
    .from("personal_salary_payments")
    .insert({ staff_id: v.staffId, month: `${v.month}-01`, kind: v.kind, amount: v.amount, paid_on: v.paidOn, note: v.note || null, expense_id: expense.id });
  if (link.error) {
    await ctx.supabase.from("personal_expenses").delete().eq("id", expense.id);
    return dbError(link.error);
  }
  onPersonalSpending(ctx.userId, ctx.householdId, v.paidOn);
  const what = v.kind === "salary" ? "Salary" : v.kind === "advance" ? "Advance" : "Bonus";
  return done(`${what} of Rs ${Number(v.amount).toLocaleString("en-US")} to ${staff.name} recorded`);
}

export async function deleteSalaryPayment(id: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "That payment couldn't be found." };
  const { data: row, error } = await ctx.supabase.from("personal_salary_payments").delete().eq("id", id).select("expense_id").maybeSingle();
  if (error) return dbError(error);
  if (!row) return { ok: false, error: "That payment couldn't be found." };
  if (row.expense_id) await ctx.supabase.from("personal_expenses").delete().eq("id", row.expense_id);
  return done("Payment removed");
}

async function salariesCategory(): Promise<string | ActionResult> {
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("personal_categories").select("id, active").ilike("name", "salaries").maybeSingle();
  if (data) {
    if (!data.active) await ctx.supabase.from("personal_categories").update({ active: true }).eq("id", data.id);
    return data.id;
  }
  const created = await ctx.supabase.from("personal_categories").insert({ name: "Salaries", sort_order: 9 }).select("id").single();
  if (created.error) return dbError(created.error);
  return created.data.id;
}
