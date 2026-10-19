import "server-only";
import { format } from "date-fns";
import { describeSpec, type Paisa } from "@/lib/finance";
import { methodLabel } from "@/lib/labels";
import { periodLabel, periodSlug, type Period } from "@/lib/periods";
import { canSeeAllBalances, canSeeReports, getContext, isAdmin } from "@/server/auth";
import { expenseSpec, getPeriodLedgers, getReference, toPaisa } from "@/server/data/ledger";

export const REPORT_TYPES = [
  { key: "monthly", label: "Monthly household expenses" },
  { key: "annual", label: "Annual expenses" },
  { key: "contributions", label: "Household contributions" },
  { key: "shares", label: "Household expense shares" },
  { key: "payments", label: "Payment history" },
  { key: "pending", label: "Pending payments" },
  { key: "balances", label: "Outstanding balances" },
  { key: "categories", label: "Spending by category" },
  { key: "comparison", label: "Expenses compared with contributions" },
  { key: "expenses", label: "Expense list" },
] as const;

export type ReportType = (typeof REPORT_TYPES)[number]["key"];

export type ColumnKind = "text" | "money" | "status" | "date";
export type Column = { key: string; label: string; kind: ColumnKind };
export type Cell = string | bigint | null;
export type Report = {
  type: ReportType;
  title: string;
  subtitle: string;
  columns: Column[];
  rows: Record<string, Cell>[];
  totals: Record<string, Cell> | null;
  generatedAt: string;
};

export type ReportFilters = {
  from?: string;
  to?: string;
  unit?: string;
  category?: string;
  status?: string;
};

export class ReportAccessError extends Error {}

function inRange(p: Period, from?: string, to?: string) {
  const s = periodSlug(p);
  return (!from || s >= from) && (!to || s <= to);
}

const sum = (rows: Record<string, Cell>[], key: string): bigint =>
  rows.reduce((a, r) => a + (typeof r[key] === "bigint" ? (r[key] as bigint) : 0n), 0n);

