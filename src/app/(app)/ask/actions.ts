"use server";

import { z } from "zod";
import { describeSpec, ruleToSpec } from "@/lib/finance";
import { buildChatContext, CHAT_INSTRUCTIONS, type ChatBill, type ChatMonth, type ChatPersonal, type ChatPlanItem } from "@/lib/chat/context";
import { PROVIDERS, isProvider } from "@/lib/utilities/providers";
import { methodLabel } from "@/lib/labels";
import { periodLabel } from "@/lib/periods";
import { canSeeAllBalances, getContext, isAdmin } from "@/server/auth";
import type { ActionResult } from "@/server/actions/result";
import { askGemini, ChatError } from "@/server/chat/gemini";
import { expenseSpec, getPeriodLedgers, getReference, toPaisa } from "@/server/data/ledger";
import { getMeterWatches } from "@/server/data/meter-watch";

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

  const { data: billRows } = await ctx.supabase
    .from("utility_bills")
    .select("bill_month, payable, due_date, late_payments, units, expense_id, utility_meters(label, provider)")
    .order("bill_month", { ascending: false })
    .limit(24);
  const bills: ChatBill[] = (billRows ?? []).map((b) => {
    const meter = b.utility_meters as unknown as { label: string; provider: string } | null;
    const p = meter && isProvider(meter.provider) ? PROVIDERS[meter.provider] : null;
    return {
      connection: meter?.label ?? "?",
      company: p?.name ?? "?",
      utility: p?.utility ?? "?",
      month: periodLabel({ year: Number(b.bill_month.slice(0, 4)), month: Number(b.bill_month.slice(5, 7)) }, true),
      payablePaisa: toPaisa(b.payable)!,
      dueDate: b.due_date,
      latePayments: ((b.late_payments ?? []) as { until: string | null; amount: number }[]).map((l) => ({ until: l.until, amountPaisa: toPaisa(l.amount)! })),
      units: b.units,
      inExpenses: Boolean(b.expense_id),
    };
  });

  const sixMonthsAgo = new Date(Date.now() - 183 * 86400_000).toISOString().slice(0, 10);
  const [{ data: ownRows }, { data: ownCats }] = await Promise.all([
    ctx.supabase.from("personal_expenses").select("spent_on, amount, category_id").eq("user_id", ctx.userId).gte("spent_on", sixMonthsAgo).order("spent_on", { ascending: false }).limit(400),
    ctx.supabase.from("personal_categories").select("id, name").eq("user_id", ctx.userId),
  ]);
  const personal: ChatPersonal = (ownRows ?? []).map((r) => ({
    date: r.spent_on,
    category: ownCats?.find((c) => c.id === r.category_id)?.name ?? "Uncategorised",
    amountPaisa: toPaisa(r.amount)!,
  }));

  const nowMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date()).slice(0, 7);
  const [ny, nm] = nowMonth.split("-").map(Number);
  const nextMonth = nm === 12 ? `${ny + 1}-01` : `${ny}-${String(nm + 1).padStart(2, "0")}`;
  const { data: planRows } = await ctx.supabase
    .from("personal_plan_items")
    .select("month, title, category_id, estimate, status, due_date, personal_expenses(amount)")
    .eq("user_id", ctx.userId)
    .in("month", [`${nowMonth}-01`, `${nextMonth}-01`])
    .order("month");
  const plan: ChatPlanItem[] = (planRows ?? []).map((r) => ({
    month: r.month.slice(0, 7),
    title: r.title,
    category: ownCats?.find((c) => c.id === r.category_id)?.name ?? "Other",
    estimatePaisa: toPaisa(r.estimate)!,
    actualPaisa: (r.personal_expenses as unknown as { amount: string } | null) ? toPaisa((r.personal_expenses as unknown as { amount: string }).amount) : null,
    status: r.status,
    dueDate: r.due_date,
  }));

  const data = buildChatContext({
    today: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date()),
    households: ref.units.filter((u) => u.active).map((u) => ({ code: u.code, isPurseHolder: u.is_purse_holder })),
    rules: ref.rules.filter((r) => r.active).map((r) => `${r.name} = ${describeSpec(ruleToSpec(r), code)}`),
    months,
    bills,
    personal,
    plan,
    meters: (await getMeterWatches()).map((w) => ({ label: w.label, limit: w.limit, baseline: w.baseline, baselineDate: w.baselineDate, nextReadingDate: w.nextReadingDate, latest: w.latest, latestAt: w.latestAt, used: w.used, projected: w.projected, allowancePerDay: w.allowancePerDay, history: w.history })),
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
