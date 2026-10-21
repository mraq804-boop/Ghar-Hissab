import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatPaisa } from "@/lib/finance/money";
import { MONTHS_LONG } from "@/lib/periods";
import { advancePast, daysBetween, karachi, scheduleAt, weekKey } from "@/lib/notify/rules";
import { PROVIDERS, isProvider } from "@/lib/utilities/providers";
import { loadMeterWatches } from "@/server/data/meter-watch";
import { admins, everyone, householdPeople, ofUnit } from "./audience";
import { settlementFor } from "./ledger";
import { deliverDue, notify } from "./push";

const dayMonth = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-US")}`;

/** One pass of every scheduled notification. Safe to run often: each message is sent once per key. */
export async function runScheduled(db: SupabaseClient, now = new Date()) {
  const local = karachi(now);
  const due = scheduleAt(local);
  const week = weekKey(local);
  const counts: Record<string, number> = {};
  const add = (k: string, n: number) => (counts[k] = (counts[k] ?? 0) + n);

  const { data: households } = await db.from("households").select("id");
  for (const { id: householdId } of households ?? []) {
    const people = await householdPeople(db, householdId);
    if (!people.length) continue;

    if (due.pendingDigest) {
      const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("household_id", householdId).eq("status", "pending");
      if (count) {
        const r = await notify(householdId, admins(people), { category: "payments", title: `${count} payment${count === 1 ? "" : "s"} waiting for approval`, body: "Check each screenshot and approve or reject.", url: "/payments?status=pending", dedupeKey: `pending-${local.date}` }, db);
        add("pending", r.created);
      }
    }

    if (due.billDueCheck) {
      const soon = new Date(Date.parse(`${local.date}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
      const { data: bills } = await db
        .from("utility_bills")
        .select("id, due_date, payable, late_payments, utility_meters(label, provider)")
        .eq("household_id", householdId)
        .gte("due_date", local.date)
        .lte("due_date", soon);
      for (const b of bills ?? []) {
        const days = daysBetween(local.date, b.due_date as string);
        if (days !== 0 && days !== 2) continue;
        const meter = b.utility_meters as unknown as { label: string; provider: string } | null;
        const company = meter && isProvider(meter.provider) ? PROVIDERS[meter.provider].name : "";
        const late = ((b.late_payments ?? []) as { amount: number }[])[0];
        const r = await notify(
          householdId,
          everyone(people),
          {
            category: "bills",
            title: `${meter?.label ?? "Bill"} ${company} bill due ${days === 0 ? "today" : `in 2 days (${dayMonth(b.due_date as string)})`}`,
            body: `${rs(Number(b.payable))} to pay${late ? `; ${rs(late.amount)} after the due date` : ""}.`,
            url: `/bills/view?id=${b.id}`,
            dedupeKey: `bill-due-${b.id}-${days}`,
          },
          db,
        );
        add("billDue", r.created);
      }
    }

    if (due.meterReminder) {
      for (const w of await loadMeterWatches(db, householdId, null)) {
        if (!w.stale || w.daysLeft <= 2) continue;
        const r = await notify(householdId, everyone(people), { category: "meters", title: `Read the ${w.label} meter`, body: w.latestAt ? "No reading for over a week. A photo is enough." : `No reading yet since LESCO read ${w.baseline}.`, url: "/bills", dedupeKey: `meter-read-${w.meterId}-${week}` }, db);
        add("meterRead", r.created);
      }
    }

    if (due.owedReminder) {
      const target = local.day === 1 ? { year: local.month === 1 ? local.year - 1 : local.year, month: local.month === 1 ? 12 : local.month - 1 } : { year: local.year, month: local.month };
      const s = await settlementFor(db, householdId, target.year, target.month);
      for (const u of s?.settlement.units ?? []) {
        if (u.balancePaisa > -100n) continue;
        const r = await notify(householdId, ofUnit(people, u.unitId), { category: "money", title: `${u.code} still owes ${formatPaisa(-u.balancePaisa)} for ${MONTHS_LONG[target.month - 1]}`, body: `Share ${formatPaisa(u.sharePaisa)}, paid ${formatPaisa(u.paidPaisa)}. Record the payment with its screenshot.`, url: "/payments?new=1", dedupeKey: `owed-${s!.periodId}-${u.unitId}-${local.date}` }, db);
        add("owed", r.created);
      }
    }

    if (due.monthStart) {
      const { data: period } = await db.from("periods").select("id").eq("household_id", householdId).eq("year", local.year).eq("month", local.month).maybeSingle();
      if (!period) {
        const r = await notify(householdId, admins(people), { category: "money", title: `Start ${MONTHS_LONG[local.month - 1]} in Expenses`, body: "A new month has begun. Start it so the family can add expenses and payments.", url: "/expenses", dedupeKey: `month-start-${local.year}-${local.month}` }, db);
        add("monthStart", r.created);
      }
    }

    if (due.weeklySummary) {
      const s = await settlementFor(db, householdId, local.year, local.month);
      if (s) {
        for (const p of people) {
          const u = s.settlement.units.find((x) => x.unitId === p.unit_id);
          const mine = u ? ` · ${u.code} share ${formatPaisa(u.sharePaisa)} · paid ${formatPaisa(u.paidPaisa)} · ${u.balancePaisa < 0n ? `left ${formatPaisa(-u.balancePaisa)}` : "settled"}` : "";
          const r = await notify(householdId, [p.user_id], { category: "summary", title: `${MONTHS_LONG[local.month - 1]} so far`, body: `Shared spending ${formatPaisa(s.settlement.splitTotal)}${mine}.`, url: "/dashboard", dedupeKey: `summary-${week}` }, db);
          add("summary", r.created);
        }
      }
    }

    const { data: reminders } = await db.from("reminders").select("id, created_by, audience, title, note, next_at, repeat").eq("household_id", householdId).eq("active", true).lte("next_at", now.toISOString());
    for (const rem of reminders ?? []) {
      const to = rem.audience === "family" ? everyone(people) : [rem.created_by];
      const r = await notify(householdId, to, { category: "reminders", title: rem.title, body: rem.note ?? undefined, url: "/reminders", dedupeKey: `reminder-${rem.id}-${rem.next_at}` }, db);
      add("reminders", r.created);
      const next = advancePast(new Date(rem.next_at), rem.repeat, now);
      await db.from("reminders").update(next ? { next_at: next.toISOString() } : { active: false }).eq("id", rem.id);
    }
  }

  const held = await deliverDue(db);
  return { at: now.toISOString(), local: `${local.date} ${local.hour}:${String(local.minute).padStart(2, "0")}`, created: counts, delivered: held.sent };
}
