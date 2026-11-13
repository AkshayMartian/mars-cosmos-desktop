# Roadmap

Order follows the shop's day: sell first, then everything that feeds it.

- [x] **M0 Scaffold** — Electron/Vite/React, SQLite schema + migrations, shared GST maths (tested), PIN login with lockout, role menu.
- [ ] **M1 Catalogue & stock in** — categories, products (size × colour grid → variants + EAN-13), suppliers, stock in, stock levels/history.
- [ ] **M2 Billing core** — scan/search, lines, discounts + approvals, payments (cash/UPI/card), `bills.create` service, receipt text, held bills, day open/close.
- [ ] **M3 Printing** — receipt (ESC/POS) + drawer kick, label printer (TSPL/ZPL), reprint.
- [ ] **M4 Customers, coins, WhatsApp** — consent capture, coins ledger, wa.me bill/wishes.
- [ ] **M5 Returns & exchange, credit notes, cancel bill** (fix review items 2–5).
- [ ] **M6 Stock out, stock count**.
- [ ] **M7 Alterations** — jobs, tailors, tailor tag.
- [ ] **M8 Reports & settings** — sales, GST summary, dead stock, size sell-through, staff commission; Excel/PDF export.
- [ ] **M9 Backup/restore, first-run setup wizard, installer, auto-update.**
- [ ] **Later** — Excel import, multi-outlet sync, online-order pick lists.

Each milestone ends with: service tests green, one end-to-end walk-through on a real PC with the actual printers.
