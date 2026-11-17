# Installer

> **Status: pending.** Not started. `electron-builder` 26.18.0 is installed but **there is no build configuration**, so no `.exe` can be produced yet.

## 1. Summary (planned)

- **What it will do:** produce a one-click Windows installer (NSIS `.exe`) for the shop PC, install the app with a Start-menu/desktop shortcut, and keep the shop's data safe across updates and uninstalls.
- **Code (to create):** a `build` block in `package.json` (or `electron-builder.yml`), an icon, installer text, a build script and a release checklist.

## 2. What is already true

- `npm run build` compiles to `out/` (main, preload, renderer). `package.json` `main` is `./out/main/index.js`.
- **No native build step is needed**: `better-sqlite3` 13.1.1 ships prebuilt Node-API binaries that work in Node and Electron, so the PC needs no Python or Visual Studio (this was fixed on 2026-11-12).
- Data lives in `%APPDATA%\mars-pos\` (database, `photos`, `backups`, `config.json`), outside the install folder, so reinstalling or updating keeps it.

## 3. Planned rules

- **App id / product name** `MARS POS`; per-machine or per-user install to decide.
- **The database must never be inside the install folder** and the uninstaller must not delete `%APPDATA%\mars-pos` (offer "keep my data").
- The packaged app must not need the dev-only environment (no `ELECTRON_RUN_AS_NODE`).
- Before go-live: set `FORCE_PIN_CHANGE = true` (README K-10), remove sample/demo data, check Content-Security-Policy in the packaged build.
- Code signing and auto-update: later (SmartScreen will warn on an unsigned installer).
- Version number in `package.json` is the app version; a migration is added for every schema change and runs on first start of the new version.

## 4. Open questions

- Per-user or per-machine install? Code-signing certificate? Update channel (manual USB vs download)?

## 5. Done when

`npm run dist` (name to decide) produces an installer that installs and starts on a clean Windows 10 PC with no dev tools, creates the database on first run, and survives an upgrade install with data intact; README "how to build the .exe" section filled in; this page completed.

## Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-12 | Removed the `postinstall` native rebuild (not needed; fixes "no Python" error) | n/a (no git) |
| 2026-11-13 | Placeholder note created | n/a |
| 2026-11-16 | `npm run dist` builds `distMARS POS Setup 0.1.0.exe` (electron-builder, NSIS, per-user). Electron moved to devDependencies; native rebuild off (prebuilt better-sqlite3). Not yet installed on a clean PC; unsigned; default icon | uncommitted |
| 2026-11-17 | Installer tested here: silent install, uninstall (app removed, all 837 data files in %APPDATA%mars-pos kept), reinstall. `deleteAppDataOnUninstall:false` set. Signing instructions below. Still needs a clean-PC test | uncommitted |

## Data location and code signing (2026-11-17)

- **Data stays out of the install folder.** The program goes in the install folder (per user by default, you can choose the folder). All data is in `%APPDATA%mars-pos` (database `mars-pos.db`, `backups`, `photos`, `config.json`). If `config.json` has a `dbPath`, the database is at that path instead. The uninstaller never deletes this folder (`deleteAppDataOnUninstall:false`), so reinstalling or updating keeps everything. Tested on the developer PC: uninstall kept all 837 files, reinstall kept them.
- **Silent install** (for IT): `"MARS POS Setup 0.1.0.exe" /currentuser /S`. Silent uninstall: `"Uninstall MARS POS.exe" /currentuser /S`.
- **Code signing (not done: needs a certificate bought by the owner).** Without it Windows shows "Unknown publisher" / SmartScreen. Buy an OV or EV code-signing certificate (EV removes the SmartScreen warning at once; OV builds reputation over time) or use Azure Trusted Signing. Then, on the build PC, set `CSC_LINK` (path to the .pfx or its base64) and `CSC_KEY_PASSWORD`, and run `npm run dist`: electron-builder signs the app and the installer automatically. Check with right-click → Properties → Digital Signatures.
- **Clean-PC test (still to do):** install on a PC that has never had the app, open it, make a bill, close it, reinstall over it, and confirm the bill is still there.
