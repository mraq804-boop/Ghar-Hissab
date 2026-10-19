import { parseRupeesToPaisa, type Paisa } from "./money";
import { allocateExpense, RUPEE } from "./settlement";
import { SplitError, type SplitSpec, type UnitRef } from "./split";
import { ruleToSpec, type RuleRow } from "./rules";
import type { SplitInput } from "@/lib/validation/expense";

export function splitInputToSpec(split: SplitInput, rules: RuleRow[]): SplitSpec {
  switch (split.type) {
    case "rule": {
      const rule = rules.find((r) => r.id === split.ruleId);
      if (!rule) throw new SplitError("Choose how this expense is shared");
      return ruleToSpec(rule);
    }
    case "custom_amounts":
      return {
        type: "custom_amounts",
        parts: split.parts.map((p) => ({ unitId: p.unitId, amountPaisa: parseRupeesToPaisa(p.amount || "0") })),
      };
    default:
      return split;
  }
}

export function computeAmountPaisa(pricing: "amount" | "rate" | "pending", amount: string, qty: string, rate: string): Paisa | null {
  if (pricing === "pending") return null;
  if (pricing === "amount") return parseRupeesToPaisa(amount);
  const q = qty.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(q)) throw new SplitError("Enter the quantity");
  const [w, f = ""] = q.split(".");
  const milli = BigInt(w) * 1000n + BigInt(f.padEnd(3, "0"));
  const ratePaisa = parseRupeesToPaisa(rate);
  return (milli * ratePaisa + 500n) / 1000n;
}

export type PreviewResult =
  | { ok: true; amountPaisa: Paisa | null; shares: { unitId: string; sharePaisa: Paisa }[] }
  | { ok: false; error: string };

export function previewSplit(args: {
  pricing: "amount" | "rate" | "pending";
  amount: string;
  qty: string;
  rate: string;
  split: SplitInput;
  rules: RuleRow[];
  units: UnitRef[];
}): PreviewResult {
  try {
    const amountPaisa = computeAmountPaisa(args.pricing, args.amount, args.qty, args.rate);
    const spec = splitInputToSpec(args.split, args.rules);
    if (amountPaisa === null) return { ok: true, amountPaisa, shares: [] };
    const shares = spec.type === "none" ? [] : allocateExpense({ id: "preview", amountPaisa, split: spec }, args.units, amountPaisa % RUPEE === 0n ? RUPEE : 1n);
    return { ok: true, amountPaisa, shares };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Check the amounts" };
  }
}
