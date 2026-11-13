# Reports

> **Status: pending.** Not started.

## 1. Summary (planned)

- **What it will do:** read-only reports for the owner and manager, for Today / Last 7 days / Last 30 days / Last 12 months, with **Export Excel** and **Export PDF**.
- **Tabs (from the approved prototype):** Sales (net sales, bills, average bill, returns, by payment mode, by day) · Best sellers (products, sizes) · Size sell-through (received vs sold per category and size, "Buy more / Same / Buy less") · Dead stock (not sold in 30/60/90 days, money stuck at cost) · Stock value (pieces, value at cost and MRP, low stock) · Staff & commission (bills, sales as salesperson, discounts, commission %) · Alterations (per tailor) · GST summary (per rate and HSN: taxable, CGST, SGST).
- **Who can use it:** Owner, Manager.
- **Code (to create):** `Reports.tsx`, `services/reports.ts` (SQL only, no writes), export code, tests.

## 2. What already exists for it

All the data: `bills`, `bill_lines` (with `gst_rate`, `hsn`, `taxable`, `cgst`, `sgst`), `payments`, `stock_moves`, `v_stock`, `day_sessions`, `expenses`, `staff.commission_pct`, `bills.sales_by`. ExcelJS is installed for Excel export.

## 3. Planned rules

- Totals use **completed** bills; returns subtract; cancelled bills excluded.
- GST summary sums stored line values (never recomputed), returns negative.
- Commission = sales as salesperson × the person's `commission_pct`.
- Dead stock uses the last `sale` move per item.
- Reports never change data.

## 4. Open questions

- GST summary layout the CA wants for GSTR-1 / GSTR-3B (Q-3 context).

## 5. Done when

Each tab has a tested query against known data, exports open correctly, README status **done**, this page completed.

## Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-13 | Placeholder note created | n/a (no git) |
