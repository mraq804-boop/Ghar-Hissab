/**
 * Daily LESCO/WASA bill fetch, run by GitHub Actions because LESCO doesn't accept connections from
 * Vercel's servers. Uses the same code as the app, then asks the app to send the notifications.
 *
 * Needs SUPABASE_URL, SUPABASE_SECRET_KEY, CRON_SECRET and APP_URL in the environment.
 * Run with: npx tsx --conditions=react-server scripts/fetch-bills.ts
 */
import { createClient } from "@supabase/supabase-js";
import { checkAllMeters } from "../src/server/lesco/check";

const { SUPABASE_URL, SUPABASE_SECRET_KEY, CRON_SECRET, APP_URL } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

async function main() {
  const results = await checkAllMeters(db, today, 25 * 60_000);
  const tally = results.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  console.log(`Checked ${results.length} connection(s) on ${today}:`, JSON.stringify(tally));

  const { data: errors } = await db.from("utility_meters").select("label, last_error").not("last_error", "is", null);
  for (const e of errors ?? []) console.log(`  ${e.label}: ${e.last_error}`);

  if (APP_URL && CRON_SECRET) {
    const res = await fetch(`${APP_URL.replace(/\/$/, "")}/api/notify/run`, { headers: { Authorization: `Bearer ${CRON_SECRET}` }, signal: AbortSignal.timeout(90_000) }).catch(() => null);
    console.log("Notifications:", res ? `${res.status} ${await res.text()}` : "couldn't reach the app");
  }

  if (results.length && results.every((r) => r.status === "error")) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
