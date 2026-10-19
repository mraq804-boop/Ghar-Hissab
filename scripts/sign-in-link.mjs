// Prints a one-time sign-in link for an existing, invited user without sending email.
// For administrators who are locked out or hit the email rate limit.
//   node --env-file=.env.local scripts/sign-in-link.mjs you@example.com
// The link signs in whoever opens it. Open it yourself and don't share it.
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node --env-file=.env.local scripts/sign-in-link.mjs <email>");
  process.exit(1);
}
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: { redirectTo: `${site}/auth/confirm?next=/settings/password` },
});
if (error) {
  console.error(`Could not create a link: ${error.message}`);
  process.exit(1);
}
console.log("\nOpen this link in your browser within the next hour (it works once):\n");
console.log(data.properties.action_link);
console.log("\nYou'll land on 'Set your password'. After that, sign in with the Password tab.\n");
