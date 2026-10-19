import type { Paisa } from "./money";

export type UnitRef = { id: string; code: string; sortOrder: number };

export type SplitSpec =
  | { type: "equal_units"; unitIds: string[] }
  | { type: "weights"; parts: { unitId: string; num: number; den: number }[] }
  | { type: "percentage"; parts: { unitId: string; percent: number }[] }
  | { type: "custom_amounts"; parts: { unitId: string; amountPaisa: Paisa }[] }
  | { type: "none" };

export type ExpenseInput = {
  id: string;
  amountPaisa: Paisa | null;
  split: SplitSpec;
  section?: string;
};

export type Rational = { num: bigint; den: bigint };

export class SplitError extends Error {}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

export function rat(num: bigint, den = 1n): Rational {
  if (den === 0n) throw new SplitError("Division by zero");
  if (den < 0n) [num, den] = [-num, -den];
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

export function addRat(a: Rational, b: Rational): Rational {
  return rat(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function ratToNumber(r: Rational): number {
  return Number(r.num) / Number(r.den);
}

const PERCENT_SCALE = 10_000n;

function percentToRat(p: number): Rational {
  if (!Number.isFinite(p) || p < 0) throw new SplitError("Percentages must be zero or positive");
  const scaled = Math.round(p * 100);
  if (Math.abs(scaled - p * 100) > 1e-9) throw new SplitError("Percentages allow at most 2 decimals");
  return rat(BigInt(scaled), PERCENT_SCALE);
}

function uniqueIds(ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new SplitError("A unit appears more than once in the split");
}

export function splitFractions(spec: SplitSpec): Map<string, Rational> {
  const out = new Map<string, Rational>();
  switch (spec.type) {
    case "none":
      return out;
    case "equal_units": {
      if (spec.unitIds.length === 0) throw new SplitError("Select at least one unit to share the expense");
      uniqueIds(spec.unitIds);
      const n = BigInt(spec.unitIds.length);
      for (const id of spec.unitIds) out.set(id, rat(1n, n));
      return out;
    }
    case "weights": {
      uniqueIds(spec.parts.map((p) => p.unitId));
      let sum = rat(0n);
      for (const p of spec.parts) {
        if (!Number.isInteger(p.num) || !Number.isInteger(p.den) || p.num < 0 || p.den <= 0) {
          throw new SplitError("Weights must be whole-number fractions");
        }
        const r = rat(BigInt(p.num), BigInt(p.den));
        out.set(p.unitId, r);
        sum = addRat(sum, r);
      }
      if (sum.num !== sum.den) throw new SplitError("Weights must add up to 1");
      return out;
    }
    case "percentage": {
      uniqueIds(spec.parts.map((p) => p.unitId));
      let sum = rat(0n);
      for (const p of spec.parts) {
        const r = percentToRat(p.percent);
        out.set(p.unitId, r);
        sum = addRat(sum, r);
      }
      if (sum.num !== sum.den) throw new SplitError("Percentages must add up to 100");
      return out;
    }
    case "custom_amounts":
      throw new SplitError("Custom amounts have no fixed fractions");
  }
}

export function exactShares(expense: ExpenseInput): Map<string, Rational> {
  const out = new Map<string, Rational>();
  const amount = expense.amountPaisa;
  if (amount === null) return out;
  if (amount < 0n) throw new SplitError("Expense amount cannot be negative");
  if (expense.split.type === "custom_amounts") {
    uniqueIds(expense.split.parts.map((p) => p.unitId));
    let sum = 0n;
    for (const p of expense.split.parts) {
      if (p.amountPaisa < 0n) throw new SplitError("Custom amounts cannot be negative");
      out.set(p.unitId, rat(p.amountPaisa));
      sum += p.amountPaisa;
    }
    if (sum !== amount) throw new SplitError("Custom amounts must add up to the expense amount");
    return out;
  }
  for (const [unitId, f] of splitFractions(expense.split)) {
    out.set(unitId, rat(amount * f.num, f.den));
  }
  return out;
}

export function splitKey(spec: SplitSpec): string {
  switch (spec.type) {
    case "none":
      return "none";
    case "equal_units":
      return `equal:${[...spec.unitIds].sort().join(",")}`;
    case "weights":
      return `weights:${[...spec.parts]
        .sort((a, b) => a.unitId.localeCompare(b.unitId))
        .map((p) => `${p.unitId}=${p.num}/${p.den}`)
        .join(",")}`;
    case "percentage":
      return `pct:${[...spec.parts]
        .sort((a, b) => a.unitId.localeCompare(b.unitId))
        .map((p) => `${p.unitId}=${p.percent}`)
        .join(",")}`;
    case "custom_amounts":
      return "custom";
  }
}
