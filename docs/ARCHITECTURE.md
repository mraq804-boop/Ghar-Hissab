# Architecture

## Stack
Next.js 16.4 (App Router, Cache Components, Turbopack), React 19, TypeScript, Tailwind v4, shadcn/ui (Radix), Supabase (Postgres, Auth, Storage), Google Sheets API, Vercel.

## Data flow
```
Browser ──Server Action──▶ Zod validation ──▶ Postgres RPC (security definer, role checks)
                                              │  same transaction:
                                              ├─ financial rows + version bump
                                              ├─ audit_log (trigger)
                                              └─ sync_jobs outbox (trigger)
          after() ──▶ sync worker ──▶ Google Sheets API (one atomic batchUpdate) ──▶ read-back check
pg_cron (every 2 min) ──▶ /api/sync/run ──▶ same worker (retries)
```

## Source of truth and calculations
- **Stored:** amounts and rules. Shares, paid totals and balances are always derived, never stored.
- **One engine:** `src/lib/finance/` computes all of them, with BigInt paisa and exact rationals, so there are no floating-point errors. The dashboard, division page, reports, exports, Excel layout and import reconciliation all call it.
- **Rounding:** shares are rounded to whole rupees using the largest remainder at month level, with ties going to AQ → AK → AB. Rounded shares always add up exactly to the split total.
- **Paid** counts **approved** payments only.

## Security
- **RLS on every table:**
  - Members read their household.
  - Writes to financial tables only happen through RPCs that check the caller's role.
  - Private settings hide other households' payments or all expenses when switched off.
- **Payment screenshots:**
  - Uploaded directly to a private bucket under `household/user/uuid`.
  - The server re-downloads each one, checks its magic bytes and size, and computes its SHA-256 before linking it.
  - Viewing goes through 60-second signed URLs issued with the viewer's own session, so storage RLS applies again.
- **Secrets:**
  - The service-role key is used only by the sync worker, the OAuth callback and invites, all server-only.
  - Google refresh tokens are encrypted at rest.
- **Idempotency:**
  - Every payment form carries a UUID key, so replays return the original payment.
  - Transaction references must be unique per method.
  - Approval uses optimistic versioning plus a row lock, so a payment can't be approved twice.
- **Headers:** Content-Security-Policy, `frame-ancestors 'none'`, `nosniff` and HSTS.
- **Excel formula injection:** user text is sent to Google as typed plain strings, so it can never become a formula.

## Folders
| Path | What |
|---|---|
| `src/lib/finance` | Money, splits, settlement, previews (pure, unit tested) |
| `src/lib/import` | Workbook parser, reconciliation, import payload |
| `src/server/data` | Read models for pages (RLS-scoped) |
| `src/server/excel` | Google Sheets client, layout renderer, sheets writer, worker |
| `src/server/reports.ts`, `src/server/export` | One report engine → table, XLSX, PDF |
| `src/app/(app)/*` | Pages, with each page's Server Actions in `actions.ts` |
| `supabase/migrations` | Schema, triggers, RPCs, RLS, storage, import |

## Tests
| Command | Covers |
|---|---|
| `npm test` | Finance engine (October golden figures, property tests); Excel layout (lands on the original rows and formulas, evaluates to the same totals); Google Sheets writer against a fake spreadsheet (one atomic batch, idempotent re-sync, deletions, new tabs, drift guard, typed values, 429/503 retry, read-back failure); roster generator; import parser against the real workbook; database tests on PGlite (RLS, RPCs, payments workflow, sync leasing and retries, atomic import) |
| `npm run test:e2e` | Signed-out redirects, form behaviour, no sideways scroll, protected endpoints, security headers, at desktop and mobile sizes |
| `npm run typecheck`, `npx eslint`, `npm run build` | Types, lint, production build |
