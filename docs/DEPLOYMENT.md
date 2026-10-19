# Deployment (Supabase + Vercel)

Nothing here depends on your PC. Screenshots live in Supabase Storage and the workbook lives in Google Sheets.

## 1. Supabase
1. Create a project at <https://supabase.com/dashboard>. Choose the region closest to Pakistan, for example **ap-south-1 (Mumbai)**. Create a second, separate project for development and testing.
2. **Apply the migrations.** Use either option:
   - **CLI:** `npx supabase login`, `npx supabase link --project-ref <ref>`, then `npx supabase db push`.
   - **Dashboard:** in the SQL editor, run each file in `supabase/migrations/` in name order.
3. **Authentication → Sign In / Providers:**
   - Turn **off** "Allow new users to sign up". Accounts are invite-only.
   - Keep Email enabled.
4. **Authentication → URL Configuration:**
   - **Site URL:** `https://YOUR-APP.vercel.app`
   - **Redirect URLs:** `https://YOUR-APP.vercel.app/auth/confirm` and `http://localhost:3000/auth/confirm`
5. **Authentication → Emails → Templates.** For *Invite user* and *Magic link*, make the link go through the app's confirm route so it works with server-side sessions:
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` (use `type=magiclink` in the magic-link template)
6. **Project Settings → API Keys:** copy the **Publishable** key and the **Secret** key.
7. **Storage:** the `payment-proofs` and `receipts` buckets are created by the migrations and are private. Check that neither is marked public.
8. **SMTP:** Supabase's built-in email is rate-limited. For reliable invitations, set a custom SMTP server under **Authentication → Emails → SMTP**.

## 2. Vercel
1. Push the repository to GitHub, then import it at <https://vercel.com/new>. The framework is detected as Next.js.
2. Under **Settings → Environment Variables**, add every variable from `.env.example` for Production (and Preview, pointing at the dev Supabase project):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (server only)
   - `NEXT_PUBLIC_SITE_URL` = `https://YOUR-APP.vercel.app`
   - `CRON_SECRET`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EXCEL_TOKEN_ENC_KEY`
3. Deploy. Function regions: under **Settings → Functions**, pick **bom1 (Mumbai)** to sit next to the database.
4. The Content-Security-Policy includes the Supabase host from `NEXT_PUBLIC_SUPABASE_URL` at build time. Redeploy if you change it.

## 3. Scheduled retries
In the Supabase SQL editor, run `supabase/sql/schedule-sync.sql` after replacing the two placeholders: the app URL and the same value as `CRON_SECRET`. This schedules the sync worker every 2 minutes and cleans up abandoned screenshot uploads daily. It runs on the Vercel Hobby plan too, whose own cron jobs can only run once a day.

## 4. Import the workbook
1. Copy `import.config.example.json` to `import.config.json`. Fill in real names. Give the administrator (AQ) an email address and `"admin": true`. Map the kitchen labels P1, P2 and P3 to people with `dutyLabel`.
2. Do a dry run first. It parses the workbook and reconciles every total, but writes nothing:
   ```bash
   npm run import:workbook -- --file "C:\Users\...\Grocery_Shopping_List.xlsx" --config import.config.json --dry-run
   ```
3. Import for real. This runs as one transaction, reads the result back, then sends the administrator an invitation:
   ```bash
   npm run import:workbook -- --file "C:\Users\...\Grocery_Shopping_List.xlsx" --config import.config.json
   ```
   `.env.local` must point at the target Supabase project. The same file can only be imported once.
4. Open the invitation email, set a password, then follow `docs/EXCEL_SYNC.md` to connect Google Sheets.
5. Invite the other family members from **Family**.

## 5. Production checks
- [ ] Signing in by password and by emailed link both work. A new email address cannot sign up.
- [ ] Dashboard figures for October match the workbook: shares 27,756 / 27,755 / 26,889 and balances +144 / −8,755 / −26,889.
- [ ] A member records a test payment with a screenshot. It shows *Pending verification* and does not change balances.
- [ ] The administrator approves it. The balance updates, and **Excel sync** shows the month as *Synced*. Open the workbook: the Paid column changed.
- [ ] Another member cannot see that screenshot. (Opening the signed URL after 60 seconds also fails.)
- [ ] Reject the test payment, or delete the test data, before real use.

## Maintenance
- **Google OAuth client:** add the production redirect URI (`https://YOUR-APP.vercel.app/api/excel/oauth/callback`) in Google Cloud → Credentials. If the consent screen stays in Testing mode, reconnect Google every 7 days.
- **Backups:** Supabase takes daily backups on paid plans. On the free plan, export regularly (Database → Backups, or `pg_dump`). The Google Sheet is also a human-readable copy.
- **Audit:** every financial change is in `audit_log` (who, when, before and after).
- **Closing a month:** **Expenses → Close month** makes it read-only. Late payments can still be recorded against it.
