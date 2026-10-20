import "server-only";
import { allocateExpense, paisaToNumber, type Paisa, type UnitSettlement } from "@/lib/finance";
import { periodLabel, resolvePeriod, type Period } from "@/lib/periods";
import { canSeeAllBalances, getContext } from "@/server/auth";
import { spendingAlerts, type AlertMonth } from "@/lib/smart/alerts";
import { forecastMonth, type ForecastMonth } from "@/lib/smart/forecast";
import { expenseSpec, getPeriodLedgers, getReference, toExpenseInput, toPaisa, unitRefs, type PaymentRow, type PeriodLedger } from "./ledger";

export type DashboardFilters = { m?: string; unit?: string; cat?: string };

export async function getDashboard(filters: DashboardFilters) {
  const ctx = await getContext();
  const ref = await getReference();
  const period = resolvePeriod(ref.periods, filters.m);
  if (!period) return { empty: true as const, isAdmin: ctx.role === "admin" };

  const chronological = [...ref.periods].sort((a, b) => a.year - b.year || a.month - b.month);
  const idx = chronological.findIndex((p) => p.id === period.id);
  const window = chronological.slice(Math.max(0, idx - 5), idx + 1);
  const ledgers = await getPeriodLedgers(window);
  const current = ledgers[ledgers.length - 1];

  const seeAll = canSeeAllBalances(ctx);
  const unitFilter = ref.units.find((u) => u.code === filters.unit) ?? null;
  const categoryFilter = ref.categories.find((c) => c.id === filters.cat) ?? null;
  const visibleUnits = current.settlement.units.filter((u) => seeAll || u.unitId === ctx.unitId);
  const units = unitRefs(ref.units);

  const outstanding = current.settlement.units.reduce((a, u) => a + (u.balancePaisa < 0n ? -u.balancePaisa : 0n), 0n);
  const pendingPayments = current.payments.filter((p) => p.status === "pending");
  const pendingAmount = pendingPayments.reduce((a, p) => a + toPaisa(p.amount)!, 0n);

  const categoryName = (id: string | null, sectionId: string) =>
    ref.categories.find((c) => c.id === id)?.name ?? ref.sections.find((s) => s.id === sectionId)?.title ?? "Other";

  const byCategory = new Map<string, Paisa>();
  for (const e of current.expenses) {
    if (e.amount === null) continue;
    if (categoryFilter && e.category_id !== categoryFilter.id) continue;
    let value: Paisa;
    if (unitFilter) {
      const input = toExpenseInput(e, ref.rules, ref.sections);
      value = allocateExpense(input, units, 1n).find((a) => a.unitId === unitFilter.id)?.sharePaisa ?? 0n;
    } else {
      value = toPaisa(e.amount)!;
    }
    if (value === 0n) continue;
    const name = categoryName(e.category_id, e.section_id);
    byCategory.set(name, (byCategory.get(name) ?? 0n) + value);
  }
  const categories = [...byCategory]
    .map(([name, v]) => ({ name, value: paisaToNumber(v) }))
    .sort((a, b) => b.value - a.value);

  const trend = ledgers.map((l) => {
    const shared = categoryFilter
      ? l.expenses
          .filter((e) => e.category_id === categoryFilter.id && e.amount !== null)
          .reduce((a, e) => a + toPaisa(e.amount)!, 0n)
      : unitFilter
        ? (l.settlement.units.find((u) => u.unitId === unitFilter.id)?.sharePaisa ?? 0n)
        : l.settlement.splitTotal;
    const collected = unitFilter
      ? (l.settlement.units.find((u) => u.unitId === unitFilter.id)?.paidPaisa ?? 0n)
      : l.settlement.totals.paidPaisa;
    return { month: periodLabel(l.period), slug: `${l.period.year}-${l.period.month}`, shared: paisaToNumber(shared), collected: paisaToNumber(collected) };
  });

  const previous = ledgers.length > 1 ? ledgers[ledgers.length - 2] : null;

  const overdue: { period: Period; unit: UnitSettlement }[] = [];
  for (const l of ledgers.slice(0, -1)) {
    for (const u of l.settlement.units) {
      if (u.balancePaisa <= -100n && (seeAll || u.unitId === ctx.unitId)) overdue.push({ period: l.period, unit: u });
    }
  }

  const toAlertMonth = (l: PeriodLedger): AlertMonth => ({
    label: periodLabel(l.period),
    expenses: l.expenses.map((e) => ({
      title: e.title,
      sectionKey: ref.sections.find((s) => s.id === e.section_id)?.key ?? "",
      categoryKey: e.category_id ?? e.section_id,
      categoryName: categoryName(e.category_id, e.section_id),
      amountPaisa: toPaisa(e.amount),
      ratePaisa: toPaisa(e.rate),
    })),
  });
  const [ty, tm, td] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date()).split("-").map(Number);
  const isCurrentMonth = period.year === ty && period.month === tm;
  const isFutureMonth = period.year > ty || (period.year === ty && period.month > tm);
  const alerts =
    (ctx.role === "admin" || ctx.settings.membersSeeAllExpenses) && !isFutureMonth
      ? spendingAlerts(toAlertMonth(current), ledgers.slice(0, -1).reverse().map(toAlertMonth), isCurrentMonth ? td : null)
      : [];

  const toForecastMonth = (l: PeriodLedger): ForecastMonth => ({
    label: periodLabel(l.period),
    items: l.expenses.map((e) => ({
      title: e.title,
      sectionKey: ref.sections.find((s) => s.id === e.section_id)?.key ?? "",
      amountPaisa: toPaisa(e.amount),
      split: expenseSpec(e, ref.rules),
    })),
  });
  const forecast = isCurrentMonth
    ? forecastMonth({
        units,
        current: toForecastMonth(current),
        previous: ledgers.slice(0, -1).reverse().map(toForecastMonth),
        payments: current.payments.filter((p) => p.status === "approved").map((p) => ({ unitId: p.payer_unit_id, amountPaisa: toPaisa(p.amount)! })),
      })
    : null;

  const recentPayments = current.payments
    .filter((p) => !unitFilter || p.payer_unit_id === unitFilter.id)
    .slice(0, 6);

  return {
    empty: false as const,
    isAdmin: ctx.role === "admin",
    seeAll,
    period,
    periods: ref.periods,
    units: ref.units,
    categoriesList: ref.categories,
    unitFilter,
    categoryFilter,
    settlement: current.settlement,
    visibleUnits,
    outstanding,
    pendingPayments: pendingPayments.length,
    pendingAmount,
    expenseCount: current.expenses.length,
    previousSplitTotal: previous?.settlement.splitTotal ?? null,
    previousPeriod: previous?.period ?? null,
    categories,
    trend,
    overdue,
    alerts,
    forecast: forecast && { ...forecast, units: forecast.units.filter((u) => seeAll || u.unitId === ctx.unitId) },
    billsNotIssued: current.expenses.filter((e) => e.amount === null).map((e) => e.title),
    recentPayments: recentPayments as PaymentRow[],
  };
}
