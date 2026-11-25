# Licence and onboarding

## 1. Summary

- **What it does:** a new PC opens on the **Activate this PC** screen; nothing else works until it is activated. After activation the owner logs in and is walked through the **first-run wizard** (shop, GST, categories, printers, own PIN, staff). From then on the app works without internet. An expired licence **blocks the whole application**: only the "Licence expired" screen (renew over the internet, or type a renewal code) opens. Data is never deleted.
- **Screens:** `src/renderer/screens/Licence.tsx` (`Activate`, and `LicenceTab` in Settings → Licence), `src/renderer/screens/Setup.tsx` (wizard), banners in `src/renderer/App.tsx`.
- **Who can use it:** anyone at the PC can activate / renew (the codes are signed by MARS). The wizard and Settings → Licence are owner only.
- **Status:** built, not yet tried against a real licence server (the server and admin portal are not in this repo).
- **Code:** `src/main/services/licence.ts`, `licenceKey.ts` (public key), `licenceSign.ts` (MARS side), `src/shared/licence.ts`, `scripts/licence.ts` (support tool), tests `src/main/services/licence.test.ts`, `firstrun.test.ts`.

## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| Activation key, Owner's mobile | fields | `MARS-XXXX-XXXX-XXXX` and 10 digits |
| Activate (tab "Activation key") | button | asks the MARS server; saves the licence |
| No internet tab: Make the request code / Copy / response box / Activate | buttons, field | offline activation, see flow below |
| Free trial tab: Send me the code / Start free trial | buttons | 14-day trial with a mobile one-time code |
| Settings → Licence: Check with MARS now, Renewal code + Renew | button, field | weekly check on demand; offline renewal |
| Top bar chip | banner | "ends in N days", "no server contact for N days"; the full-screen "Licence expired" renewal screen |

## 3. Flows

**Online activation** → key + mobile → `window.api.licence.activateOnline` → `licence:activateOnline` → POST `/v1/activate` `{key, mobile, machine}` → server returns `{licence}` (a signed `MARSL1.…` token) → verified with the public key, bound to this PC → saved in `settings.licence`.

**Offline activation** → `licence:request` makes `MARSR1.…` (key, PC id, mobile) → owner sends it to MARS → support runs `npm run licence -- issue <request code> --shop "…" --days 365` (or the admin portal) → owner pastes the `MARSL1.…` response → `licence:activateCode`. The same box renews.

**Free trial** → `licence:trialOtp` (POST `/v1/trial/otp`) → `licence:trialVerify` (POST `/v1/trial/verify`) → trial licence (kind `trial`).

**Weekly check** → at start and every 6 hours `refreshLicence()`; if the last check is 7+ days old it POSTs `/v1/refresh`; a newer licence in the reply replaces the old one. Failures are silent (billing is never blocked).

**First-run wizard** → after the owner's first login, while `setup_done` is false: Shop details → GST type → Categories → Printers (test print) → Your PIN (`settings:setPin`) → Staff (add people, PINs, limits, recovery code). Skip or Finish calls `settings:finishSetup`.

## 4. APIs

Server contract (not built here): every reply is JSON; an error is `{error: "message"}` with a non-200 status.

| Channel | Request | Result / errors |
|---|---|---|
| `licence:status` | none | `LicenceInfo` (`state` none / active / expiring / expired / invalid, `daysLeft`, `machine`, `skip`…) |
| `licence:request` | key, mobile | request code string; errors: bad key, bad mobile |
| `licence:activateCode` | code | `LicenceInfo`; errors: not a MARS code, bad signature, other PC, other key |
| `licence:activateOnline` | key, mobile | `LicenceInfo`; errors: no server set up, cannot reach server, server message |
| `licence:trialOtp` | mobile | `true` |
| `licence:trialVerify` | mobile, otp, shop | `LicenceInfo` |
| `licence:refresh` | none | `LicenceInfo` (Check with MARS now) |

Every call except `licence:*`, `app:info`, `app:logo` and `auth:logout` first runs `assertActivated` in `ipc.ts`: it refuses when the PC is not activated, the licence is invalid, or it has expired. `billing:create` also calls `assertCanSell`. The screen re-checks the licence every minute and locks a logged-in user the moment it expires.

## 5. Database

`settings` key `licence` = `{token, via: online|code, at, checkedAt}`. Audit action `licence_activated`. No new tables.

## 6. Business rules

- A licence is signed (Ed25519) by MARS; the app holds only the public key (`licenceKey.ts`, a **development key** until a production pair is made with `npm run licence -- keygen`).
- Bound to this PC: id = hash of host name + OS + first network adapter. A licence copied to another PC shows "belongs to another PC". Changing the network adapter or the PC name needs a release from MARS.
- Expiry date is inclusive. Warning from 14 days before. An online licence with no server contact for 30 days shows a warning only.
- Expired: the application is blocked (login, billing, reports, backup buttons; everything) until renewed. The renewal screen offers "Renew over the internet" and a renewal-code box. The data stays on the PC.
- Development without the admin portal: `npm run dev` starts an embedded stand-in server on `127.0.0.1:4150` (`src/main/devserver/`, loaded only when the app is not packaged). It does the same activation and owner PIN-reset steps against the same MongoDB and sends the same emails (the reset link opens a page served by it, so on this PC only). Its secrets (MongoDB link, SMTP login, licence signing key) are read from `.local-server/` (git-ignored, not in the installer; copy `.env` and `licence-private.pem` from the portal). Without that folder the app uses the portal on :4100; `MARS_LICENCE_URL` overrides both. Installed apps never contain these secrets.
- Developers: `MARS_SKIP_LICENCE=1` skips the activation screen and the expiry block. Server address: `MARS_LICENCE_URL` or `licenceServer` in `config.json`.
- Not built yet: the cloud server, the admin portal, "Release PC", the 14-day trial lead capture on the server side, licence-bound cloud restore.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| New install is not activated; login closed | `assertActivated` throws | pass | 2026-11-24 |
| Request code → response code activates | state active | pass | 2026-11-24 |
| Forged / other-key / other-PC / bad codes | refused with a readable message | pass | 2026-11-24 |
| 10 days left | state expiring, still sells | pass | 2026-11-24 |
| Expired | `assertActivated` and `assertCanSell` throw; data still there; a renewal code or a server renewal unblocks | pass | 2026-11-24 |
| Licence on another PC; renewal for another key | invalid; refused | pass | 2026-11-24 |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-24 | Activation gate, offline codes, trial, read-only expiry, wizard steps for categories, own PIN and staff | |
