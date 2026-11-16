# How Ghar Hisaab gets utility bills

The app keeps track of each month's bill for every electricity, water and gas connection. Each company is handled differently:

| Company | Utility | Number used | How the bill comes in |
|---|---|---|---|
| LESCO | Electricity | 14-digit reference number | **Fetched automatically every day** |
| WASA Lahore | Water | Account number | **Fetched automatically every day** |
| SNGPL | Gas | 11-digit consumer number | **Fetched when the admin asks** (the admin types SNGPL's picture code), or uploaded |
| Any | Any | - | **Upload** a photo, screenshot or PDF of the bill |

The settings for each company (name, number format, website, fetched or not) are in `src/lib/utilities/providers.ts`.

---

## 1. Setting up a connection

On the **Bills** page the admin adds a connection (a "meter"). Each one has:
- a label (for example "AB 1"),
- the company,
- the reference, account or consumer number, checked against that company's number format,
- the expense category its bill goes into (for example Electricity (Wapda)).

These are saved in the `utility_meters` table.

---

## 2. The daily automatic fetch (LESCO and WASA)

### Why it runs on GitHub, not Vercel
LESCO's bill site doesn't accept connections from Vercel's servers. So the daily fetch runs on **GitHub Actions**, which LESCO does accept.

```
GitHub Actions (every day 09:30 Pakistan time)
   │  .github/workflows/fetch-bills.yml
   ▼
scripts/fetch-bills.ts
   │  uses the app's own code: checkAllMeters() in src/server/lesco/check.ts
   ├──► LESCO site  (bill.pitc.com.pk)   ─┐
   ├──► WASA site   (cms.wasalhr.pk)     ─┤ reads the bill page
   │                                     ▼
   ├──► Supabase: utility_bills table + a saved copy of the bill page (storage bucket "utility-bills")
   └──► calls the app at /api/notify/run so the family gets "new bill" notifications
```

- **Schedule:** `cron: "30 4 * * *"` (04:30 UTC, which is 09:30 in Pakistan). It can also be started by hand from the GitHub **Actions** tab ("Run workflow").
- **Secrets it needs** (stored as GitHub secrets, never in the code):
  - `SUPABASE_URL`
  - `SUPABASE_SECRET_KEY`
  - `CRON_SECRET`

### What `checkAllMeters` does
1. Loads every **active** LESCO and WASA connection.
2. **Skips** any connection whose bill for the current month is already saved, so each connection is fetched only until this month's bill arrives.
3. For the others it fetches the bill, one connection at a time, with a 1.5-second gap between them so it's gentle on the company sites.
4. It stops after a time limit: 25 minutes on GitHub, about 4.5 minutes inside Vercel.

### LESCO, step by step (`fetchLesco`)
LESCO's site is a normal search form, so the app does what a person would do in a browser:
1. **Open the form** at `https://bill.pitc.com.pk/lescobill`, keeping its cookies and hidden form fields.
2. **Submit the reference number** with "search by reference number" chosen.
3. **Follow the redirect** to the bill page, at most 3 hops. It only follows redirects that stay on LESCO's own site.
4. **Read the bill** with `parseLescoBill` (`src/lib/lesco/parse.ts`). It picks up:
   - bill month, reading date, issue date and due date
   - units, payable amount and current bill
   - the amounts if paid late
   - previous and present meter readings
   - the 12-month history of units and bills
5. **Safety checks:**
   - If LESCO shows a **CAPTCHA**, the app stops and tells you to open LESCO's site. It never tries to solve a CAPTCHA.
   - If no bill is found, it asks you to check the 14 digits.
   - If the bill belongs to a different reference number, it isn't saved.

### WASA, step by step (`fetchWasa`)
1. Opens WASA's duplicate-bill page with the account number in the address.
2. Reads the bill text with `readBillText` (`src/lib/utilities/read-bill-text.ts`): bill month, due date, payable, and the amount after the due date.
3. As with LESCO, it stops if there's a CAPTCHA, the account isn't found, or the page can't be read.

### Saving the bill (`saveFetchedBill`)
1. **Same as last time?** If this month's bill is already saved with the same amount, due date and reading, nothing changes.
2. **Keeps a copy** of the bill page. It downloads the page's styles and logo (not meter photos) and builds one self-contained HTML file. That file is saved in Supabase storage at `utility-bills/<household>/<meter>/<YYYY-MM>.html`, so the **View bill** button works even if the company site is down later.
3. **Records the figures** in the `utility_bills` table, one row per connection per month, marked `source: "fetched"`.
4. **New bill?** It triggers a "bill arrived" notification (`onBillArrived` in `src/server/notify/events.ts`).
5. **Notes the check** on the connection:
   - `last_checked_at` gets the time of the check.
   - `last_error` gets a plain message if something went wrong, such as "Couldn't reach LESCO's bill site… It will be tried again tomorrow." The Bills page shows this message.

---

## 3. "Check now" (one connection, by hand)

On the Bills page the admin can press **Check now** on a LESCO or WASA connection. It runs the same `checkMeter` code straight away (`checkNow` in `src/app/(app)/bills/actions.ts`).

> Because LESCO blocks Vercel, **Check now** for LESCO may fail from the live app. The daily GitHub run is the reliable path.

---

## 4. Gas (SNGPL): fetched with the admin's help

SNGPL's bill site always shows a **picture code (CAPTCHA)**, so it can't be fetched automatically. The app never solves it. Instead, the admin types the code (`src/server/lesco/sngpl.ts`):

1. The admin presses **Fetch** on a gas connection. The app opens SNGPL's form and shows SNGPL's picture code (`startSngpl`).
2. **The admin types the code** they see.
3. The app sends the consumer number and that code to SNGPL, then reads the bill that comes back (`finishSngpl` → `readSngplPage`).
4. The bill is saved the same way as LESCO and WASA (copy plus figures).

Things that can go wrong:
- **Wrong code:** a new picture is shown.
- **Code older than 15 minutes:** it expires and a new picture is shown.
- **Bill not found, or for a different consumer number:** not saved.
- **Page can't be read:** use **Upload bill** instead.

---

## 5. Upload bill (any company, works every time)

If a bill can't be fetched, the admin can **upload** a photo, screenshot or PDF (JPG, PNG, WebP or PDF, up to 4 MB; iPhone HEIC photos aren't accepted):
1. The phone reads the text from the picture itself (on-device OCR, `src/lib/ocr/read-screenshot.ts`), then `readBillText` fills in the month, due date, payable and the after-due amount.
2. **The admin checks and corrects** those figures, then saves (`uploadBill`).
3. The file is stored in the same `utility-bills` storage bucket, and the figures go into `utility_bills`.

