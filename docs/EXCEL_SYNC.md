# Google Sheets synchronisation

The database is the live source of truth. A Google Sheet copy of the family workbook is kept in step with it automatically. A sheet is only marked synced after its totals have been read back from Google and match the app.

## One-time setup

### 1. Put the workbook in Google Sheets
1. Go to <https://drive.google.com> → **New → File upload**, and choose `Grocery_Shopping_List.xlsx`.
2. Open the uploaded file, then choose **File → Save as Google Sheets**. This creates a real Google Sheet with the same tabs: **Grocery List**, **Weekly Food Schedule** and **Kitchen Duties**.
3. Rename it, for example to `ApnaHisab (TEST)`. Test with this copy first.

### 2. Create a Google Cloud OAuth client (about 5 minutes)
1. Go to <https://console.cloud.google.com>, sign in with the Google account that owns the sheet, and create a project called `ApnaHisab`.
2. **APIs & Services → Library:** search for **Google Sheets API** and click **Enable**.
3. **APIs & Services → OAuth consent screen** (shown as **Google Auth Platform** in newer consoles):
   - **User type:** External.
   - **App name:** ApnaHisab. **Support email:** your email.
   - **Scopes:** add `.../auth/spreadsheets`, plus `openid` and `email`.
   - **Test users / Audience:** add the Google account that will connect.
   - You can leave the app in **Testing** mode for family use.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - **Application type:** Web application.
   - **Authorised redirect URIs:**
     - `http://localhost:3000/api/excel/oauth/callback`
     - `https://YOUR-APP.vercel.app/api/excel/oauth/callback` (add this once deployed)
   - Copy the **Client ID** → `GOOGLE_CLIENT_ID`, and the **Client secret** → `GOOGLE_CLIENT_SECRET`.
5. Restart the app so it reads the new variables.

### 3. Connect in the app
1. As administrator, open **Excel sync** → **Connect Google** → choose the account → **Allow**. You'll see an "unverified app" warning while in Testing mode: click **Continue**.
2. Click **Link Google Sheet** and paste the sheet's link from the browser address bar. A full sync of the month, the menu and the duty roster is queued.
3. Click **Sync now**, then open the sheet and check it.

## How it works
1. **Outbox.** Every change to an expense, an approved payment, a month, the menu or the roster adds a `sync_jobs` row. Database triggers do this in the same transaction as the change itself.
2. **Trigger.**
   - After each change, the server runs the worker in the background.
   - Supabase `pg_cron` also calls `/api/sync/run` every 2 minutes, to pick up retries and anything left over.
3. **One writer at a time.** A per-household lease stops two workers from writing the same sheet at once.
4. **Render.** The month's tab is rendered from the database in the original layout:
   - same sections, rows, colours, merges and formulas;
   - the record ID in hidden column **I**;
   - the rule code in hidden column **J**.
5. **Atomic write.** Clearing, values and formatting go out as **one `batchUpdate`**, so a tab is never left half-written. Values are sent typed:
   - numbers as numbers;
   - formulas as formulas;
   - everything else as plain text, so nothing a user types can become a formula.
6. **Guard.** Before overwriting, the worker checks the tab still looks like one the app manages. If not, the job fails with *Layout drift* and nothing is changed. **Rebuild sheet** overwrites it deliberately.
7. **Verify.** The worker reads back the grand total, the split total, and the settlement share and paid totals. A mismatch fails the job.
8. **Retry.**
   - 429, 5xx and quota errors are retried within a run, honouring `Retry-After`. After that they are retried across runs with backoff (30 s → 1 h), up to 8 attempts.
   - Revoked access (401), a missing sheet (404) and no edit permission (403) fail immediately with a clear message.
9. **Status.** Each sheet and record shows *Pending sync*, *Synced* or *Sync failed*. The Excel sync page has **Retry**, **Rebuild sheet** and a run history.

## Notes
- The app only requests the `spreadsheets` permission, not access to your whole Drive.
- New months create tabs named `Grocery List - Nov 2026` and `Kitchen Duties - Nov 2026`.
- Edits typed into managed tabs are overwritten on the next sync, and each tab says so at the bottom. Any other tabs you add are never touched.
- **Download as Excel:** **File → Download → Microsoft Excel (.xlsx)** in Google Sheets gives you a normal Excel file at any time.
- **Testing-mode tokens expire after 7 days.** While the Google app is in **Testing** mode, Google expires the sign-in after 7 days, and syncs then fail with "Google sign-in expired". Click **Reconnect** when that happens. To avoid this, go to the consent screen and choose **Publish app** (no Google review is needed for personal use with few users; you'll still see the unverified-app warning once when connecting).
