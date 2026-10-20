import { formatPaisa, type Paisa } from "@/lib/finance/money";

export type AlertExpense = {
  title: string;
  sectionKey: string;
  categoryKey: string;
  categoryName: string;
  amountPaisa: Paisa | null;
  ratePaisa: Paisa | null;
};

export type AlertMonth = { label: string; expenses: AlertExpense[] };

export type SpendingAlert = {
  kind: "category_high" | "rate_up" | "item_high" | "missing" | "duplicate";
  title: string;
  detail: string;
};

const RS_1000: Paisa = 100_000n;

function key(title: string) {
  return title.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function average(values: Paisa[]): Paisa {
  return values.length ? values.reduce((a, b) => a + b, 0n) / BigInt(values.length) : 0n;
}

function percentUp(now: Paisa, before: Paisa) {
  return before > 0n ? Number(((now - before) * 100n) / before) : 0;
}

/**
 * Compares a month with the months before it and points out what looks unusual.
 * `previous` is newest first. `dayOfMonth` is null for a month that has already ended.
 */
export function spendingAlerts(current: AlertMonth, previous: AlertMonth[], dayOfMonth: number | null, limit = 5): SpendingAlert[] {
  const alerts: SpendingAlert[] = [];
  const recent = previous.slice(0, 3);

  const seen = new Map<string, AlertExpense>();
  for (const e of current.expenses) {
    if (e.amountPaisa === null) continue;
    const k = `${e.sectionKey}|${key(e.title)}|${e.amountPaisa}`;
    if (seen.has(k)) {
      alerts.push({ kind: "duplicate", title: `${seen.get(k)!.title} ${formatPaisa(e.amountPaisa)} is entered twice`, detail: `Same item and amount appears twice in ${current.label}. Check it isn't a duplicate.` });
    } else {
      seen.set(k, e);
    }
  }

  if (recent.length) {
    const lastRate = new Map<string, Paisa>();
    for (const e of recent[0].expenses) if (e.ratePaisa) lastRate.set(key(e.title), e.ratePaisa);
    for (const e of current.expenses) {
      const before = e.ratePaisa ? lastRate.get(key(e.title)) : undefined;
      if (!e.ratePaisa || !before) continue;
      const up = percentUp(e.ratePaisa, before);
      if (up >= 15) alerts.push({ kind: "rate_up", title: `${e.title} rate up ${up}%`, detail: `${formatPaisa(e.ratePaisa)} per kg now, ${formatPaisa(before)} in ${recent[0].label}.` });
    }

    const pastByItem = new Map<string, Paisa[]>();
    for (const m of recent) {
      const totals = new Map<string, Paisa>();
      for (const e of m.expenses) if (e.amountPaisa !== null) totals.set(key(e.title), (totals.get(key(e.title)) ?? 0n) + e.amountPaisa);
      for (const [k, v] of totals) pastByItem.set(k, [...(pastByItem.get(k) ?? []), v]);
    }
    const nowByItem = new Map<string, { title: string; total: Paisa }>();
    for (const e of current.expenses) {
      if (e.amountPaisa === null) continue;
      const k = key(e.title);
      nowByItem.set(k, { title: e.title, total: (nowByItem.get(k)?.total ?? 0n) + e.amountPaisa });
    }
    const flaggedItems = new Set<string>();
    for (const [k, { title, total }] of nowByItem) {
      const usual = average(pastByItem.get(k) ?? []);
      if (usual > 0n && total >= usual * 2n && total - usual >= RS_1000) {
        flaggedItems.add(k);
        alerts.push({ kind: "item_high", title: `${title} is ${formatPaisa(total)} this month`, detail: `Usually about ${formatPaisa(usual)}. Check the amount is right.` });
      }
    }

    const pastByCategory = new Map<string, Paisa[]>();
    for (const m of recent) {
      const totals = new Map<string, Paisa>();
      for (const e of m.expenses) if (e.amountPaisa !== null) totals.set(e.categoryKey, (totals.get(e.categoryKey) ?? 0n) + e.amountPaisa);
      for (const [k, v] of totals) pastByCategory.set(k, [...(pastByCategory.get(k) ?? []), v]);
    }
    const nowByCategory = new Map<string, { name: string; total: Paisa; items: Set<string> }>();
    for (const e of current.expenses) {
      if (e.amountPaisa === null) continue;
      const c = nowByCategory.get(e.categoryKey) ?? { name: e.categoryName, total: 0n, items: new Set<string>() };
      c.total += e.amountPaisa;
      c.items.add(key(e.title));
      nowByCategory.set(e.categoryKey, c);
    }
    for (const [k, c] of nowByCategory) {
      const usual = average(pastByCategory.get(k) ?? []);
      if (usual === 0n || [...c.items].every((i) => flaggedItems.has(i))) continue;
      if (c.total * 10n >= usual * 13n && c.total - usual >= RS_1000) {
        alerts.push({ kind: "category_high", title: `${c.name} up ${percentUp(c.total, usual)}% this month`, detail: `${formatPaisa(c.total)} so far, usually about ${formatPaisa(usual)}.` });
      }
    }

    const late = dayOfMonth === null || dayOfMonth >= 10;
    if (late) {
      const present = new Set(current.expenses.map((e) => key(e.title)));
      const counted = new Map<string, { e: AlertExpense; months: number }>();
      for (const m of recent) {
        const inMonth = new Map<string, AlertExpense>();
        for (const e of m.expenses) if (e.amountPaisa !== null) inMonth.set(key(e.title), e);
        for (const [k, e] of inMonth) counted.set(k, { e: counted.get(k)?.e ?? e, months: (counted.get(k)?.months ?? 0) + 1 });
      }
      for (const [k, { e, months }] of counted) {
        if (present.has(k)) continue;
        const regular = months >= 2 || (e.sectionKey === "BILLS" && months === recent.length);
        if (!regular) continue;
        alerts.push({
          kind: "missing",
          title: e.sectionKey === "BILLS" ? `${e.title} bill not entered yet` : `No ${e.title} entered this month`,
          detail: `It was ${formatPaisa(e.amountPaisa!)} in ${recent.find((m) => m.expenses.some((x) => key(x.title) === k))?.label}.`,
        });
      }
    }
  }

  const priority: Record<SpendingAlert["kind"], number> = { duplicate: 0, item_high: 1, missing: 2, rate_up: 3, category_high: 4 };
  return alerts.sort((a, b) => priority[a.kind] - priority[b.kind]).slice(0, limit);
}
