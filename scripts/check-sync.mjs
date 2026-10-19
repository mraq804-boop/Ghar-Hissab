// Read-only check of the Google Sheets sync: recent runs, sheet status, and key cells read back from the sheet.
//   node --env-file=.env.local scripts/check-sync.mjs
import { createDecipheriv } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const env = process.env;
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const { data: runs } = await db.from("sync_runs").select("scope, started_at, ok, message").order("started_at", { ascending: false }).limit(10);
console.log("Recent sync runs:");
for (const r of runs ?? []) console.log(`  ${r.ok ? "✓" : r.ok === false ? "✗" : "…"} ${r.started_at.slice(11, 19)} ${r.scope.padEnd(46)} ${r.message ?? ""}`);

const { data: jobs } = await db.from("sync_jobs").select("scope, status, attempts, last_error").in("status", ["pending", "running", "failed"]);
console.log(`\nOpen or failed jobs: ${jobs?.length ?? 0}`);
for (const j of jobs ?? []) console.log(`  ${j.status} (${j.attempts} attempts) ${j.scope} ${j.last_error ?? ""}`);

const { data: conn } = await db.from("excel_connection").select("item_id, file_name, refresh_token_enc").maybeSingle();
if (!conn?.refresh_token_enc || !conn.item_id) {
  console.log("\nNo Google Sheet linked.");
  process.exit(0);
}

function decrypt(token, keyB64) {
  const [, iv, tag, data] = token.split(".");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

const tok = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: decrypt(conn.refresh_token_enc, env.EXCEL_TOKEN_ENC_KEY),
  }),
}).then((r) => r.json());
if (!tok.access_token) {
  console.log(`\nCould not refresh the Google token: ${tok.error ?? "unknown error"}`);
  process.exit(1);
}

const base = `https://sheets.googleapis.com/v4/spreadsheets/${conn.item_id}`;
const auth = { authorization: `Bearer ${tok.access_token}` };
const meta = await fetch(`${base}?fields=properties.title,sheets.properties.title`, { headers: auth }).then((r) => r.json());
console.log(`\nSheet "${meta.properties?.title}" tabs: ${meta.sheets?.map((s) => s.properties.title).join(", ")}`);

const { data: maps } = await db.from("excel_sheets").select("scope, worksheet_name");
const money = maps?.find((m) => m.scope.startsWith("period:"))?.worksheet_name ?? "Grocery List";
const q = (r) => `ranges=${encodeURIComponent(`'${money}'!${r}`)}`;
const want = ["B2", "C56:G56", "C65:G65", "C69:G72", "B74:B76"];
const vals = await fetch(`${base}/values:batchGet?${want.map(q).join("&")}&valueRenderOption=UNFORMATTED_VALUE`, { headers: auth }).then((r) => r.json());
if (vals.error) {
  console.log(`\nCould not read the sheet: ${vals.error.message}`);
  process.exit(1);
}
console.log(`\n"${money}" tab, read back from Google:`);
vals.valueRanges.forEach((v, i) => {
  for (const row of v.values ?? []) console.log(`  ${want[i].padEnd(8)} ${row.map((c) => (typeof c === "number" ? Math.round(c * 100) / 100 : c)).filter((c) => c !== "").join(" | ")}`);
});

const menu = await fetch(`${base}/values:batchGet?ranges=${encodeURIComponent("'Weekly Food Schedule'!B5:D6")}&ranges=${encodeURIComponent("'Kitchen Duties'!B5:G5")}&ranges=${encodeURIComponent("'Kitchen Duties'!B36:C41")}&valueRenderOption=FORMATTED_VALUE`, { headers: auth }).then((r) => r.json());
console.log("\nKitchen tabs, read back from Google:");
for (const v of menu.valueRanges ?? []) for (const row of v.values ?? []) console.log(`  ${row.filter((c) => c !== "").join(" | ")}`);
