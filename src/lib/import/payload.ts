import { createHash } from "node:crypto";
import { bootstrapPayload } from "@/lib/household-defaults";
import { sheetNameFor } from "@/lib/periods";
import type { ParsedWorkbook } from "./parse-workbook";

export type ImportConfig = {
  householdName: string;
  members: { unit: "AQ" | "AK" | "AB"; fullName: string; email?: string; relation?: string; dutyLabel?: string; admin?: boolean; joinedOn?: string }[];
};

export function buildImportPayload(parsed: ParsedWorkbook, config: ImportConfig, fileBytes: Uint8Array) {
  const admins = config.members.filter((m) => m.admin);
  if (admins.length !== 1 || !admins[0].email) throw new Error("Exactly one member must have \"admin\": true and an email address.");
  const labels = new Set(config.members.map((m) => m.dutyLabel).filter(Boolean));
  const missing = [...new Set(parsed.duties.flatMap((d) => [d.breakfast, d.lunch, d.dinner, d.off]).filter((x): x is string => Boolean(x)))].filter((l) => !labels.has(l));
  if (missing.length) throw new Error(`Assign these kitchen duty labels to members in the config: ${missing.join(", ")}`);

  const lastDay = new Date(Date.UTC(parsed.year, parsed.month, 0)).toISOString().slice(0, 10);
  return {
    fingerprint: createHash("sha256").update(fileBytes).digest("hex"),
    purseHolder: "AQ",
    bootstrap: bootstrapPayload(config.householdName),
    members: config.members,
    period: {
      year: parsed.year,
      month: parsed.month,
      sheetName: parsed.periodSheet === "Grocery List" ? parsed.periodSheet : sheetNameFor(parsed),
    },
    expenses: parsed.expenses.map((e) => ({
      section: e.section,
      title: e.title,
      notes: e.notes,
      qtyText: e.qtyText,
      qtyNum: e.qtyNum === null ? "" : String(e.qtyNum),
      rate: e.rate === null ? "" : String(e.rate),
      amount: e.amount === null ? "" : e.amount.toFixed(2),
      category: e.category,
      rule: e.rule,
    })),
    payments: Object.entries(parsed.paid)
      .filter(([, v]) => v !== null && v > 0)
      .map(([unit, amount]) => ({ unit, amount: amount!.toFixed(2), paidOn: lastDay })),
    menu: parsed.menu,
    sabzi: parsed.sabzi,
    duties: parsed.duties,
    dutyMonth: parsed.dutyMonth,
    dutyNotes: parsed.dutyNotes,
  };
}
