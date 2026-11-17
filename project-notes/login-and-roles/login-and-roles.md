# Login and roles

## 1. Summary

- **What it does:** staff pick their name and type a PIN. The main process remembers who is logged in and checks the role on every action. A cashier needing a big discount, or store staff adjusting stock, asks a **manager/owner to approve by name + PIN**. The app locks itself after 10 minutes of no clicks or keys. The top bar shows the shop name, counter, clock, **"My sales today"** and a **Lock** button.
- **Screens:** Login screen (`src/renderer/screens/Login.tsx`), the shell (`src/renderer/App.tsx`: top bar, side menu, idle lock, F1).
- **Who can use it:** everyone (the login); see the permission table in the [main README](../README.md#8-roles-and-permissions).
- **Status:** **done** (2026-11-12; approval lockout added 2026-11-13). Known gaps: K-02 (some read calls need no login), `FORCE_PIN_CHANGE` is off.
- **Code:** `src/main/services/session.ts`, `auth.ts`, `pin.ts`, `approval.ts`, `settings.ts`, `db/seed.ts`; `src/preload/index.ts`; `src/shared/types.ts` (roles, menu); tests in `src/main/services/services.test.ts` (login group), `stockops.test.ts`, `billing.test.ts` (approval).

## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| Staff tile (name + role) | button | Selects who is logging in (only active staff are listed) |
| PIN dots | display | Shows how many digits are typed (at least 4 dots, grows to 6) |
| Number pad 0–9 | buttons | Types a digit (max 6) |
| ⌫ | button | Deletes the last digit |
| **OK** | button | Sends the PIN. Also **Enter** on the keyboard |
| Physical keyboard digits / Backspace / Enter | keys | Work on the pad when no text box has focus |
| Set your own PIN: *New PIN*, *Confirm new PIN* | password fields | Only shown when the account still must change its PIN (off now). Enter in *Confirm* saves |
| **Save PIN and continue** | button | Saves the new PIN |
| **Lock** (top bar) | button | Logs out and returns to the login screen |
| Top bar chip **My sales today ₹x** | display | Today's completed sales where *you* are the salesperson; refreshes on screen change, every 20 s and right after a bill is saved |
| Side menu | buttons | Only items in `ENABLED` and allowed for the role |
| **F1** | shortcut | Jumps to Billing from any screen (if the role has Billing) |
| Idle lock | automatic | After `security.idleMinutes` (default 10) without a mouse click or key press the user is logged out |

## 3. Flows

**Log in** → user taps a name, types the PIN, presses OK → `window.api.auth.login(staffId, pin)` → channel `auth:login` → `login()`: reads the `staff` row; if `locked_until` is in the future → locked message; verifies PIN with scrypt; wrong → `failed_attempts+1` (5th wrong sets `locked_until = now + 60 s`, resets the counter) and writes `login_failed`; right → resets counters, writes `login`, and sets the session (`setCurrent`). If `must_change_pin=1` the session is only *pending*: no action works until the PIN is changed. → tables: **read/write `staff`, write `audit_log`**.

**Change PIN** → `window.api.auth.changePin(pin)` → `changePin()`: needs a pending login; PIN length 6 for owner, 4 for others; weak PINs refused; saves a new scrypt hash, clears `must_change_pin`, makes the session active → **write `staff`, `audit_log` (`pin_change`)**.

**Lock / idle lock** → `window.api.auth.logout()` → `logout()` clears the session in the main process. The screen then shows the login.

**Approval (used by Billing, Stock out, Stock)** → screen shows the approval dialog (choose manager/owner, type their PIN) → the PIN travels inside the action's request as `approval: {staffId, pin}` → `checkApprover()`:
1. the chosen person must be an active owner/manager (otherwise the same "not correct" message, nothing counted)
2. if that approver is **locked**, refuse at once, even for the right PIN (no PIN is tested)
3. right PIN → clear their failure count, return their id
4. wrong PIN → count it (`approval_attempts`), write `approval_failed`, say how many tries are left; the **5th** wrong PIN locks approvals by that person (1 min, then 2, 4, 8, max 15) and writes `approval_locked`.
Reads/writes: `staff`, **`approval_attempts`**, `audit_log`. Called *before* the action's own transaction so the count survives the error.

**Top bar sales chip** → `window.api.app.mySales()` → `mySalesToday()`.

## 4. APIs

All calls return `{ ok:true, data }` or `{ ok:false, error:"message" }` at the IPC level; the screen sees `data` or a rejected promise with that message.

### `window.api.auth.staff()` · channel `auth:staff`
- **Called from:** Login screen on load · **Roles:** anyone (no login needed).
- **Request:** none.
- **Response:** `[{ "id":"3b6f…","name":"Owner","role":"owner" }, { "id":"…","name":"Cashier","role":"cashier" }]` (active staff, in creation order).
- **Errors:** none expected.
- **Tables:** read `staff`. **Steps:** `SELECT id,name,role FROM staff WHERE active=1 ORDER BY rowid`.
- **Example:** four tiles: Owner, Manager, Cashier, Store staff.

### `window.api.auth.login(staffId, pin)` · channel `auth:login`
- **Called from:** Login → OK · **Roles:** anyone.
- **Request:** `{ "staffId":"3b6f…", "pin":"1111" }`

| Field | Type | Required | Validation |
|---|---|---|---|
| staffId | string | yes | an active staff id |
| pin | string | yes | compared with the stored scrypt hash |

- **Response (success):** `{ "ok":true, "staff":{ "id":"3b6f…","name":"Owner","role":"owner" }, "mustChangePin":false }`
- **Response (failure).** A wrong PIN is *not* an IPC error: the call succeeds and the result itself says `ok:false`: `{ "ok":false, "error":"Wrong PIN (4 tries left)." }`. When locked it also has `"lockedFor":60` (seconds).

| When | Message |
|---|---|
| staff id not found / inactive | `Unknown staff member.` |
| account is locked | `Too many wrong PINs.` (+ `lockedFor` seconds) |
| wrong PIN, fewer than 5 | `Wrong PIN (N tries left).` |
| 5th wrong PIN | `5 wrong PINs. Locked for 1 minute.` (`lockedFor: 60`) |

- **Tables:** read/write `staff`; write `audit_log` (`login`, `login_failed`). **Side effects:** sets the session in the main process.
- **Example:** Owner types `1111` → `{ ok:true, staff:{name:"Owner",role:"owner"}, mustChangePin:false }`; `audit_log` gets `login`.

### `window.api.auth.changePin(pin)` · channel `auth:changePin`
- **Called from:** "Set your own PIN" → Save · **Roles:** a user who has just logged in with a default PIN.
- **Request:** `{ "pin":"731942" }` (owner, 6 digits) or `{ "pin":"7391" }` (others, 4 digits).
- **Response:** `{ "ok":true, "staff":{ "id":"…","name":"Cashier","role":"cashier" } }`

| When | Message |
|---|---|
| no pending login | `Log in again first.` |
| wrong length | `PIN must be 6 digits.` / `PIN must be 4 digits.` |
| weak (0000, 1111, 2222, 3333, 4444, 1234, 123456, 111111, 000000, or one repeated digit) | `Choose a PIN that is harder to guess.` |

- **Tables:** write `staff` (`pin_hash`, `must_change_pin=0`), `audit_log` (`pin_change`). **Steps:** check pending id → length → weak list → hash → update → activate session.
- **Example:** Cashier sends `7391` → saved; session becomes active.

### `window.api.auth.logout()` · channel `auth:logout`
- **Called from:** Lock button, idle lock · **Roles:** anyone · **Request:** none · **Response:** `null`.
- **Tables:** none. **Side effect:** session cleared in memory. (Logout is not written to `audit_log`.)

### `window.api.app.info()` · channel `app:info`
- **Called from:** App on load (top bar, idle limit) · **Roles:** anyone.
- **Response:** `{ "shopName":"Your Shop", "counter":"C1", "idleMinutes":10 }` (`shop.name` setting if set, else "Your Shop").
- **Tables:** read `settings` (`shop`, `counter`, `security`).

### `window.api.app.mySales()` · channel `app:mySales`
- **Called from:** top bar · **Roles:** logged in.
- **Response:** `149900` (paise) = ₹1,499.
- **Errors:** `Not logged in.`
- **Query:** `SELECT COALESCE(SUM(grand),0) FROM bills WHERE status='completed' AND COALESCE(sales_by,staff_id)=? AND at>=<start of today, local>`.

### `window.api.stock.approvers()` · channel `app:approvers`
- **Called from:** approval dialogs in Stock out and Stock · **Roles:** logged in.
- **Response:** `[{ "id":"3b6f…","name":"Owner","role":"owner" }, { "id":"9c21…","name":"Manager","role":"manager" }]`.
- **Errors:** `Not logged in.` **Tables:** read `staff` (`active=1 AND role IN ('owner','manager')`).

### Approval check (internal, not a window.api call): `checkApprover({staffId, pin})`
- **Used by:** `billing:create` (discount), `stock:out` (below zero), `stock:adjust` (store staff), `count:approve` (store staff).
- **Request part:** `approval: { "staffId":"9c21…", "pin":"2222" }`

| When | Message |
|---|---|
| no approval sent but one is needed | `A manager or owner must approve this.` |
| chosen person is not an active owner/manager | `That PIN is not correct for the chosen manager or owner.` (nothing is counted: there is no PIN to guess) |
| wrong PIN, fewer than 5 in a row | `That PIN is not correct for the chosen manager or owner (3 tries left).` (writes `approval_failed`) |
| the 5th wrong PIN | `Too many wrong approval PINs. Approvals by this person are locked for 60 seconds.` (writes `approval_locked`) |
| approver is locked | `Too many wrong approval PINs. Try again in 45 seconds.` (even for the right PIN; no PIN is tested) |

- **Lock times:** 60 s, then 120, 240, 480 and at most 900 s (15 minutes) if it keeps happening. A right PIN clears the count and the lock history.
- **Separate from login:** locking approvals by the Manager does not stop the Manager logging in, and does not stop the Owner approving.
- **Example:** a cashier tries `0000`, `0001`, … on the Manager: 4 wrong → "(1 try left)", the 5th locks the Manager's approvals for a minute, and the next 95 guesses in a loop are refused without being tested. At most 5 PINs can be tried per lock period. Because the lock keeps doubling until a right PIN clears it, after the first few rounds it is 5 guesses per 15 minutes (about 480 a day): trying all 10,000 four-digit PINs would take roughly three weeks, and every attempt is in the audit log with the requester's name. (Before the fix there was no limit at all.)
- **Residual risk:** a guesser can keep one approver locked; the owner can approve instead.

## 5. Database

Tables: `staff`, `audit_log`, `settings` (see README section 7).
Key queries: `SELECT * FROM staff WHERE id=? AND active=1` · `UPDATE staff SET failed_attempts=?, locked_until=? WHERE id=?` · `UPDATE staff SET pin_hash=?, must_change_pin=0 WHERE id=?`.
PIN storage: `scrypt$<16-byte salt hex>$<32-byte hash hex>`; compared with `timingSafeEqual`.
Seed (first run only): Owner 1111 (max discount 100, cancel ✔, price ✔) · Manager 2222 (30, ✔, ✔) · Cashier 3333 (10, ✖, ✖) · Store staff 4444 (0, ✖, ✖).

## 6. Business rules

- **Lockout:** 5 wrong PINs → account locked for 60 s (per staff member). The counter resets on a successful login.
- **PIN length** when *changing*: owner 6, others 4. Login accepts 1–6 typed digits.
- **Default PINs** work without change while `FORCE_PIN_CHANGE=false` (`seed.ts`). Set to `true` before go-live (the change-PIN flow is built and tested).
- **Session lives in the main process** (`session.ts`). A "pending" session (default PIN not changed) allows nothing but `changePin`.
- **Idle lock:** 10 minutes (`security.idleMinutes`), checked every 20 s in the screen; it calls `logout`.
- **Roles per action:** table in the main README (section 8). `requireRole(...)` throws `You are not allowed to do this.`; with no session `Not logged in.`
- **Approvals** name the approver; owner/manager need none. **Wrong approver PINs are limited** (D-25): 5 wrong → locked 1 minute, doubling up to 15 minutes, per approver, separate from login.
- **Read calls without login:** see K-02.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| login › gives no session until a default PIN is changed | After logging in with a default PIN, actions fail with "Not logged in."; after `changePin('7391')` the session works, but a cashier still cannot create a product ("not allowed") | pass | 2026-11-13 |
| login › locks after 5 wrong PINs | 4 wrong tries say "tries left"; the 5th returns `lockedFor: 60`; even the right PIN is refused while locked | pass | 2026-11-13 |
| discount and stock approval › asks a cashier for approval above their limit, and checks the approver PIN | Wrong PIN, and a cashier as approver, are both refused ("not correct"); manager `2222` is accepted; `approve` is written to `audit_log` with the manager's id | pass | 2026-11-13 |
| stock out › needs approval for store staff to go below zero, but not owner or manager | Store staff cannot approve themselves; manager PIN works; owner needs none | pass | 2026-11-13 |
| approver PIN lockout › counts wrong PINs, then locks that approver, even for the right PIN | "(4 tries left)" … "(1 try left)"; 5th: "locked for 60 seconds"; right PIN then: "Try again in 60 seconds" (30 after half a minute) | pass | 2026-11-13 |
| approver PIN lockout › lets the approver work again once the lock has run out | After 61 s the right PIN is accepted | pass | 2026-11-13 |
| approver PIN lockout › makes each further lock longer (1, 2, 4, 8 minutes) and never more than 15 | Locks of 60, 120, 240, 480, 900, 900 s; still locked 1 ms before the end | pass | 2026-11-13 |
| approver PIN lockout › forgets the failures after a right PIN, and the lock count starts again | 4 wrong + right PIN clears; the next lock is 60 s (lock number 1) | pass | 2026-11-13 |
| approver PIN lockout › keeps each approver separate, and never touches the approver's own login | Manager locked; Owner can approve; Manager can still log in with 2222 | pass | 2026-11-13 |
| approver PIN lockout › stops checking PINs while locked, so a brute-force run tries only 5 PINs per lock | 100 guesses → 5 `approval_failed` rows, 1 `approval_locked` | pass | 2026-11-13 |
| approver PIN lockout › does not count tries on someone who cannot approve, and says the same thing as for a wrong PIN | Cashier/unknown id: same message every time, `approval_attempts` stays empty | pass | 2026-11-13 |
| approver PIN lockout › needs an approval to be sent at all when one is required | `undefined` → "must approve" | pass | 2026-11-13 |
| approver PIN lockout › writes who tried, whom and how many tries were left, in the audit log | `approval_failed` row: staff = the cashier, details `{approver, triesLeft:4}` | pass | 2026-11-13 |
| where approvals are asked for (4 tests) | Billing discount, stock adjust, stock out below zero and count approval are each refused while the manager is locked and work after the lock ends | pass | 2026-11-13 |
| recent moves and approvers › lists only owners and managers as approvers | `listApprovers()` returns roles `owner, manager` only | pass | 2026-11-13 |
| config › resolveDbPath (3 tests) | Default path, `config.json` path, env var wins and a broken config is ignored | pass | 2026-11-13 |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-12 | PIN login with lockout, scrypt hashing, forced PIN change flow | n/a (no git) |
| 2026-11-12 | Session moved into the main process; changePin works on the pending session | n/a |
| 2026-11-12 | Default PINs set to 1111/2222/3333/4444 with forced change off (D-09) | n/a |
| 2026-11-12 | Approval names the approver (`approval.ts`); idle lock; "My sales today" chip; F1 shortcut | n/a |
| 2026-11-13 | **K-01 fixed**: approver PIN lockout (5 wrong → 1 min, doubling to 15; per approver; separate from login), migration 3 `approval_attempts`, 13 tests | n/a |
| 2026-11-16 | Only one copy of the app per PC (a second launch brings the open window forward) | uncommitted |
| 2026-11-17 | Found in a full test: at the first login a new staff member could "change" their PIN to the same given PIN; now refused | uncommitted |
