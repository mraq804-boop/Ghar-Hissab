"use server";

import { z } from "zod";
import { describeSpec, ruleToSpec } from "@/lib/finance";
import { buildChatContext, CHAT_INSTRUCTIONS, type ChatMonth } from "@/lib/chat/context";
import { methodLabel } from "@/lib/labels";
import { periodLabel } from "@/lib/periods";
import { canSeeAllBalances, getContext, isAdmin } from "@/server/auth";
import type { ActionResult } from "@/server/actions/result";
import { askGemini, ChatError } from "@/server/chat/gemini";
import { expenseSpec, getPeriodLedgers, getReference, toPaisa } from "@/server/data/ledger";

const turnsSchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(2000) }))
  .min(1)
  .max(12)
  .refine((t) => t.at(-1)?.role === "user", "The last message must be a question.")
  .refine((t) => (t.at(-1)?.text.length ?? 0) <= 500, "Keep the question under 500 characters.");

const recent = new Map<string, number[]>();
const PER_MINUTE = 8;

function allow(userId: string) {
  const now = Date.now();
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= PER_MINUTE) return false;
  recent.set(userId, [...hits, now]);
  return true;
}

export async function askQuestion(input: { role: "user" | "assistant"; text: string }[]): Promise<ActionResult<{ answer: string }>> {
  const ctx = await getContext();
  const parsed = turnsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That question couldn't be sent." };
  if (!allow(ctx.userId)) return { ok: false, error: "That's a lot of questions at once. Wait a minute and ask again." };

  const ref = await getReference();
  const periods = [...ref.periods].sort((a, b) => b.year - a.year || b.month - a.month).slice(0, 12);
  const ledgers = await getPeriodLedgers(periods);
  const code = (id: string | null) => ref.units.find((u) => u.id === id)?.code ?? "?";
  const ruleName = (id: string | null) => ref.rules.find((r) => r.id === id)?.name;

  const months: ChatMonth[] = ledgers.map((l) => ({
    label: periodLabel(l.period, true),
    status: l.period.status,
    sharedPaisa: l.settlement.splitTotal,
    personalPaisa: l.settlement.unsplitTotal,
    units: l.settlement.units,
    expenses: l.expenses.map((e) => ({
      title: e.title,
      section: ref.sections.find((s) => s.id === e.section_id)?.title ?? "-",
      category: ref.categories.find((c) => c.id === e.category_id)?.name ?? null,
      amountPaisa: toPaisa(e.amount),
      qty: e.qty_num ? String(Number(e.qty_num)) : e.qty_text,
      ratePaisa: toPaisa(e.rate),
      split: (!e.split_override && ruleName(e.split_rule_id)) || describeSpec(expenseSpec(e, ref.rules), code),
      paidBy: e.paid_by_unit_id ? code(e.paid_by_unit_id) : null,
      date: e.expense_date,
    })),
    payments: l.payments
      .filter((p) => p.status !== "rejected")
      .map((p) => ({ payer: code(p.payer_unit_id), amountPaisa: toPaisa(p.amount)!, paidOn: p.paid_on, method: methodLabel(p.method), status: p.status })),
  }));

  const data = buildChatContext({
    today: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date()),
    households: ref.units.filter((u) => u.active).map((u) => ({ code: u.code, isPurseHolder: u.is_purse_holder })),
    rules: ref.rules.filter((r) => r.active).map((r) => `${r.name} = ${describeSpec(ruleToSpec(r), code)}`),
    months,
    scope: {
      seeExpenses: isAdmin(ctx) || ctx.settings.membersSeeAllExpenses,
      seeAllBalances: canSeeAllBalances(ctx),
      ownUnit: ctx.unitId ? code(ctx.unitId) : null,
    },
  });

  try {
    const answer = await askGemini(`${CHAT_INSTRUCTIONS}\n\nDATA:\n${data}`, parsed.data);
    return { ok: true, data: { answer } };
  } catch (e) {
    if (e instanceof ChatError) return { ok: false, error: e.message };
    console.error("Chat failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}
