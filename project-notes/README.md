# Mars Cosmos: project notes

Start here to review any module. Each module has one note (copy of [_module-template.md](_module-template.md)). **A task is not done until its note is updated.** `src/main/notes.test.ts` checks that every IPC channel, table and migration is written down.

## 1. Modules and status

| Module | Status | One line |
|---|---|---|
| [Login and roles](login-and-roles/login-and-roles.md) | **done** | PIN login, lockout, roles, approvals, audit log |
| [Billing](billing/billing.md) | **done** | Counter screen, GST, payments, held bills, day start |
| [Returns and exchange](returns/returns.md) | **done** | Returns, exchange, credit notes (issue, use, expiry) |
| [Bills](bills/bills.md) | **done** | Bill list, reprint, WhatsApp, cancel bill |
| [Alterations](alterations/alterations.md) | **done** | Tailor jobs, tags, slips, charges, tailors |
| [Products](products/products.md) | **done** | Catalogue, size × colour, barcodes, photos, import |
| [Serial numbers](serials/serials.md) | **built** (sticker scan untested) | A serial on every piece: scan pieces, bunches, return / count by serial |
| [Print stickers](stickers/stickers.md) | **done** (labels) | Barcode labels (receipts and tags print too, see Settings) |
| [Stock in](stock-in/stock-in.md) | **done** | Purchases and suppliers |
| [Stock out](stock-out/stock-out.md) | **done** | Supplier return, damage, dispatch |
| [Stock](stock/stock.md) | **done** | Levels, history, adjust, stock count |
| [Customers](customers/customers.md) | **done** | Profiles, consent, birthdays |
| [Coins](coins/coins.md) | **done** | Earn, spend, expire; return and cancel reverse them |
| [Reports](reports/reports.md) | **done** | Sales, GST, dead stock, commission, Excel and PDF |
| [Day end](day-end/day-end.md) | **done** | Cash reconciliation, expenses, close and backup |
| [Settings](settings/settings.md) | **done** | Shop, GST, receipt, printers, staff, backup |
| [Backup](backup/backup.md) | partial | Automatic backup on day close and at app start; warning bar |
| [Licence and onboarding](licence/licence.md) | **built, untested** | Activation (online / offline code / trial), expiry = read-only, first-run wizard |
| [Installer](installer/installer.md) | **built, untested** | `npm run dist` makes the Windows setup .exe |

## 7. Database schema

SQLite, money in integer paise, timestamps ISO-8601 text. Migrations are in `src/main/db/schema.ts` and are append-only.

| Area | Tables |
|---|---|
| Setup and people | `settings`, `staff`, `approval_attempts`, `audit_log`, `backups`, `wa_outbox` |
| Catalogue | `categories`, `products`, `variants`, `product_photos` |
| Serial numbers | `pieces`, `piece_events`, `bunches`, `stock_count_pieces` |
| Stock | `stock_moves` (stock is the sum of moves), `suppliers`, `purchases`, `purchase_lines`, `stock_outs`, `stock_out_lines`, `stock_counts`, `stock_count_lines` |
| Customers | `customers`, `customer_sizes` (unused since migration 4), `coin_ledger` |
| Selling | `bills`, `bill_lines`, `payments`, `bill_counters`, `held_bills`, `credit_notes` |
| Working day | `day_sessions`, `expenses` |
| Alterations | `tailors`, `alterations`, `alteration_history` |

### Migrations log

| Version | What it changed |
|---|---|
| 1 | First schema: all tables above except the ones added later |
| 2 | `customer_sizes`: sizes per category |
| 3 | `approval_attempts`: wrong approver PINs counted per approver |
| 4 | `product_photos` (one photo per colour), `customers.sizes` JSON, `products.photo` dropped |
| 5 | `alterations.gst_rate`: the GST rate of an alteration charge is kept on the job |
| 6 | Serial numbers: `products.track_serials`, `pieces`, `piece_events`, `bunches`, `stock_count_pieces` |
| 7 | `products.gst_rate`: a GST % typed on the product (NULL = follow the category rule) |
| 8 | `bill_lines.item_disc`: the item's own discount, kept apart from its share of the bill discount (NULL on bills made before) |
| 9 | `wa_outbox`: automatic birthday / anniversary WhatsApp wishes, one row per customer, kind and year (queued / sent / failed) |

## 8. Roles and permissions

| Action | Owner | Manager | Cashier | Store staff |
|---|---|---|---|---|
| Billing, bills, return / exchange | yes | yes | yes | no |
| Alterations, products (view) | yes | yes | yes | yes |
| Add or edit products, stock in / out / count | yes | yes | no (view only) | yes |
| Customers, day end | yes | yes | yes | no |
| Reports | yes | yes | no | no |
| Settings | yes | no | no | no |
| Approve big discount, old-bill return, stock below zero | yes | yes | needs one of them | needs one of them |

Rules are enforced in the main process by `requireRole(...)`; the menu only hides what a role cannot use.

## Known issues (K) and open questions (Q)

- **K-02** Some read calls need no login. **K-05** Product photos are not in the backup. **K-06** The default backup folder is on the same disk as the database. **K-08** Sales made while a stock count is open are not counted. **K-10** `FORCE_PIN_CHANGE` is off while developing; turn it on before go-live.
- **Q-1** GST rate and SAC code for alteration charges. **Q-2** Do coins reduce taxable value on the invoice. **Q-3** GST summary layout the CA wants. **Q-4** Printer models and languages. **Q-5** Backup location. **Q-8** Re-opening a closed day.
