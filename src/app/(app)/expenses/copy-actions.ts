"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatPaisa } from "@/lib/finance/money";
import { copyTotal, type CopyItem } from "@/lib/expenses/copy";
import { getContext, isAdmin } from "@/server/auth";
import { getExpenses, getReference, toPaisa } from "@/server/data/ledger";
import { dbError, forbidden, invalid, type ActionResult } from "@/server/actions/result";
import { kickSync } from "@/server/excel/kick";

const pair = z.object({ fromPeriodId: z.uuid(), toPeriodId: z.uuid() }).refine((v) => v.fromPeriodId !== v.toPeriodId, "Choose a different month to copy from.");

export type CopySource = { items: (CopyItem & { qtyNum: string | null; rate: string | null })[]; target: { title: string; categoryId: string | null }[] };

/** Last month's expenses, and what the new month already has, for the copy dialog. */
export async function copySource(input: z.input<typeof pair>): Promise<ActionResult<CopySource>> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const p = pair.safeParse(input);
  if (!p.success) return invalid(p.error);
  const ref = await getReference();
  const sectionOrder = (id: string) => ref.sections.findIndex((s) => s.id === id);
  const [from, to] = await Promise.all([getExpenses([p.data.fromPeriodId]), getExpenses([p.data.toPeriodId])]);
  const items = [...from]
    .sort((a, b) => sectionOrder(a.section_id) - sectionOrder(b.section_id) || a.sort_order - b.sort_order)
    .map((e) => ({
      id: e.id,
      title: e.title,
      categoryId: e.category_id,
      categoryName: ref.categories.find((c) => c.id === e.category_id)?.name ?? ref.sections.find((s) => s.id === e.section_id)?.title ?? "Other",
      qtyText: e.qty_text,
      qtyNum: e.qty_num,
      rate: e.rate,
      amountPaisa: toPaisa(e.amount),
    }));
  return { ok: true, data: { items, target: to.map((e) => ({ title: e.title, categoryId: e.category_id })) } };
}

const copySchema = z.object({ fromPeriodId: z.uuid(), toPeriodId: z.uuid(), ids: z.array(z.uuid()).min(1, "Tick at least one item.").max(300) });

/** Copies the chosen items into the new month: same item, quantity, rate, amount and sharing; no date, receipt or notes; paid from the purse. */
export async function copyExpenses(input: z.input<typeof copySchema>): Promise<ActionResult<{ count: number }>> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const p = copySchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  if (v.fromPeriodId === v.toPeriodId) return { ok: false, error: "Choose a different month to copy from." };

  const ref = await getReference();
  const target = ref.periods.find((x) => x.id === v.toPeriodId);
  if (!target || !ref.periods.some((x) => x.id === v.fromPeriodId)) return { ok: false, error: "That month no longer exists." };
  if (target.status === "closed") return { ok: false, error: "This month is closed. Reopen it to add expenses." };

  const sectionOrder = (id: string) => ref.sections.findIndex((s) => s.id === id);
  const wanted = new Set(v.ids);
  const rows = (await getExpenses([v.fromPeriodId]))
    .filter((e) => wanted.has(e.id))
    .sort((a, b) => sectionOrder(a.section_id) - sectionOrder(b.section_id) || a.sort_order - b.sort_order);
  if (rows.length !== wanted.size) return { ok: false, error: "Some items changed. Open the list again and retry." };

  let count = 0;
  for (const e of rows) {
    const { error } = await ctx.supabase.rpc("upsert_expense", {
      p: {
        household_id: ctx.householdId,
        period_id: v.toPeriodId,
        section_id: e.section_id,
        category_id: e.category_id,
        title: e.title,
        description: e.description ?? "",
        qty_text: e.qty_text ?? "",
        qty_num: e.qty_num ?? "",
        rate: e.rate ?? "",
        amount: e.amount ?? "",
        split_rule_id: e.split_rule_id,
        split_override: e.split_override,
        expense_date: "",
        paid_by_unit_id: null,
        notes: "",
      },
    });
    if (error) {
      if (count) {
        revalidatePath("/", "layout");
        kickSync();
      }
      const failed = dbError(error);
      return { ok: false, error: `${count} copied, then "${e.title}" failed: ${failed.ok ? "" : failed.error}` };
    }
    count++;
  }

  revalidatePath("/", "layout");
  kickSync();
  const total = copyTotal(
    rows.map((e) => ({ id: e.id, title: e.title, categoryId: e.category_id, categoryName: "", qtyText: null, amountPaisa: toPaisa(e.amount) })),
    v.ids,
  );
  return { ok: true, data: { count }, message: `${count} item${count === 1 ? "" : "s"} copied (${formatPaisa(total)})` };
}
