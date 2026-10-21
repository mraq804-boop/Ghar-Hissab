import "server-only";
import { after } from "next/server";
import { formatPaisa, parseRupeesToPaisa } from "@/lib/finance/money";
import { budgetStatus, daysIn } from "@/lib/personal/budget";
import { MONTHS_LONG } from "@/lib/periods";
import { karachi } from "@/lib/notify/rules";
import { PROVIDERS, isProvider } from "@/lib/utilities/providers";
import { loadMeterWatches } from "@/server/data/meter-watch";
import { createSupabaseAdmin } from "@/server/supabase/admin";
import { admins, everyone, householdPeople, ofUnit } from "./audience";
import { notify } from "./push";

/** Runs a notification after the response is sent; failures are logged, never shown to the user. */
function later(label: string, fn: () => Promise<unknown>) {
  after(async () => {
    try {
      await fn();
    } catch (e) {
      console.error(`Notification (${label}) failed`, e instanceof Error ? e.message : e);
    }
  });
}

const rs = (amount: string | number) => formatPaisa(parseRupeesToPaisa(String(Number(amount).toFixed(2))));

async function paymentInfo(paymentId: string) {
  const db = createSupabaseAdmin();
  const { data } = await db
    .from("payments")
    .select("id, household_id, payer_unit_id, amount, status, units:payer_unit_id(code), periods(year, month), payment_reviews(decision, reason, created_at)")
    .eq("id", paymentId)
    .maybeSingle();
  if (!data) return null;
  const period = data.periods as unknown as { year: number; month: number } | null;
  return {
    db,
    p: data,
    code: (data.units as unknown as { code: string } | null)?.code ?? "",
    month: period ? MONTHS_LONG[period.month - 1] : "",
  };
}

export function onPaymentSubmitted(paymentId: string) {
  later("payment submitted", async () => {
    const info = await paymentInfo(paymentId);
    if (!info || info.p.status !== "pending") return;
    const people = await householdPeople(info.db, info.p.household_id);
    await notify(info.p.household_id, admins(people), { category: "payments", title: `${info.code} sent ${rs(info.p.amount)}${info.month ? ` for ${info.month}` : ""}`, body: "Tap to check the screenshot and approve.", url: "/payments?status=pending", dedupeKey: `payment-${paymentId}-submitted` }, info.db);
  });
}

export function onPaymentReviewed(paymentId: string) {
  later("payment reviewed", async () => {
    const info = await paymentInfo(paymentId);
    if (!info || info.p.status === "pending") return;
    const people = await householdPeople(info.db, info.p.household_id);
    const review = ((info.p.payment_reviews ?? []) as { decision: string; reason: string | null; created_at: string }[]).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const approved = info.p.status === "approved";
    await notify(
      info.p.household_id,
      ofUnit(people, info.p.payer_unit_id),
      {
        category: "payments",
        title: `Your ${rs(info.p.amount)} payment was ${approved ? "approved" : "rejected"}`,
        body: approved ? `It now counts towards ${info.code}'s ${info.month} share.` : review?.reason ? `Reason: ${review.reason}` : "Open Payments to see why.",
        url: "/payments",
        dedupeKey: `payment-${paymentId}-${info.p.status}`,
      },
      info.db,
    );
  });
}

export function onBillArrived(householdId: string, meterId: string, billMonth: string) {
  later("bill arrived", async () => {
    const db = createSupabaseAdmin();
    const { data: bill } = await db
      .from("utility_bills")
      .select("id, payable, due_date, utility_meters(label, provider)")
      .eq("meter_id", meterId)
      .eq("bill_month", `${billMonth}-01`)
      .maybeSingle();
    if (!bill) return;
    const meter = bill.utility_meters as unknown as { label: string; provider: string };
    const company = isProvider(meter.provider) ? PROVIDERS[meter.provider].name : "";
    const due = bill.due_date ? `, due ${new Date(`${bill.due_date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "";
    const people = await householdPeople(db, householdId);
    await notify(householdId, everyone(people), { category: "bills", title: `${meter.label} ${company} bill arrived: ${rs(bill.payable)}${due}`, body: "Tap to see the bill.", url: `/bills/view?id=${bill.id}`, dedupeKey: `bill-${bill.id}-arrived` }, db);
  });
}

export function onMeterReading(householdId: string, meterId: string) {
  later("meter reading", async () => {
    const db = createSupabaseAdmin();
    const w = (await loadMeterWatches(db, householdId, null)).find((x) => x.meterId === meterId);
    if (!w || (w.level !== "watch" && w.level !== "over")) return;
    const people = await householdPeople(db, householdId);
    const over = w.used !== null && w.used >= w.limit;
    await notify(
      householdId,
      everyone(people),
      {
        category: "meters",
        title: over ? `${w.label} is over ${w.limit} units` : `${w.label} heading for ${w.projected ?? w.used} units`,
        body: !over && w.allowancePerDay !== null ? `Keep to about ${w.allowancePerDay} units a day until ${w.nextReadingDate.slice(8, 10)}/${w.nextReadingDate.slice(5, 7)} to stay under ${w.limit}.` : `${w.used} units used since LESCO read ${w.baseline}.`,
        url: "/bills",
        dedupeKey: `meter-${meterId}-${w.baselineDate}-${over ? "over" : w.level}`,
      },
      db,
    );
  });
}

/** Private to the person: a budget crossing after they record their own spending. */
export function onPersonalSpending(userId: string, householdId: string, spentOn: string) {
  later("personal budget", async () => {
    const db = createSupabaseAdmin();
    const month = spentOn.slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const [{ data: budgets }, { data: rows }, { data: cats }] = await Promise.all([
      db.from("personal_budgets").select("category_id, amount").eq("user_id", userId),
      db.from("personal_expenses").select("category_id, amount").eq("user_id", userId).gte("spent_on", `${month}-01`).lt("spent_on", next),
      db.from("personal_categories").select("id, name").eq("user_id", userId),
    ]);
    const local = karachi(new Date());
    const dayOfMonth = local.date.slice(0, 7) === month ? local.day : null;
    for (const b of budgets ?? []) {
      const spent = (rows ?? []).filter((r) => !b.category_id || r.category_id === b.category_id).reduce((a, r) => a + Number(r.amount), 0);
      const s = budgetStatus(spent, Number(b.amount), dayOfMonth, daysIn(month));
      if (s.state !== "near" && s.state !== "over") continue;
      const name = b.category_id ? (cats?.find((c) => c.id === b.category_id)?.name ?? "Category") : "Monthly";
      await notify(
        householdId,
        [userId],
        {
          category: "personal",
          title: s.state === "over" ? `${name} budget is over` : `${name} budget ${s.percent}% used`,
          body: s.state === "over" ? `Rs ${Math.round(spent - s.budget).toLocaleString("en-US")} over the Rs ${s.budget.toLocaleString("en-US")} budget.` : `Rs ${Math.round(s.left).toLocaleString("en-US")} left this month.`,
          url: "/me",
          dedupeKey: `budget-${b.category_id ?? "all"}-${month}-${s.state}`,
        },
        db,
      );
    }
  });
}