---

## 6. From bill to expense

A saved bill isn't an expense yet. On the Bills page the admin presses **Add to expenses** (`addBillToExpenses`):
- It goes into that month's expenses, under the connection's category (for example Electricity (Wapda)).
- The month must be started and open.
- A bill counts as **paid** once its expense has a paid date or the paid bill attached (`src/lib/utilities/bill-paid.ts`).

Ask (the AI chat) also sees the latest bills: amount, due date, late-payment amounts and whether they're in expenses yet. It can answer questions like "which bills are due?"

---

## 7. Checking and fixing problems

| Where | What it tells you |
|---|---|
| Bills page | The red note on a connection (`last_error`) says why the last fetch failed. |
| GitHub → Actions → "Fetch utility bills" | The daily run's log: how many connections were checked, any errors per connection, whether LESCO was reachable, and the notification result. |
| `/api/bills/probe` (needs `CRON_SECRET`) | Whether LESCO answers from Vercel's region. |
| `/api/bills/check` (needs `CRON_SECRET`) | Runs the full daily check from Vercel (this works for WASA; LESCO is usually blocked there). |

Common fixes:
- **"Couldn't reach LESCO's bill site"**: usually temporary. It's tried again the next day, or run the GitHub workflow by hand.
- **"Asking for a CAPTCHA"**: open the company's site yourself and use **Upload bill**.
- **"Didn't find a bill"**: check the reference, account or consumer number on the connection.
- **"Page has changed / couldn't be read"**: the company changed its website. Use **Upload bill** until the reader is updated.

---

## Files at a glance

| File | What it does |
|---|---|
| `.github/workflows/fetch-bills.yml` | Daily schedule on GitHub (09:30 Pakistan time) |
| `scripts/fetch-bills.ts` | The script the schedule runs |
| `src/server/lesco/check.ts` | Fetches LESCO and WASA, saves the bill and its copy, runs the daily check |
| `src/server/lesco/sngpl.ts` | SNGPL fetch with the admin-typed picture code |
| `src/lib/lesco/parse.ts` | Reads a LESCO bill page |
| `src/lib/lesco/snapshot.ts` | Builds the saved, self-contained copy of a bill page |
| `src/lib/utilities/read-bill-text.ts` | Reads WASA, SNGPL and uploaded bills from their text |
| `src/lib/utilities/sngpl-page.ts` | Reads SNGPL's reply page |
| `src/lib/utilities/providers.ts` | Company list, number formats, fetched or not |
| `src/app/(app)/bills/actions.ts` | Bills page actions: add connection, check now, upload, gas fetch, add to expenses |
| `src/app/api/bills/check/route.ts` | Protected endpoint that runs the daily check from Vercel |
| `src/app/api/bills/probe/route.ts` | Protected endpoint that checks whether LESCO is reachable from Vercel |
| Supabase `utility_meters` | The connections |
| Supabase `utility_bills` | One row per connection per month |
| Supabase storage `utility-bills` | Saved bill copies and uploads |
