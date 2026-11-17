# Backup

## 1. Summary

- **What it does:** makes a complete, consistent copy of the database file. **Today it runs automatically when the day is closed** (Day end). There is no screen for it yet: choosing the folder, "Back up now", the list of backups and **restore** belong to the Settings module.
- **Screens:** none of its own. Triggered from Day end (`DayEnd.tsx` → `day:close`).
- **Who can use it:** whoever closes the day (Owner, Manager, Cashier).
- **Status:** **partial** (2026-11-12): automatic backup on close = done and tested; folder setting, manual backup, restore, "no backup for 2 days" warning, copying photos = pending.
- **Code:** `src/main/services/backup.ts` (`runBackup`, `setBackupDir`, `backupFolder`) · called by `src/main/services/dayend.ts` (`closeDay`) · start-up wiring in `src/main/index.ts` · table `backups` · tests in `src/main/services/dayend.test.ts` (backup group).

**Also automatic:** at app start `autoBackupIfDue()` backs up when the shop has data and the newest backup is over 24 hours old (it never stops the app from opening). A yellow bar on every screen (owner and manager) says when the newest backup is over 2 days old or there is none (`app:info` → `backupWarn`, `backupDays`). A missing USB folder gives "The backup folder … cannot be used. If it is on a USB drive, plug the drive in…".

## 2. Screen controls

No dedicated controls. (Day end's **Close day** is what triggers it; the result message shows the backup path.)

## 3. Flows

**Close day → backup** → `closeDay()` closes the day first, then calls `runBackup()` → picks the folder (`settings.backup_folder`, else the default set at start-up) → creates it if missing → chooses a file name that does not exist yet → `VACUUM INTO '<file>'` (a consistent copy even while the app is open, WAL mode) → records the file and size in `backups` → deletes all but the newest 30 backups (files and rows). If anything fails the error is returned to the screen and logged as `backup_failed`; the day stays closed.

## 4. APIs

No `window.api` function. Internal function:

### `runBackup()` (called by `closeDay`)
- **Request:** none. **Returns:** `{ "file":"C:\\Users\\MARS\\AppData\\Roaming\\mars-pos\\backups\\mars-2026-11-12.db","sizeBytes":245760 }`.
- **Errors:** `No backup folder is set.` (no setting and no default); file-system or SQLite errors are passed on as their message.
- **Tables read:** `settings` (`backup_folder`). **Written:** `backups` (`at`, `file`, `size_bytes`); old rows deleted. **Side effects:** a `.db` file written, old files removed (failures deleting an old file are ignored).
- **Steps:** folder → mkdir → unique name → `VACUUM INTO` → size → insert `backups` → prune.
- **Example:** closing on 12 Nov creates `mars-2026-11-12.db`; closing a second time that day creates `mars-2026-11-12-180509.db` (time added); in the same second `…-180509-2.db`.

## 5. Database

Table `backups(id, at, file, size_bytes)`.
```sql
VACUUM INTO '<folder>/mars-2026-11-12.db';
INSERT INTO backups (at,file,size_bytes) VALUES (?,?,?);
SELECT id,file FROM backups ORDER BY id DESC LIMIT -1 OFFSET 30;     -- the ones to delete
DELETE FROM backups WHERE id=?;
```

## 6. Business rules

- **What is backed up:** the whole database (all tables). **Not** the product photos (K-05) and not `config.json`.
- **Where:** `backup_folder` setting if set, else `%APPDATA%\mars-pos\backups`. The default is on the **same disk** as the database (K-06): a USB drive or second disk should be chosen in Settings (Q-5).
- **Names:** `mars-YYYY-MM-DD.db`; later the same day `-HHMMSS`, then `-N`. Never overwrites.
- **Retention:** newest 30.
- **A failed backup never blocks closing the day** (D-20).
- **Restore** is in Settings → Backup (a listed backup or a file you choose): a safety copy is taken, the file is swapped and the app restarts. Tried in the real app on 2026-11-16: bills and stock went back to the backup. The list of backups shown afterwards is the one stored inside the restored file, so newer copies (and the safety copy) are not listed; use "Restore from backup file…" to pick them.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| the backup made when closing › is a complete, readable copy of the database, recorded in the backups table | File is inside the backup folder, passes `integrity_check`, contains the bill and the closed day, one `backups` row with its size | pass | 2026-11-13 |
| the backup made when closing › closes the day anyway when the backup cannot be made, and says so | With no folder: `{ok:false,error:"No backup folder is set."}`, day closed, `backup_failed` audit row | pass | 2026-11-13 |
| the backup made when closing › does not overwrite an earlier backup from the same day, and keeps only the newest 30 | Repeated closes give distinct files; after 36 only 30 files and 30 rows remain | pass | 2026-11-13 |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-12 | Backup on day close with `VACUUM INTO`, 30-copy retention | n/a (no git) |
| 2026-11-12 | Unique file names (two backups in the same second collided) | n/a |
| 2026-11-16 | Automatic backup at app start when the newest is over 24 hours old (`autoBackupIfDue`); clear message when the backup drive is missing; warning bar (owner, manager) when the newest backup is over 2 days old or none | uncommitted |
| 2026-11-17 | The app also checks every hour while it stays open, so the daily backup happens even if it is never restarted | uncommitted |
