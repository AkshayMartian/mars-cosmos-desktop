# Settings

## 1. Summary

- **What it does:** the owner's control panel in eight tabs: **Shop**, **GST**, **Receipt**, **Printers**, **Coins**, **Staff**, **Alterations** (tailors and rules) and **Backup**. Every change is written to the audit log.
- **Screens:** `Settings` (`src/renderer/screens/Settings.tsx`).
- **Who can use it:** Owner only.
- **Status:** **done** (2026-11-16). Receipts, tags, slips and stickers now print through the Windows printer driver (see Printers). Not included: the first-run setup wizard, a QR picture for the review link (the link is printed as text), raw cash-drawer commands (the drawer opens through the receipt printer driver), and the **Coins** module itself (its settings are saved but nothing earns or spends coins yet).
- **Code:** screen above · service `src/main/services/admin.ts` · shapes `src/shared/settings.ts` · tests `src/main/services/admin.test.ts`.

## 2. Screen controls

| Tab | Controls |
|---|---|
| Shop | *Shop name* (required), *Phone*, *Address*, *GSTIN* (15 characters, checked), *State*, **Save**. The shop name in the top bar updates at once |
| GST | Radio cards *Regular GST* / *Composition* / *Not registered*; saves when picked. New bills only |
| Receipt | *Footer line*, *Return policy text*, *Google review link*, *Return window (days)*, *Credit note valid (days)*, *Paper* 80 / 58 mm, **Save** |
| Printers | *Receipt printer*, *Sticker printer*, *Sticker size*, *Open cash drawer on cash payment*, **Save**, **Test receipt**, **Test sticker**, **Open drawer now**. Printer lists are the ones installed in Windows |
| Coins | *Coins on*, *1 coin for every ₹*, *1 coin is worth ₹*, *Expire after (months)*, *Max use per bill (%)*, **Save** |
| Staff | Table (name, role, max discount, commission, cancel, change price, status), **Edit**, **+ Add staff**. Dialog: name, role, max discount %, commission %, two permission ticks, Active, PIN for a new person, **Change PIN** when editing |
| Alterations | Tailor table with **Make inactive / active**, add-tailor form, *Rules* (*Default ready in (days)*, *GST on alteration charge %*, *Print tailor tag on*), **Save** |
| Backup | *Backup folder* + **Save folder**, last backup, copies kept (of 30), **Back up now**, list of backup files each with **Restore**, **Restore from backup file…** (choose a file, for example from a USB drive). Restoring asks first, takes a safety copy, replaces the database and restarts the app |

## 3. Flows

Open → `window.api.settings.get()` → `settings:get` → `getAllSettings`. Each tab saves with its own call below. Staff and Backup load their own lists. The Alterations tab uses `window.api.alterations.context`, `saveTailor` and `saveConfig`; the sticker part of Printers uses `window.api.stickers.printers`, `context` and `savePrefs`.

## 4. APIs (all owner only; each returns the saved values)

- `settings:finishSetup` · `window.api.settings.finishSetup()`: marks the first-run wizard done (`settings.setup_done`). The wizard (`Setup.tsx`) shows right after the owner's first login while `app:info` says `setupDone:false`; a shop that already has a name, a bill or a product counts as set up. It reuses the Shop, GST and Printers tabs and can be skipped.

