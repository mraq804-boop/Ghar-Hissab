// Checks the Supabase project is migrated and locked down.
//   node --env-file=.env.local scripts/check-setup.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let problems = 0;
const say = (ok, msg) => {
  if (!ok) problems++;
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
};

const admin = createClient(url, secret, { auth: { persistSession: false } });
for (const t of ["households", "units", "members", "periods", "expenses", "payments", "payment_attachments", "meal_slots", "duty_days", "sync_jobs", "audit_log"]) {
  const { count, error } = await admin.from(t).select("*", { count: "exact", head: true });
  say(!error, `table ${t}${error ? `: ${error.message}` : ` (${count} rows)`}`);
}

const { data: buckets, error: be } = await admin.storage.listBuckets();
for (const id of ["payment-proofs", "receipts"]) {
  const b = buckets?.find((x) => x.id === id);
  say(!be && b && !b.public, `bucket ${id} exists and is private`);
}

const anon = createClient(url, publishable, { auth: { persistSession: false } });
const { data: leak } = await anon.from("payments").select("id").limit(1);
say(!leak || leak.length === 0, "anonymous visitors cannot read payments");
const { error: rpcErr } = await anon.rpc("claim_sync_job", { worker: "11111111-1111-1111-1111-111111111111" });
say(Boolean(rpcErr), "anonymous visitors cannot call the sync worker");
const { error: bootErr } = await anon.rpc("bootstrap_household", { p: {} });
say(Boolean(bootErr), "anonymous visitors cannot create households");

console.log(problems ? `\n${problems} problem(s) found.` : "\nSupabase setup looks good.");
process.exit(problems ? 1 : 0);
