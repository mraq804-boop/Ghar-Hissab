import type { Paisa } from "./money";
import {
  addRat,
  exactShares,
  rat,
  ratToNumber,
  splitKey,
  type ExpenseInput,
  type Rational,
  type SplitSpec,
  type UnitRef,
} from "./split";

export const RUPEE: Paisa = 100n;

export type RemainderItem = { key: string; sortOrder: number; num: bigint; den: bigint };

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
}

export function largestRemainder(items: RemainderItem[], step: Paisa = RUPEE): Map<string, Paisa> {
  const result = new Map<string, Paisa>();
  if (items.length === 0) return result;

  let total = rat(0n);
  for (const it of items) {
    if (it.num < 0n) throw new Error("largestRemainder expects non-negative values");
    total = addRat(total, rat(it.num, it.den));
  }
  const target = floorDiv(total.num * 2n + step * total.den, 2n * step * total.den) * step;

  const rows = items.map((it) => {
    const floor = floorDiv(it.num, it.den * step) * step;
    return { ...it, floor, remNum: it.num - floor * it.den, remDen: it.den };
  });
  let leftover = (target - rows.reduce((a, r) => a + r.floor, 0n)) / step;

  const order = [...rows].sort((a, b) => {
    const lhs = a.remNum * b.remDen;
    const rhs = b.remNum * a.remDen;
    if (lhs !== rhs) return lhs > rhs ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
  for (const r of order) {
    let v = r.floor;
    if (leftover > 0n) {
      v += step;
      leftover -= 1n;
    }
    result.set(r.key, v);
  }
  return result;
}

export function allocateExpense(
  expense: ExpenseInput,
  units: UnitRef[],
  step: Paisa = RUPEE,
): { unitId: string; sharePaisa: Paisa }[] {
  const shares = exactShares(expense);
  const order = new Map(units.map((u) => [u.id, u.sortOrder]));
  const rounded = largestRemainder(
    [...shares].map(([unitId, r]) => ({ key: unitId, sortOrder: order.get(unitId) ?? 0, num: r.num, den: r.den })),
    step,
  );
  return [...rounded]
    .map(([unitId, sharePaisa]) => ({ unitId, sharePaisa }))
    .sort((a, b) => (order.get(a.unitId) ?? 0) - (order.get(b.unitId) ?? 0));
}

export type SettlementStatus = "not_paid" | "settled" | "gets_back" | "to_pay";

export type PaymentInput = { unitId: string; amountPaisa: Paisa };

export type UnitSettlement = {
  unitId: string;
  code: string;
  exactShare: number;
  sharePaisa: Paisa;
  paidPaisa: Paisa;
  balancePaisa: Paisa;
  status: SettlementStatus;
};

export type RulePool = { key: string; split: SplitSpec; amountPaisa: Paisa; expenseCount: number };

export type Settlement = {
  units: UnitSettlement[];
  sectionTotals: Record<string, Paisa>;
  grandTotal: Paisa;
  splitTotal: Paisa;
  unsplitTotal: Paisa;
  rulePools: RulePool[];
  pendingBillCount: number;
  totals: { sharePaisa: Paisa; paidPaisa: Paisa; balancePaisa: Paisa };
};

export function settlementStatus(hasPayment: boolean, balance: Paisa): SettlementStatus {
  if (!hasPayment) return "not_paid";
  if (balance > -50n && balance < 50n) return "settled";
  return balance > 0n ? "gets_back" : "to_pay";
}

export function computeSettlement(input: {
  units: UnitRef[];
  expenses: ExpenseInput[];
  payments: PaymentInput[];
  step?: Paisa;
}): Settlement {
  const step = input.step ?? RUPEE;
  const units = [...input.units].sort((a, b) => a.sortOrder - b.sortOrder);
  const exact = new Map<string, Rational>(units.map((u) => [u.id, rat(0n)]));
  const sectionTotals: Record<string, Paisa> = {};
  const pools = new Map<string, RulePool>();
  let grandTotal = 0n;
  let splitTotal = 0n;
  let pendingBillCount = 0;

  for (const e of input.expenses) {
    if (e.amountPaisa === null) {
      pendingBillCount++;
      continue;
    }
    grandTotal += e.amountPaisa;
    if (e.section) sectionTotals[e.section] = (sectionTotals[e.section] ?? 0n) + e.amountPaisa;

    const key = splitKey(e.split);
    const pool = pools.get(key) ?? { key, split: e.split, amountPaisa: 0n, expenseCount: 0 };
    pool.amountPaisa += e.amountPaisa;
    pool.expenseCount++;
    pools.set(key, pool);

    if (e.split.type === "none") continue;
    splitTotal += e.amountPaisa;
    for (const [unitId, share] of exactShares(e)) {
      const current = exact.get(unitId);
      if (!current) throw new Error(`Expense ${e.id} is split to unknown unit ${unitId}`);
      exact.set(unitId, addRat(current, share));
    }
  }

  const rounded = largestRemainder(
    units.map((u) => ({ key: u.id, sortOrder: u.sortOrder, num: exact.get(u.id)!.num, den: exact.get(u.id)!.den })),
    step,
  );

  const paid = new Map<string, Paisa>();
  for (const p of input.payments) {
    if (!exact.has(p.unitId)) throw new Error(`Payment for unknown unit ${p.unitId}`);
    paid.set(p.unitId, (paid.get(p.unitId) ?? 0n) + p.amountPaisa);
  }

  const rows: UnitSettlement[] = units.map((u) => {
    const sharePaisa = rounded.get(u.id) ?? 0n;
    const paidPaisa = paid.get(u.id) ?? 0n;
    const balancePaisa = paidPaisa - sharePaisa;
    return {
      unitId: u.id,
      code: u.code,
      exactShare: ratToNumber(exact.get(u.id)!) / 100,
      sharePaisa,
      paidPaisa,
      balancePaisa,
      status: settlementStatus(paid.has(u.id), balancePaisa),
    };
  });

  const totals = rows.reduce(
    (a, r) => ({
      sharePaisa: a.sharePaisa + r.sharePaisa,
      paidPaisa: a.paidPaisa + r.paidPaisa,
      balancePaisa: a.balancePaisa + r.balancePaisa,
    }),
    { sharePaisa: 0n, paidPaisa: 0n, balancePaisa: 0n },
  );

  return {
    units: rows,
    sectionTotals,
    grandTotal,
    splitTotal,
    unsplitTotal: grandTotal - splitTotal,
    rulePools: [...pools.values()],
    pendingBillCount,
    totals,
  };
}
