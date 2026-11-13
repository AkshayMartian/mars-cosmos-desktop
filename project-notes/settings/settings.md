# Settings

> **Status: pending.** Not started. Today settings are only read by the code and set by the seed (`src/main/db/seed.ts`); the shop name shows as "Your Shop" until this exists.

## 1. Summary (planned)

- **What it will do:** the owner's control panel: **Shop** (name, address, phone, GSTIN, state), **GST** (Regular / Composition / Not registered), **Receipt** (footer, return policy, review link, return window days, credit-note days, paper width), **Printers**, **Coins**, **Staff** (add, edit permissions, change PIN, deactivate), **Alterations** (tailors, rules), **Backup** (folder, back up now, list, restore), plus a **first-run setup wizard** (shop → GST → printers → owner PIN).
- **Who can use it:** Owner only.
- **Code (to create):** `Settings.tsx`, `services/settings.ts` additions, `services/staff.ts`, backup UI on top of `services/backup.ts`.

## 2. Settings already in use (keys in the `settings` table)

| Key | Value | Used by |
|---|---|---|
| `gst_scheme` | `"regular"` / `"composition"` / `"unregistered"` | Billing (GST), receipt wording |
| `shop` | `{name,address,phone,gstin,policy,footer}` (optional; defaults in code) | Top bar, receipt, WhatsApp text |
| `counter` | `"C1"` (optional) | Bill numbers, day sessions |
| `receipt` | `{returnDays:7, creditNoteDays:90, width:"80 mm"}` | Returns (future) |
| `security` | `{idleMinutes:10}` | Idle lock |
| `coins` | `{on:false, per:100, value:1, expiryMonths:6, maxPct:20}` | Coins (future) |
| `barcode_seq` | number | Product creation (do not edit by hand) |
| `backup_folder` | path (optional) | Backup |

## 3. Planned rules

- Only the owner can open Settings; every change is written to `audit_log` (`settings_change`).
- Changing the GST scheme affects **new** bills only (old bills keep their snapshot).
- Staff PIN change by the owner; PIN length 6 for owner, 4 for others; lockout rules stay.
- **Review items to carry in:** a "Restore" that replaces the database must close and restart the app; the backup folder should default to an external drive when one is present (K-06).

## 4. Open questions

Q-1 and Q-2 (alteration GST, coins on invoice) decide some fields; Q-5 (backup location).

## 5. Done when

Each tab saves and is read back by the modules above, tests cover validation and owner-only access, README status **done**, this page completed.

## Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-13 | Placeholder note created | n/a (no git) |
