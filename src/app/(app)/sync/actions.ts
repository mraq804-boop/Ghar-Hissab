"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext, isAdmin } from "@/server/auth";
import { dbError, forbidden, invalid, type ActionResult } from "@/server/actions/result";
import { createSupabaseAdmin } from "@/server/supabase/admin";
import { excelConfigured } from "@/server/env";
import { SheetsError, spreadsheetIdFromUrl } from "@/server/excel/google";
import { runSyncWorker, sheetsClientFor } from "@/server/excel/worker";
import { kickSync } from "@/server/excel/kick";

const EXPECTED_TABS = ["Grocery List", "Weekly Food Schedule", "Kitchen Duties"];

const linkSchema = z.object({ url: z.string().trim().min(10, "Paste the Google Sheet's link").max(500) });

export async function linkSheet(input: z.input<typeof linkSchema>): Promise<ActionResult<{ title: string; missing: string[] }>> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  if (!excelConfigured()) return { ok: false, error: "Google credentials are not configured on the server." };
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const spreadsheetId = spreadsheetIdFromUrl(parsed.data.url);
  if (!spreadsheetId) return { ok: false, error: "That doesn't look like a Google Sheets link. Copy it from the browser's address bar while the sheet is open." };

  const admin = createSupabaseAdmin();
  try {
    const { client } = await sheetsClientFor(admin, ctx.householdId);
    const ss = await client.spreadsheet(spreadsheetId);
    const missing = EXPECTED_TABS.filter((t) => !ss.sheets.some((s) => s.title.toLowerCase() === t.toLowerCase()));
    const { error } = await admin
      .from("excel_connection")
      .update({ item_id: spreadsheetId, drive_id: null, file_name: ss.title, web_url: ss.url })
      .eq("household_id", ctx.householdId);
    if (error) return dbError(error);
    await admin.from("excel_sheets").update({ worksheet_id: null }).eq("household_id", ctx.householdId);

    const [{ data: periods }, { data: months }] = await Promise.all([
      admin.from("periods").select("id").eq("household_id", ctx.householdId),
      admin.from("duty_days").select("day").eq("household_id", ctx.householdId),
    ]);
    const scopes = [
      ...(periods ?? []).map((p) => `period:${p.id}`),
      "menu",
      ...new Set((months ?? []).map((d) => `duties:${String(d.day).slice(0, 7)}`)),
    ];
    for (const s of scopes) await admin.rpc("enqueue_sync", { h: ctx.householdId, s });
    revalidatePath("/", "layout");
    kickSync();
    return {
      ok: true,
      data: { title: ss.title, missing },
      message: missing.length
        ? `Linked "${ss.title}". Tabs ${missing.join(", ")} were not found and will be created on the first sync.`
        : `Linked "${ss.title}". A full sync has been queued.`,
    };
  } catch (e) {
    if (e instanceof SheetsError && e.status === 400) {
      return { ok: false, error: "That link is to an Excel (.xlsx) file, not a Google Sheet. Open it in Google Drive, choose File → Save as Google Sheets, and paste the new sheet's link." };
    }
    if (e instanceof SheetsError && (e.status === 404 || e.status === 403)) {
      return { ok: false, error: "Google says this sheet doesn't exist or the connected account can't open it. Check the link, or share the sheet with that account as an Editor." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Could not open that sheet." };
  }
}

export async function retrySync(scope: string | null): Promise<ActionResult<{ queued: number }>> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const { data, error } = await ctx.supabase.rpc("retry_sync", { h: ctx.householdId, s: scope });
  if (error) return dbError(error);
  revalidatePath("/sync");
  return { ok: true, data: { queued: data as number }, message: `${data} sheet${data === 1 ? "" : "s"} queued` };
}

export async function rebuildSheet(scope: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  if (!/^(period:[0-9a-f-]{36}|menu|duties:\d{4}-\d{2})$/.test(scope)) return { ok: false, error: "Unknown sheet." };
  const admin = createSupabaseAdmin();
  const { data: existing } = await admin.from("excel_sheets").select("worksheet_name").eq("household_id", ctx.householdId).eq("scope", scope).maybeSingle();
  if (existing) {
    await admin.from("excel_sheets").update({ force_rebuild: true }).eq("household_id", ctx.householdId).eq("scope", scope);
  }
  const { error } = await ctx.supabase.rpc("retry_sync", { h: ctx.householdId, s: scope });
  if (error) return dbError(error);
  revalidatePath("/sync");
  return { ok: true, data: undefined, message: "Sheet will be rebuilt on the next sync" };
}

export async function syncNow(): Promise<ActionResult<{ processed: number; failed: number }>> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  if (!excelConfigured()) return { ok: false, error: "Google credentials are not configured on the server." };
  const result = await runSyncWorker({ maxJobs: 6, budgetMs: 50_000 });
  revalidatePath("/", "layout");
  const failed = "results" in result && result.results ? result.results.filter((r) => !r.ok).length : 0;
  return {
    ok: true,
    data: { processed: result.processed, failed },
    message: result.processed === 0 ? "Nothing was waiting to sync" : failed ? `${failed} of ${result.processed} sheets failed` : `${result.processed} sheet${result.processed === 1 ? "" : "s"} synced`,
  };
}

export async function disconnectSheets(): Promise<ActionResult> {
  const ctx = await getContext();
  if (!isAdmin(ctx)) return forbidden;
  const admin = createSupabaseAdmin();
  const { error } = await admin.from("excel_connection").update({ refresh_token_enc: null, token_updated_at: null }).eq("household_id", ctx.householdId);
  if (error) return dbError(error);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: "Google disconnected" };
}