export async function buildReport(type: ReportType, f: ReportFilters): Promise<Report> {
  const ctx = await getContext();
  if (!canSeeReports(ctx)) throw new ReportAccessError("Reports are only available to administrators in this household.");
  const ref = await getReference();
  const seeAll = canSeeAllBalances(ctx);
  const periods = ref.periods.filter((p) => inRange(p, f.from, f.to)).sort((a, b) => a.year - b.year || a.month - b.month);
  const ledgers = await getPeriodLedgers(periods);
  const allowedUnits = ref.units.filter((u) => (seeAll || u.id === ctx.unitId) && (!f.unit || u.code === f.unit));
  const unitCols: Column[] = allowedUnits.map((u) => ({ key: u.id, label: u.code, kind: "money" }));
  const range = periods.length ? `${periodLabel(periods[0], true)} to ${periodLabel(periods[periods.length - 1], true)}` : "No months in range";
  const catName = (id: string | null, sectionId: string) =>
    ref.categories.find((c) => c.id === id)?.name ?? ref.sections.find((s) => s.id === sectionId)?.title ?? "Other";
  const base = { type, generatedAt: new Date().toISOString(), subtitle: range + (f.unit ? `, ${f.unit} household` : "") };
  const code = (id: string) => ref.units.find((u) => u.id === id)?.code ?? "?";
  const expenseVisible = isAdmin(ctx) || ctx.settings.membersSeeAllExpenses;

  switch (type) {
    case "monthly": {
      if (!expenseVisible) throw new ReportAccessError("Expense details are private in this household.");
      const rows = ledgers.map((l) => ({
        month: periodLabel(l.period, true),
        total: l.settlement.grandTotal,
        shared: l.settlement.splitTotal,
        personal: l.settlement.unsplitTotal,
        paid: l.settlement.totals.paidPaisa,
        outstanding: l.settlement.units.reduce((a, u) => a + (u.balancePaisa < 0n ? -u.balancePaisa : 0n), 0n),
      }));
      return {
        ...base,
        title: "Monthly household expenses",
        columns: [
          { key: "month", label: "Month", kind: "text" },
          { key: "total", label: "All expenses", kind: "money" },
          { key: "shared", label: "Shared", kind: "money" },
          { key: "personal", label: "Not shared", kind: "money" },
          { key: "paid", label: "Approved payments", kind: "money" },
          { key: "outstanding", label: "Still owed", kind: "money" },
        ],
        rows,
        totals: { month: "Total", total: sum(rows, "total"), shared: sum(rows, "shared"), personal: sum(rows, "personal"), paid: sum(rows, "paid"), outstanding: sum(rows, "outstanding") },
      };
    }
    case "annual": {
      if (!expenseVisible) throw new ReportAccessError("Expense details are private in this household.");
      const years = [...new Set(ledgers.map((l) => l.period.year))];
      const rows = years.map((y) => {
        const ls = ledgers.filter((l) => l.period.year === y);
        const s = (fn: (l: (typeof ls)[number]) => bigint) => ls.reduce((a, l) => a + fn(l), 0n);
        return { year: String(y), months: String(ls.length), total: s((l) => l.settlement.grandTotal), shared: s((l) => l.settlement.splitTotal), paid: s((l) => l.settlement.totals.paidPaisa) };
      });
      return {
        ...base,
        title: "Annual expenses",
        columns: [
          { key: "year", label: "Year", kind: "text" },
          { key: "months", label: "Months", kind: "text" },
          { key: "total", label: "All expenses", kind: "money" },
          { key: "shared", label: "Shared", kind: "money" },
          { key: "paid", label: "Approved payments", kind: "money" },
        ],
        rows,
        totals: { year: "Total", months: String(ledgers.length), total: sum(rows, "total"), shared: sum(rows, "shared"), paid: sum(rows, "paid") },
      };
    }
    case "contributions":
    case "shares":
    case "balances": {
      const field = type === "contributions" ? "paidPaisa" : type === "shares" ? "sharePaisa" : "balancePaisa";
      const rows = ledgers.map((l) => {
        const row: Record<string, Cell> = { month: periodLabel(l.period, true) };
        for (const u of allowedUnits) row[u.id] = l.settlement.units.find((x) => x.unitId === u.id)![field];
        return row;
      });
      const totals: Record<string, Cell> = { month: "Total" };
      for (const u of allowedUnits) totals[u.id] = sum(rows, u.id);
      return {
        ...base,
        title: type === "contributions" ? "Household contributions (approved payments)" : type === "shares" ? "Household expense shares" : "Outstanding balances (paid minus share)",
        columns: [{ key: "month", label: "Month", kind: "text" }, ...unitCols],
        rows,
        totals,
      };
    }
    case "payments":
    case "pending": {
      const status = type === "pending" ? "pending" : f.status;
      const rows = ledgers
        .flatMap((l) => l.payments.map((p) => ({ p, l })))
        .filter(({ p }) => allowedUnits.some((u) => u.id === p.payer_unit_id) && (!status || p.status === status))
        .sort((a, b) => b.p.paid_on.localeCompare(a.p.paid_on))
        .map(({ p, l }) => ({
          date: p.paid_on,
          household: code(p.payer_unit_id),
          month: periodLabel(l.period, true),
          method: methodLabel(p.method),
          reference: p.reference ?? "",
          amount: toPaisa(p.amount),
          status: p.status,
        }));
      return {
        ...base,
        title: type === "pending" ? "Pending payments" : "Payment history",
        columns: [
          { key: "date", label: "Paid on", kind: "date" },
          { key: "household", label: "Household", kind: "text" },
          { key: "month", label: "For", kind: "text" },
          { key: "method", label: "Method", kind: "text" },
          { key: "reference", label: "Transaction ID", kind: "text" },
          { key: "amount", label: "Amount", kind: "money" },
          { key: "status", label: "Status", kind: "status" },
        ],
        rows,
        totals: { date: "Total", amount: sum(rows, "amount") },
      };
    }
    case "categories": {
      if (!expenseVisible) throw new ReportAccessError("Expense details are private in this household.");
      const map = new Map<string, Paisa>();
      for (const l of ledgers) for (const e of l.expenses) {
        if (e.amount === null || (f.category && e.category_id !== f.category)) continue;
        const k = catName(e.category_id, e.section_id);
        map.set(k, (map.get(k) ?? 0n) + toPaisa(e.amount)!);
      }
      const rows = [...map].sort((a, b) => Number(b[1] - a[1])).map(([category, amount]) => ({ category, amount }));
      return {
        ...base,
        title: "Spending by category",
        columns: [{ key: "category", label: "Category", kind: "text" }, { key: "amount", label: "Amount", kind: "money" }],
        rows,
        totals: { category: "Total", amount: sum(rows, "amount") },
      };
    }
    case "comparison": {
      if (!expenseVisible && !f.unit) throw new ReportAccessError("Expense details are private in this household.");
      const rows = ledgers.map((l) => {
        const us = l.settlement.units.filter((u) => allowedUnits.some((a) => a.id === u.unitId));
        const share = us.reduce((a, u) => a + u.sharePaisa, 0n);
        const paid = us.reduce((a, u) => a + u.paidPaisa, 0n);
        return { month: periodLabel(l.period, true), share, paid, difference: paid - share };
      });
      return {
        ...base,
        title: "Expenses compared with contributions",
        columns: [
          { key: "month", label: "Month", kind: "text" },
          { key: "share", label: "Shared expenses", kind: "money" },
          { key: "paid", label: "Contributions", kind: "money" },
          { key: "difference", label: "Difference", kind: "money" },
        ],
        rows,
        totals: { month: "Total", share: sum(rows, "share"), paid: sum(rows, "paid"), difference: sum(rows, "difference") },
      };
    }
    case "expenses": {
      if (!expenseVisible) throw new ReportAccessError("Expense details are private in this household.");
      const rows = ledgers.flatMap((l) =>
        [...l.expenses]
          .filter((e) => !f.category || e.category_id === f.category)
          .sort((a, b) => (ref.sections.find((s) => s.id === a.section_id)?.sort_order ?? 0) - (ref.sections.find((s) => s.id === b.section_id)?.sort_order ?? 0) || a.sort_order - b.sort_order)
          .map((e) => ({
            month: periodLabel(l.period),
            section: ref.sections.find((s) => s.id === e.section_id)?.title ?? "",
            item: e.title,
            category: catName(e.category_id, e.section_id),
            quantity: e.rate && e.qty_num ? `${Number(e.qty_num)} × ${Number(e.rate)}` : (e.qty_text ?? ""),
            split: ref.rules.find((r) => r.id === e.split_rule_id)?.name ?? describeSpec(expenseSpec(e, ref.rules), code),
            amount: toPaisa(e.amount),
            date: e.expense_date ?? "",
          })),
      );
      return {
        ...base,
        title: "Expense list",
        columns: [
          { key: "month", label: "Month", kind: "text" },
          { key: "section", label: "Section", kind: "text" },
          { key: "item", label: "Item", kind: "text" },
          { key: "category", label: "Category", kind: "text" },
          { key: "quantity", label: "Quantity", kind: "text" },
          { key: "split", label: "Shared", kind: "text" },
          { key: "amount", label: "Amount", kind: "money" },
        ],
        rows,
        totals: { month: "Total", amount: sum(rows, "amount") },
      };
    }
  }
}

export function cellText(c: Cell, kind: ColumnKind): string {
  if (c === null || c === undefined || c === "") return kind === "money" ? "" : "";
  if (kind === "money" && typeof c === "bigint") {
    const neg = c < 0n;
    const abs = neg ? -c : c;
    const rupees = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const paisa = abs % 100n;
    return `${neg ? "-" : ""}${rupees}${paisa ? `.${paisa.toString().padStart(2, "0")}` : ""}`;
  }
  if (kind === "date" && typeof c === "string" && /^\d{4}-\d{2}-\d{2}/.test(c)) return format(new Date(c), "d MMM yyyy");
  if (kind === "status" && typeof c === "string") return { pending: "Pending verification", approved: "Approved", rejected: "Rejected" }[c] ?? c;
  return String(c);
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): ReportFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const ym = (v?: string) => (v && /^\d{4}-\d{2}$/.test(v) ? v : undefined);
  return { from: ym(s("from")), to: ym(s("to")), unit: s("unit")?.replace(/[^A-Z0-9]/g, "") || undefined, category: s("category"), status: s("status") };
}

export function reportType(v: unknown): ReportType {
  return (REPORT_TYPES.find((r) => r.key === v)?.key ?? "monthly") as ReportType;
}
