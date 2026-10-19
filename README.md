# Ghar Hisaab

Shared-home ledger for the AQ / AK / AB joint family. It replaces day-to-day editing of `Grocery_Shopping_List.xlsx` while keeping that workbook up to date.

- Expenses follow the workbook's rules exactly: the three-way pool, Wapda split AK + AB, Sarf split 4/9 · 4/9 · 1/9, and NOT SHARED items recorded but not charged.
- Payments are submitted with a screenshot. They count only after the purse-holder (AQ) approves them.
- Every change is written back to the family Google Sheet, then confirmed by reading the totals back.
- The menu and the kitchen duty roster are managed here too.

## Docs
- [Workbook analysis and business rules](docs/ANALYSIS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Excel sync setup](docs/EXCEL_SYNC.md)
- [Deployment](docs/DEPLOYMENT.md)

## Develop
```bash
npm install
```
```bash
cp .env.example .env.local
```
Fill in `.env.local` with the dev Supabase project's values and apply `supabase/migrations`. Then:
```bash
npm run dev
```

## Check
```bash
npm test
```
```bash
npm run typecheck
```
```bash
npm run build
```
