import type { SplitSpec } from "./split";

export type RuleRow = {
  id: string;
  type: "equal_units" | "weights" | "percentage" | "custom_amounts" | "none";
  parts: { unit_id: string; num: number | null; den: number | null; percent: number | string | null }[];
};

export function ruleToSpec(rule: RuleRow): SplitSpec {
  switch (rule.type) {
    case "none":
      return { type: "none" };
    case "equal_units":
      return { type: "equal_units", unitIds: rule.parts.map((p) => p.unit_id) };
    case "weights":
      return {
        type: "weights",
        parts: rule.parts.map((p) => ({ unitId: p.unit_id, num: p.num ?? 0, den: p.den ?? 1 })),
      };
    case "percentage":
      return {
        type: "percentage",
        parts: rule.parts.map((p) => ({ unitId: p.unit_id, percent: Number(p.percent ?? 0) })),
      };
    case "custom_amounts":
      throw new Error("Saved rules cannot use custom amounts");
  }
}

type StoredOverride =
  | { type: "equal_units"; unitIds: string[] }
  | { type: "weights"; parts: { unitId: string; num: number; den: number }[] }
  | { type: "percentage"; parts: { unitId: string; percent: number }[] }
  | { type: "custom_amounts"; parts: { unitId: string; amountPaisa: string | number }[] }
  | { type: "none" };

export function overrideToSpec(o: StoredOverride): SplitSpec {
  if (o.type === "custom_amounts") {
    return { type: "custom_amounts", parts: o.parts.map((p) => ({ unitId: p.unitId, amountPaisa: BigInt(p.amountPaisa) })) };
  }
  return o;
}

export function specToStored(spec: SplitSpec): StoredOverride {
  if (spec.type === "custom_amounts") {
    return { type: "custom_amounts", parts: spec.parts.map((p) => ({ unitId: p.unitId, amountPaisa: p.amountPaisa.toString() })) };
  }
  return spec;
}

export function describeSpec(spec: SplitSpec, unitCode: (id: string) => string): string {
  switch (spec.type) {
    case "none":
      return "Not shared";
    case "equal_units":
      return spec.unitIds.length === 1
        ? `${unitCode(spec.unitIds[0])} only`
        : `Equal: ${spec.unitIds.map(unitCode).join(" + ")}`;
    case "weights":
      return spec.parts.map((p) => `${unitCode(p.unitId)} ${p.num}/${p.den}`).join(", ");
    case "percentage":
      return spec.parts.map((p) => `${unitCode(p.unitId)} ${p.percent}%`).join(", ");
    case "custom_amounts":
      return "Custom amounts";
  }
}
