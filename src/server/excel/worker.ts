import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeSettlement,
  overrideToSpec,
  parseRupeesToPaisa,
  ruleToSpec,
  type RuleRow,
  type SplitSpec,
  type UnitRef,
} from "@/lib/finance";
import { describeSpec } from "@/lib/finance/rules";
import { sheetNameFor } from "@/lib/periods";
import type { SectionKey } from "@/lib/household-defaults";
import { createSupabaseAdmin } from "@/server/supabase/admin";
import { excelConfigured, serverEnv } from "@/server/env";
import { decryptSecret, encryptSecret } from "./crypto";
import { a1, exchangeGoogleToken, SheetsClient, SheetsError, type SheetInfo } from "./google";
import { renderDutySheet, renderMenuValues, renderPeriodSheet, ruleKeyFor, type LayoutExpense } from "./layout";
import { assertManagedSheet, ensureSheet, LayoutDriftError, readUsed, verifyChecks, writeLayout, writeValues } from "./sheets-writer";

const MAX_ATTEMPTS = 8;

type Job = { id: number; household_id: string; scope: string; attempts: number };
type Ref = { spreadsheetId: string; sheet: SheetInfo };

export class SyncConfigError extends Error {}

export async function runSyncWorker(opts: { maxJobs?: number; budgetMs?: number } = {}) {
  if (!excelConfigured()) return { processed: 0, skipped: "sheets_not_configured" as const };
  const admin = createSupabaseAdmin();
  const worker = randomUUID();
  const started = Date.now();
  const results: { scope: string; ok: boolean; message: string }[] = [];

  while (results.length < (opts.maxJobs ?? 5) && Date.now() - started < (opts.budgetMs ?? 50_000)) {
    const { data, error } = await admin.rpc("claim_sync_job", { worker, lease_seconds: 180 });
    if (error) throw new Error(`Could not claim sync job: ${error.message}`);
    const job = (data as Job[] | null)?.[0];
    if (!job) break;

    const { data: run } = await admin
      .from("sync_runs")
      .insert({ job_id: job.id, household_id: job.household_id, scope: job.scope })
      .select("id")
      .single();
    try {
      const outcome = await processJob(admin, job);
      await admin.rpc("finish_sync_job", { job_id: job.id, worker, ok: true });
      await admin.from("sync_runs").update({ finished_at: new Date().toISOString(), ok: true, message: outcome }).eq("id", run?.id);
      results.push({ scope: job.scope, ok: true, message: outcome });
    } catch (e) {
      const { message, retryable } = classify(e);
      const retryAt = retryable && job.attempts < MAX_ATTEMPTS ? new Date(Date.now() + jobBackoff(job.attempts)).toISOString() : null;
      await admin.rpc("finish_sync_job", { job_id: job.id, worker, ok: false, error: message, retry_at: retryAt });
      await admin
        .from("sync_runs")
        .update({ finished_at: new Date().toISOString(), ok: false, message, details: { retryAt, attempts: job.attempts } })
        .eq("id", run?.id);
      results.push({ scope: job.scope, ok: false, message });
    }
  }
  return { processed: results.length, results };
}

