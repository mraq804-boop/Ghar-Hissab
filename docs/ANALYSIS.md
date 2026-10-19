# Workbook Analysis — `Grocery_Shopping_List.xlsx`

Source: `C:\Users\AbdulQadeer-ISKAAN\Desktop\Grocery_Shopping_List.xlsx` (local file, created with openpyxl 2026‑10‑05, last saved in Excel 2026‑10‑13). Not stored online, so a server cannot update it in place. It is converted to a Google Sheet for live sync (see `EXCEL_SYNC.md`).

## Worksheets
| Sheet | Purpose | Formulas |
|---|---|---|
| Grocery List | One month (October 2026) of household spending, split rules and settlement | SUM totals, qty × rate, split formulas, settlement status |
| Weekly Food Schedule | 4‑week × 7‑day menu, sabzi option list, weekly summary | none (print area B2:G29) |
| Kitchen Duties | 30‑day cooking roster for October 2026 (P1/P2/P3) | `COUNTIF` meal counts |

## Grocery List layout (columns B–G)
B = Sr. No., C = Item, D = Notes/Category, E = Quantity, F = Rate, G = Amount (PKR)

| Section | Rows | Total cell | Value |
|---|---|---|---|
| SHARED | 6–26 | G27 `=SUM(G6:G26)` | 23,700 |
| NOT SHARED | 30–34 | G35 `=SUM(G30:G34)` | 4,960 |
| MILK, SABZI, CHICKEN & MEAT | 38–42 | G43 `=SUM(G38:G42)` | 48,500 |
| HOUSE HELP & SERVICES | 46 | G47 `=SUM(G46:G46)` | 8,000 |
| BILLS | 50–53 | G54 `=SUM(G50:G53)` | 2,200 |
| Grand Total | 56 | `=G27+G35+G43+G47+G54` | 87,360 |

**Manual vs calculated:**
- Amounts are typed in by hand, except Chicken, Mutton and Keema, where `G = IF(F="","",E*F)`.
- Quantity is free text ("0.25 Kg", "2 Box", "150 gram"). It's only numeric where it multiplies a rate.

## Business rules (G58–G72)
| Rule | Formula | Oct value |
|---|---|---|
| Three‑way pool | `G27+G43+G47+G51+G52+G53−G13`: Shared + Milk/Meat + House help + Gas + Water + Internet − Sarf | 79,800 |
| Two‑way (Wapda) | `G50`, AK + AB only | 0 |
| Sarf | `G13`: AQ 4/9, AK 4/9, AB 1/9 | 2,600 |
| AQ share | `G59/3 + G61·4/9` | 27,755.56 |
| AK share | `G59/3 + G60/2 + G61·4/9` | 27,755.56 |
| AB share | `G59/3 + G60/2 + G61/9` | 26,888.89 |
| Split total | | 82,400 |

NOT SHARED items are personal: listed and included in the Grand Total, but nobody is charged for them.

**Settlement (rows 69–71):**
- Paid (F) is typed in by hand.
- Balance = Paid − Share.
- Status = `Not paid` (F empty) / `Settled` (balance rounds to 0) / `Gets back` (>0) / `To pay` (<0).
- October: AQ paid 27,900 (+144.44), AK paid 19,000 (−8,755.56), AB paid 0 (−26,888.89).

## Decisions confirmed by the owner (2026‑10‑19)
- Units AQ, AK, AB share costs (11 people). **AQ is the purse‑holder**: every payment goes to AQ, and AQ approves them.
- Blank Wapda/Gas/Water = **not billed yet** (imported as pending bills, amount empty).
- Each month is settled on its own. No balance carries forward.
- Shares are rounded to **whole PKR with the largest remainder**, so they always add up to the split total. Ties go to unit order AQ → AK → AB. October becomes **AQ 27,756 · AK 27,755 · AB 26,889**.
- NOT SHARED is recorded only.
- One worksheet per month. The existing "Grocery List" sheet is October 2026.
- Weekly Food Schedule and Kitchen Duties are fully managed in the app and synced back.
- P1–P3 are family members, linked during import.

## Inconsistencies found (kept as found, not silently "fixed")
1. The B76 note says Wapda 15,000 / Gas 4,000 / Water 2,000, but G50–G52 are blank. Owner: the bills are not issued yet.
2. B74 says "Adjust E39:E42", but the meat rows are E40:E42.
3. E43 `=SUM(E38:E42)` adds litres and kilograms together. It isn't written back as a meaningful figure.
4. "Capri" appears in both SHARED (row 12) and NOT SHARED (row 34). Both are kept as separate expenses.
5. Notes mention beef, but there is no beef row.
6. B14 on Weekly Food Schedule refers to "Friday" and "Sunday" special days, which matches the grid. The B13 pattern text is consistent with it.
7. App vs sheet status for a unit with no payment:
   - In the sheet, AB has `0` typed in Paid, so the status shows "To pay".
   - The app only counts approved payment records. AB has none, so the app shows **Not paid**. Balances are the same.

## Database mapping
| Workbook | Table(s) |
|---|---|
| Section blocks | `expense_sections` (SHARED, NOT_SHARED, MILK_MEAT, HOUSE_HELP, BILLS) |
| Item rows | `expenses` (title=C, notes=D, qty_text/qty_num=E, rate=F, amount=G) |
| Split notes / G59–G64 | `split_rules`, `split_rule_parts` (Pool3, Wapda AK+AB, Sarf 4/9·4/9·1/9, None) |
| AQ/AK/AB | `units` |
| Paid column | Sum of `payments` with status = approved |
| Food schedule grid | `meal_slots`, `sabzi_options` |
| Kitchen duties grid | `duty_days` |

## Sync approach (summary)
The database is authoritative once the import is reconciled. Each change adds a `sync_jobs` outbox row in the same transaction. A worker renders the affected sheet through the Google Sheets API:
- Rows are matched by the record UUID stored in hidden column I.
- Rows are inserted or deleted inside a section, so formatting and SUM ranges survive.
- The original formulas are written back.
- Totals are read back and compared to the app's figures before the job is marked **Synced**.

Full design: `EXCEL_SYNC.md`.
