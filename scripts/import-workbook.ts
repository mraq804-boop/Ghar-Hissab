/**
 * One-time import of the family workbook into Supabase.
 *
 *   npm run import:workbook -- --file "C:\path\Grocery_Shopping_List.xlsx" --config import.config.json [--dry-run]
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and NEXT_PUBLIC_SITE_URL from .env.local.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { computeSettlement, formatPaisa, parseRupeesToPaisa, ruleToSpec, type RuleRow } from "../src/lib/finance";
import { parseWorkbook } from "../src/lib/import/parse-workbook";
import { buildImportPayload, type ImportConfig } from "../src/lib/import/payload";
import { reconcile, settlementFromParsed } from "../src/lib/import/reconcile";

const { values } = parseArgs({
  options: { file: { type: "string" }, config: { type: "string" }, "dry-run": { type: "boolean", default: false } },
});

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

async function main() {
  if (!values.file || !values.config) fail("Usage: --file <workbook.xlsx> --config <import.config.json> [--dry-run]");
  const bytes = readFileSync(values.file);
  const config = JSON.parse(readFileSync(values.config, "utf8")) as ImportConfig;
  const parsed = await parseWorkbook(bytes, new Date().getFullYear());

  console.log(`\nWorkbook: ${values.file}`);
  console.log(`Month: ${parsed.month}/${parsed.year} from sheet "${parsed.periodSheet}"`);
  console.log(`Expenses: ${parsed.expenses.length} (${parsed.expenses.filter((e) => e.amount === null).length} bills not issued yet)`);
  console.log(`Menu slots: ${parsed.menu.length}, sabzi options: ${parsed.sabzi.length}, duty days: ${parsed.duties.length}`);
  for (const w of parsed.warnings) console.log(`! ${w}`);

  console.log("\nReconciliation against the workbook's own figures:");
  const lines = reconcile(parsed);
  for (const l of lines) console.log(`  ${l.ok ? "✓" : "✗"} ${l.label.padEnd(28)} sheet ${l.sheet.toFixed(2).padStart(12)}   app ${l.app.toFixed(2).padStart(12)}`);
  if (lines.some((l) => !l.ok)) fail("The app's calculation does not match the workbook. Nothing was imported.");

  const s = settlementFromParsed(parsed);
  console.log("\nSettlement the app will show (whole rupees, largest remainder):");
  for (const u of s.units) console.log(`  ${u.code}: share ${formatPaisa(u.sharePaisa)}, paid ${formatPaisa(u.paidPaisa)}, balance ${formatPaisa(u.balancePaisa, { sign: true })}`);

  const payload = buildImportPayload(parsed, config, bytes);
  if (values["dry-run"]) {
    console.log("\nDry run complete. Nothing was written.\n");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (e.g. run with --env-file=.env.local).");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: householdId, error } = await db.rpc("import_workbook", { p: payload });
  if (error) fail(`Import failed and was rolled back: ${error.message}${error.hint ? ` (${error.hint})` : ""}`);
  console.log(`\n✓ Imported in one transaction. Household id ${householdId}`);

  const [units, rules, expenses, payments] = await Promise.all([
    db.from("units").select("id, code, sort_order").eq("household_id", householdId),
    db.from("split_rules").select("id, type, parts:split_rule_parts(unit_id, num, den, percent)").eq("household_id", householdId),
    db.from("expenses").select("amount, split_rule_id").eq("household_id", householdId),
    db.from("payments").select("payer_unit_id, amount").eq("household_id", householdId).eq("status", "approved"),
  ]);
  const back = computeSettlement({
    units: units.data!.map((u) => ({ id: u.id, code: u.code, sortOrder: u.sort_order })),
    expenses: expenses.data!.map((e, i) => ({
      id: String(i),
      amountPaisa: e.amount === null ? null : parseRupeesToPaisa(String(e.amount)),
      split: ruleToSpec((rules.data as RuleRow[]).find((r) => r.id === e.split_rule_id)!),
    })),
    payments: payments.data!.map((p) => ({ unitId: p.payer_unit_id, amountPaisa: parseRupeesToPaisa(String(p.amount)) })),
  });
  const same = back.grandTotal === s.grandTotal && back.splitTotal === s.splitTotal && back.units.every((u, i) => u.sharePaisa === s.units[i].sharePaisa && u.paidPaisa === s.units[i].paidPaisa);
  if (!same) fail("Read-back from the database does not match the workbook. Delete the household in Supabase and investigate before using the app.");
  console.log("✓ Read-back from the database matches the workbook.");

  const adminMember = config.members.find((m) => m.admin)!;
  const { data: roles } = await db.from("household_roles").select("user_id").eq("household_id", householdId);
  if (!roles?.length) {
    const { error: invErr } = await db.auth.admin.inviteUserByEmail(adminMember.email!, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/confirm?next=/settings/password`,
    });
    console.log(invErr ? `! Could not send the admin invitation: ${invErr.message}` : `✓ Invitation sent to ${adminMember.email}`);
  } else {
    console.log(`✓ ${adminMember.email} already had an account and is now the administrator.`);
  }
  console.log("\nNext: sign in, connect OneDrive on the Excel sync page and choose the uploaded workbook.\n");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