export function jobBackoff(attempts: number) {
  const base = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

export function classify(e: unknown): { message: string; retryable: boolean } {
  if (e instanceof SheetsError) {
    if (e.status === 401 || e.reason === "invalid_grant") {
      return { message: "Google sign-in expired or was revoked. Reconnect Google on the Excel sync page.", retryable: false };
    }
    if (e.status === 404) return { message: "The Google Sheet or one of its tabs was not found. Check the linked sheet.", retryable: false };
    if (e.status === 403 && !e.retryable) {
      return { message: "The connected Google account can't edit this sheet. Share it with that account as an Editor, or reconnect.", retryable: false };
    }
    return { message: e.message.slice(0, 500), retryable: e.retryable };
  }
  if (e instanceof LayoutDriftError || e instanceof SyncConfigError) return { message: e.message, retryable: false };
  return { message: (e instanceof Error ? e.message : String(e)).slice(0, 500), retryable: true };
}

export async function sheetsClientFor(admin: SupabaseClient, householdId: string) {
  const env = serverEnv();
  const { data: conn } = await admin.from("excel_connection").select("*").eq("household_id", householdId).maybeSingle();
  if (!conn?.refresh_token_enc) throw new SyncConfigError("Google is not connected. Connect Google on the Excel sync page first.");
  const tokens = await exchangeGoogleToken(
    { grant_type: "refresh_token", refresh_token: decryptSecret(conn.refresh_token_enc, env.EXCEL_TOKEN_ENC_KEY!) },
    { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! },
  );
  if (tokens.refreshToken) {
    await admin
      .from("excel_connection")
      .update({ refresh_token_enc: encryptSecret(tokens.refreshToken, env.EXCEL_TOKEN_ENC_KEY!), token_updated_at: new Date().toISOString() })
      .eq("household_id", householdId);
  }
  return { client: new SheetsClient({ accessToken: tokens.accessToken }), spreadsheetId: (conn.item_id as string | null) ?? null };
}

async function processJob(admin: SupabaseClient, job: Job): Promise<string> {
  const { client, spreadsheetId } = await sheetsClientFor(admin, job.household_id);
  if (!spreadsheetId) throw new SyncConfigError("No Google Sheet is linked yet. Paste the sheet's link on the Excel sync page.");
  if (job.scope.startsWith("period:")) return syncPeriod(admin, client, spreadsheetId, job.household_id, job.scope.slice(7));
  if (job.scope === "menu") return syncMenu(admin, client, spreadsheetId, job.household_id);
  if (job.scope.startsWith("duties:")) return syncDuties(admin, client, spreadsheetId, job.household_id, job.scope.slice(7));
  throw new SyncConfigError(`Unknown sync scope ${job.scope}`);
}

async function sheetMapping(admin: SupabaseClient, householdId: string, scope: string) {
  const { data } = await admin.from("excel_sheets").select("*").eq("household_id", householdId).eq("scope", scope).maybeSingle();
  return data as null | { worksheet_id: string | null; worksheet_name: string; force_rebuild: boolean };
}

async function saveMapping(admin: SupabaseClient, householdId: string, scope: string, sheet: SheetInfo) {
  await admin.from("excel_sheets").upsert(
    {
      household_id: householdId,
      scope,
      worksheet_id: String(sheet.sheetId),
      worksheet_name: sheet.title,
      force_rebuild: false,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id,scope" },
  );
}

async function resolveSheet(client: SheetsClient, spreadsheetId: string, mapping: Awaited<ReturnType<typeof sheetMapping>>, fallbackName: string) {
  if (mapping?.worksheet_id) {
    const ss = await client.spreadsheet(spreadsheetId);
    const byId = ss.sheets.find((s) => String(s.sheetId) === mapping.worksheet_id);
    if (byId) return { ...byId, created: false };
  }
  return ensureSheet(client, spreadsheetId, mapping?.worksheet_name ?? fallbackName);
}

export async function loadPeriodForSync(admin: SupabaseClient, householdId: string, periodId: string) {
  const [period, units, sections, rules, expenses, payments] = await Promise.all([
    admin.from("periods").select("id, year, month, sheet_name").eq("household_id", householdId).eq("id", periodId).single(),
    admin.from("units").select("id, code, sort_order").eq("household_id", householdId).order("sort_order"),
    admin.from("expense_sections").select("id, key, sort_order").eq("household_id", householdId),
    admin.from("split_rules").select("id, name, code, type, description, parts:split_rule_parts(unit_id, num, den, percent)").eq("household_id", householdId),
    admin
      .from("expenses")
      .select("id, section_id, title, notes, qty_text, qty_num, rate, amount, split_rule_id, split_override, sort_order")
      .eq("household_id", householdId)
      .eq("period_id", periodId)
      .is("deleted_at", null),
    admin.from("payments").select("payer_unit_id, amount").eq("household_id", householdId).eq("period_id", periodId).eq("status", "approved"),
  ]);
  for (const r of [period, units, sections, rules, expenses, payments]) if (r.error) throw new Error(r.error.message);

  const unitRefs: UnitRef[] = units.data!.map((u) => ({ id: u.id, code: u.code, sortOrder: u.sort_order }));
  const sectionKey = new Map(sections.data!.map((s) => [s.id, s.key as SectionKey]));
  const sectionOrder = new Map(sections.data!.map((s) => [s.id, s.sort_order]));
  const ruleRows = rules.data as (RuleRow & { name: string; code: string; description: string | null })[];
  const code = (id: string) => unitRefs.find((u) => u.id === id)?.code ?? "?";

  const ordered = [...expenses.data!].sort(
    (a, b) => (sectionOrder.get(a.section_id) ?? 0) - (sectionOrder.get(b.section_id) ?? 0) || a.sort_order - b.sort_order,
  );
  const layoutExpenses: LayoutExpense[] = ordered.map((e) => {
    const rule = ruleRows.find((r) => r.id === e.split_rule_id) ?? null;
    const spec: SplitSpec = e.split_override ? overrideToSpec(e.split_override) : ruleToSpec(rule!);
    return {
      id: e.id,
      sectionKey: sectionKey.get(e.section_id)!,
      title: e.title,
      notes: e.notes,
      qtyText: e.qty_text,
      qtyNum: e.qty_num === null ? null : Number(e.qty_num),
      rate: e.rate === null ? null : Number(e.rate),
      amountPaisa: e.amount === null ? null : parseRupeesToPaisa(String(e.amount)),
      spec,
      ruleKey: ruleKeyFor(spec, rule?.code ?? null, e.id),
      ruleLabel: rule?.name ?? "Custom split",
      ruleDescription: rule?.description ?? describeSpec(spec, code),
    };
  });

  const paid = new Map<string, bigint>();
  for (const p of payments.data!) paid.set(p.payer_unit_id, (paid.get(p.payer_unit_id) ?? 0n) + parseRupeesToPaisa(String(p.amount)));

  const settlement = computeSettlement({
    units: unitRefs,
    expenses: layoutExpenses.map((e) => ({ id: e.id, amountPaisa: e.amountPaisa, split: e.spec, section: e.sectionKey })),
    payments: [...paid].map(([unitId, amountPaisa]) => ({ unitId, amountPaisa })),
  });

  return { period: period.data!, units: unitRefs, expenses: layoutExpenses, paid, settlement, ruleCodes: ruleRows.map((r) => r.code) };
}

async function syncPeriod(admin: SupabaseClient, client: SheetsClient, spreadsheetId: string, householdId: string, periodId: string) {
  const data = await loadPeriodForSync(admin, householdId, periodId);
  const scope = `period:${periodId}`;
  const mapping = await sheetMapping(admin, householdId, scope);
  const sheet = await resolveSheet(client, spreadsheetId, mapping, data.period.sheet_name ?? sheetNameFor(data.period));
  const ref: Ref = { spreadsheetId, sheet };
  if (!sheet.created && !mapping?.force_rebuild) await assertManagedSheet(client, ref, "money");
  const previous = await readUsed(client, ref);

  const layout = renderPeriodSheet({
    sheetName: sheet.title,
    month: data.period.month,
    units: data.units,
    expenses: data.expenses,
    paidByUnit: data.paid,
    settlement: data.settlement,
    poolOrder: ["POOL3", "WAPDA", "SARF", ...data.ruleCodes],
  });
  await writeLayout(client, ref, layout, previous);
  await verifyChecks(client, ref, layout.checks);
  await saveMapping(admin, householdId, scope, sheet);
  return `Wrote ${data.expenses.length} expenses to "${sheet.title}" and confirmed ${layout.checks.length} totals`;
}

async function syncMenu(admin: SupabaseClient, client: SheetsClient, spreadsheetId: string, householdId: string) {
  const [slots, sabzi] = await Promise.all([
    admin.from("meal_slots").select("week, weekday, fixed_category, dish").eq("household_id", householdId),
    admin.from("sabzi_options").select("name, sort_order").eq("household_id", householdId).order("sort_order"),
  ]);
  if (slots.error || sabzi.error) throw new Error((slots.error ?? sabzi.error)!.message);
  const mapping = await sheetMapping(admin, householdId, "menu");
  const sheet = await resolveSheet(client, spreadsheetId, mapping, "Weekly Food Schedule");
  const ref: Ref = { spreadsheetId, sheet };

  if (!sheet.created && !mapping?.force_rebuild) {
    const [head] = await client.getValues(spreadsheetId, [a1(sheet.title, "B2:B4")]);
    if (!/weekly kitchen food schedule/i.test(String(head[0]?.[0] ?? "")) || !/^day$/i.test(String(head[2]?.[0] ?? ""))) {
      throw new LayoutDriftError("The Weekly Food Schedule sheet layout was not recognised, so it was not changed.");
    }
  }
  const v = renderMenuValues({ slots: slots.data!, sabzi: sabzi.data!.map((s) => s.name) });
  if (sheet.created) {
    await writeValues(client, ref, "B2", [["Weekly Kitchen Food Schedule - 4 Week Plan"]]);
    await writeValues(client, ref, "B4", [["Day", "Fixed Category", "Week 1", "Week 2", "Week 3", "Week 4"]]);
    await writeValues(client, ref, "B17", [["Common Sabzi Options - pick by season / market"]]);
    await writeValues(client, ref, "B22", [["WEEKLY SUMMARY  -  AT A GLANCE"]]);
  }
  await writeValues(client, ref, v.gridAddress.split(":")[0], v.grid);
  await writeValues(client, ref, v.optionsAddress.split(":")[0], v.options);
  await writeValues(client, ref, v.summaryAddress.split(":")[0], v.summary);

  const [back] = await client.getValues(spreadsheetId, [a1(sheet.title, v.gridAddress)]);
  const same = v.grid.every((row, i) => row.every((cell, j) => String(back[i]?.[j] ?? "") === String(cell ?? "").replace(/^'/, "")));
  if (!same) throw new SheetsError("Read-back check failed: the menu grid in the sheet does not match the app", 422, "verification_failed", null);
  await saveMapping(admin, householdId, "menu", sheet);
  return `Wrote the 4-week menu to "${sheet.title}"`;
}

async function syncDuties(admin: SupabaseClient, client: SheetsClient, spreadsheetId: string, householdId: string, month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const [days, members, notes] = await Promise.all([
    admin
      .from("duty_days")
      .select("day, breakfast_member_id, lunch_member_id, dinner_member_id, off_member_id, off_note")
      .eq("household_id", householdId)
      .gte("day", from)
      .lte("day", to)
      .order("day"),
    admin.from("members").select("id, full_name, duty_label").eq("household_id", householdId),
    admin.from("kitchen_notes").select("body, sort_order").eq("household_id", householdId).eq("scope", `duties:${month}`).order("sort_order"),
  ]);
  if (days.error || members.error) throw new Error((days.error ?? members.error)!.message);
  const label = (id: string | null) => {
    if (!id) return null;
    const mem = members.data!.find((x) => x.id === id);
    return mem ? (mem.duty_label || mem.full_name.split(" ")[0]) : null;
  };
  const rows = days.data!.map((d) => ({
    day: d.day,
    breakfast: label(d.breakfast_member_id),
    lunch: label(d.lunch_member_id),
    dinner: label(d.dinner_member_id),
    off: d.off_note ? `${label(d.off_member_id) ?? ""}  (${d.off_note})`.trim() : label(d.off_member_id),
  }));
  const people = [...new Set(rows.flatMap((r) => [r.breakfast, r.lunch, r.dinner]).filter((x): x is string => Boolean(x)))].sort();

  const scope = `duties:${month}`;
  const mapping = await sheetMapping(admin, householdId, scope);
  const sheet = await resolveSheet(client, spreadsheetId, mapping, `Kitchen Duties - ${sheetNameFor({ year: y, month: m }).slice("Grocery List - ".length)}`);
  const ref: Ref = { spreadsheetId, sheet };
  if (!sheet.created && !mapping?.force_rebuild) await assertManagedSheet(client, ref, "duties");
  const previous = await readUsed(client, ref);
  const layout = renderDutySheet({ sheetName: sheet.title, year: y, month: m, days: rows, people, notes: (notes.data ?? []).map((n) => n.body) });
  await writeLayout(client, ref, layout, previous);
  await verifyChecks(client, ref, layout.checks);
  await saveMapping(admin, householdId, scope, sheet);
  return `Wrote ${rows.length} duty days to "${sheet.title}"`;
}
