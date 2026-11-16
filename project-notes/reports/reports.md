# Reports

> Open question **Q-3 context**: the GST summary layout the CA wants for GSTR-1 / GSTR-3B is not confirmed. The tab shows taxable value, CGST and SGST per rate and HSN, as in the prototype.

## 1. Summary

- **What it does:** read-only reports for the owner and manager, with a period (Today, Last 7 days, Last 30 days, Last 12 months) and **Export Excel** / **Export PDF** of the report on screen.
- **Tabs:** Sales · Best sellers · Size sell-through · Dead stock · Stock value · Staff & commission · Alterations · GST summary.
- **Screens:** `Reports` (`src/renderer/screens/Reports.tsx`).
- **Who can use it:** Owner, Manager.
- **Status:** **done** (2026-11-16). Not included: a GSTR-ready layout (Q-3), custom date ranges, charts.
- **Code:** screen above · service `src/main/services/reports.ts` (reads only) · file export `src/main/reportExport.ts` · shapes and the printable page `src/shared/reports.ts` · tests `src/main/services/reports.test.ts`.

## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| *Period* | dropdown | Today / Last 7 days / Last 30 days / Last 12 months. Not shown on Size sell-through, Dead stock and Stock value, which describe the shop as it is |
| Tabs | tabs | The eight reports |
| *Not sold in* | dropdown (Dead stock) | 30 / 60 / 90 days |
| **Export Excel** | button | Save dialog, then an .xlsx with one sheet per table (money as numbers, ₹ with 2 decimals) |
| **Export PDF** | button | Save dialog, then an A4 PDF of the report on screen |

## 3. Flows

Open a tab or change the period → `window.api.reports.get(tab, period, deadDays)` → `reports:get` → `getReport`. Export → `window.api.reports.exportExcel(...)` → `reports:exportExcel`, or `window.api.reports.exportPdf(...)` → `reports:exportPdf` → the same `getReport`, a save dialog, the file written, audit `report_export`.

## 4. APIs

- `reports:get` · `window.api.reports.get(tab, period, deadDays = 30)`. **Roles:** owner, manager. `tab` is `sales`, `best`, `size`, `dead`, `stock`, `staff`, `alter` or `gst`; `period` is `today`, `7`, `30` or `365`; `deadDays` 30, 60 or 90. **Response:** `{ tab, title, period, periodLabel, usesPeriod, kpis:[{label,value,kind}], tables:[{id,title?,columns,rows,total?,empty}], hint?, even }`. Money is paise. **Errors:** "Unknown report." · "Unknown period." · "Choose 30, 60 or 90 days." · not allowed.
- `reports:exportExcel` · `window.api.reports.exportExcel(tab, period, deadDays)` and `reports:exportPdf` · `window.api.reports.exportPdf(...)`: **Response:** the saved file path, or `null` when the save dialog is cancelled. Roles owner, manager.

## 5. Database

Reads only: `bills`, `bill_lines`, `payments`, `stock_moves`, `v_stock`, `variants`, `products`, `categories`, `staff`, `tailors`, `alterations`. Writes only `audit_log` (`report_export`).

## 6. Business rules

- Totals use **completed** bills; cancelled bills are left out. Return bills are negative, so they subtract.
- **Sales:** net sales = every completed bill's `grand`; Bills and Average bill count sale bills only; Returns shows the value returned. Payment modes are summed from `payments` (cash refunds are negative cash). Days: the latest 14 with bills.
- **Best sellers:** sale bills only, alteration charges excluded; products by pieces, then sizes.
- **Size sell-through:** received = opening stock + purchases; sold = sales minus returned and cancelled pieces, since the start. 60% or more says *Buy more*, 15% or less *Buy less*, else *Same*.
- **Dead stock:** items with stock whose last `sale` move is older than the chosen days (or never); money stuck = stock × cost.
- **Stock value:** pieces, value at cost and at MRP (negative stock counts as 0), low stock = stock at or below the item's minimum. Alteration service items are never counted as stock.
- **Staff:** bills made = sale bills the person billed; sales as salesperson = bills where they are the salesperson (returns subtract); commission = those sales × the person's commission %.
- **Alterations:** jobs made in the period plus any still open; late = not ready and past the ready-by time; to pay tailor = delivered jobs × the tailor's rate per job.
- **GST summary:** sums the stored line values per rate and HSN (returns are already negative). Alteration charges are included, so the total taxable + tax equals what was billed.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| Owner and manager only; bad report, period, dead days | others refused; clear errors | pass | 2026-11-16 |
| Sales: totals, modes, days, returns, cancelled, period | figures agree with the bills | pass | 2026-11-16 |
| Best sellers and sizes | ranked by pieces; service excluded | pass | 2026-11-16 |
| Size sell-through and cancel | received vs sold, advice, cancel puts piece back | pass | 2026-11-16 |
| Dead stock 30 / 60 days; stock value; low stock | items and money match | pass | 2026-11-16 |
| Staff commission | salesperson commission right | pass | 2026-11-16 |
| Alterations per tailor | jobs, late, delivered, to pay | pass | 2026-11-16 |
| GST summary with a return | taxable + tax = billed, net of returns | pass | 2026-11-16 |
| PDF page text | shop, period, figures, escaped | pass | 2026-11-16 |
| Real Excel and PDF files open correctly | files open in Excel / a PDF reader | not tested | n/a |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-13 | Placeholder note created | n/a (no git) |
| 2026-11-16 | Eight report tabs, period, Excel and PDF export, tests | uncommitted |