- `settings:get` · `window.api.settings.get()`: `{ shop, gst, receipt, printers, coins }`.
- `settings:saveShop` · `saveShop({ name, phone, address, gstin, state })`. Errors: "Type the shop name." · "The GSTIN is not valid…" · "The phone number is not valid." 
- `settings:saveGst` · `saveGst('regular'|'composition'|'unregistered')`. Error: "Choose a GST type."
- `settings:saveReceipt` · `saveReceipt({ footer, policy, review, returnDays, creditNoteDays, width })`. Errors: return window 0-365, credit note 1-730, paper width, review link must start with http.
- `settings:savePrinters` · `savePrinters({ receipt, drawer })`.
- `settings:saveCoins` · `saveCoins({ on, per, value, expiryMonths, maxPct })`. Errors per field (whole number, worth more than ₹0, 1-60 months, 0-100%).
- `settings:staff` · `staff()`: every staff row including inactive.
- `settings:saveStaff` · `saveStaff({ id?, name, role, maxDiscountPct, commissionPct, canCancel, canChangePrice, active, pin? })`. Errors: "Name is required." · "PIN must be 4 digits." · "Choose a PIN that is harder to guess." · "There is one owner…" · "You cannot make yourself inactive." The owner stays owner and active.
- `settings:setPin` · `setPin(staffId, pin)`: 4 digits (6 for the owner), not a weak PIN; the person must change it at the next login (not when it is the owner's own PIN); lockout cleared.
- `settings:backups` · `backups()`: `{ folder, isDefault, copies, keep, list:[{file, at, sizeBytes}] }`.
- `settings:saveBackupFolder` · `saveBackupFolder(folder)`: empty means the default folder.
- `settings:backupNow` · `backupNow()`: runs a backup now (same as Day end's). Audit `backup`.
- `settings:restore` · `restore(file)`: restores one of the files in the backup list. `settings:restoreFromFile` · `restoreFromFile()`: opens a file dialog and restores the chosen file (null when cancelled). Both check the file is a MARS POS database (our tables, not from a newer app), take a safety backup, close the database, copy the file over it and restart. Errors: "That backup is not in the list." · "This is not a MARS POS backup file." · "This backup is from a newer version…" · "That is the database in use."
- Printing (used by the screens): `print:receipt` (bill id, duplicate flag: prints the receipt text at the paper width), `print:alteration` (job id, `tag` or `slip`), `print:testReceipt`, `print:testSticker`, `print:openDrawer` (a one-line job to the receipt printer; set the printer driver to open the drawer on a job). With no printer chosen the Windows print dialog opens. Errors: "Printing was cancelled." · "The printer did not accept the job…"

## 5. Database

No new table. Writes `settings` keys `shop` (name, phone, address, gstin, state), `gst_scheme`, `receipt` (footer, policy, returnDays, creditNoteDays, width, review; an older `shop` footer/policy is only a fallback), `printers` (receipt, drawer), `coins`, `backup_folder`; also `staff`, `audit_log` and `backups` through existing services.

## 6. Business rules

- Owner only; changes are audited (`settings_change`, `staff_save`, `pin_change`, `backup`).
- A new GST type affects **new** bills only. The return window and credit note days apply to new returns at once.
- New staff get a 4-digit PIN and must choose their own at first login. A PIN set by the owner has the same rule.
- There is one owner: the role cannot be given or taken here, and the owner cannot be made inactive.
- The backup folder should be a USB drive or second disk. Day end backs up there too; the newest 30 copies are kept.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| Owner only | manager, cashier, store refused everywhere | pass | 2026-11-16 |
| Shop save, top bar, validation | saved; name, GSTIN, phone checked | pass | 2026-11-16 |
| GST type, receipt, printers, coins | saved and validated; Returns reads the window | pass | 2026-11-16 |
| Add staff, first login | must change PIN | pass | 2026-11-16 |
| Edit, deactivate, owner protected | owner stays owner and active | pass | 2026-11-16 |
| Owner sets a PIN | weak or wrong length refused; login works | pass | 2026-11-16 |
| Backup folder and back up now | file written, listed | pass | 2026-11-16 |
| Receipt settings on the receipt | footer, policy, review link, 32 or 36 characters wide | pass | 2026-11-16 |
| Restore checks | real backup accepted; junk, missing and newer files refused | pass | 2026-11-16 |
| Real print (receipt, tag, sticker) and a real restore + restart | works on the shop PC | not tested | n/a |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-13 | Placeholder note created | n/a (no git) |
| 2026-11-16 | Settings screen with eight tabs, owner-only service, tests | uncommitted |
| 2026-11-16 | Printing (receipt, tag, slip, test, drawer), receipt width and review link, restore from backup | uncommitted |
| 2026-11-16 | Light / dark theme button in the top bar: Auto (dark 7 pm to 7 am by the PC clock), Light, Dark. Saved on each PC (browser storage), not in the database | uncommitted |
| 2026-11-16 | First-run setup wizard for the owner (shop, GST, printers; skippable) and `settings:finishSetup` | uncommitted |
| 2026-11-16 | Found by running the app: the setup wizard vanished after step 1 (saving the shop name counted as set up); it now stays until Finish or Skip. Coins tab and Receipt tab wording corrected | uncommitted |
| 2026-11-17 | Staff: the "Can cancel bills without approval" option is removed (cancelling by a cashier always needs a manager PIN) | uncommitted |
