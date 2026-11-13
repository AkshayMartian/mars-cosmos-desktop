# Day end

## 1. Summary

- **What it does:** the end-of-day cash check. It shows the cash that **should** be in the drawer (opening cash + cash sales − cash refunds − expenses), lets staff record **expenses** (tea, courier…), asks for the **counted cash**, shows the difference, and **closes the day**. Closing locks the day (no more bills or expenses on it) and **makes a backup of the database**. If no day is open it offers **Open the day**.
- **Screen:** `DayEnd` (`src/renderer/screens/DayEnd.tsx`) with a "Close the day?" confirmation. The "Start the day" dialog is shared with Billing.
- **Who can use it:** Owner, Manager, Cashier. Store staff: no.
- **Status:** **done** (2026-11-12). Not included: printing the day-close slip; a Settings screen to choose the backup folder (the backup itself works); re-opening a closed day.
- **Code:** screen `src/renderer/screens/DayEnd.tsx` (uses `OpeningModal` from `Billing.tsx`) · service `src/main/services/dayend.ts` · `backup.ts` · `billing.ts` (`openDay`, `openSessionRow`) · shapes `src/shared/dayend.ts` · tests `src/main/services/dayend.test.ts`.

## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| Header | text | "12 Nov 2026 · Counter C1 · opened by Owner" |
| Cash figures | display | Opening cash · Cash sales (N bills) · Cash refunds · Expenses · **Expected in drawer** (large) |
| Expenses list | display | Each expense: what it was for, amount |
| *Amount ₹* | number | Expense amount; Enter adds |
| *For* | text (e.g. "Tea, courier…") | What it was for; Enter adds |
| **Add expense** | button | Saves the expense on the open day |
| *Counted cash ₹* | number (auto-focus) | The cash counted in the drawer |
| *Difference* | display (after typing) | `counted − expected`; green if over or equal, red if short |
| **Close day** | button | Disabled until a count is typed; opens the confirmation |
| Confirmation | dialog | Expected, counted, difference, "A closed day cannot be changed…"; **Keep the day open** / **Close day** |
| **Open the day** | button (no open day) | Opens the Start the day dialog (*Opening cash ₹*, **Start day**) |
| Hint | text | "Closing also runs the backup. A closed day cannot be changed." |

## 3. Flows

**Open the screen** → `day.summary()` → no open session → "No open day…" + **Open the day**; open session → the figures.

**Add expense** → `day.addExpense(amount, note)` → `expenses` row → figures refresh (expected cash drops).

**Close the day** → type counted cash → **Close day** → confirmation → `day.close(counted)`:
1. role, open day, counted is a whole number ≥ 0
2. **expected cash recomputed in the main process** (never taken from the screen)
3. `day_sessions` → `closed` with `expected_cash`, `counted_cash`, `diff`, `closed_by`, `closed_at`; audit `day_close`
4. **backup** of the whole database (`runBackup`) into the backup folder; recorded in `backups`
5. the screen shows e.g. "Day closed. Expected ₹3,449, counted ₹3,349. Cash is short by ₹100. Backup saved to C:\Users\MARS\AppData\Roaming\mars-pos\backups\mars-2026-11-12.db"; if the backup failed: "…The backup could NOT be made: <reason>" (the day is closed anyway; audit `backup_failed`).

After closing, Billing shows "Start the day" again for the next day.

## 4. APIs

IPC result `{ ok:true, data }` / `{ ok:false, error:"message" }`. Roles for all: **owner, manager, cashier**.

### `window.api.day.summary()` · channel `day:summary`
- **Called from:** Day end on load and after every change. **Request:** none.
- **Response (day open):**
```json
{ "session":{ "id":"6e1d…","date":"2026-11-12","counter":"C1","openedAt":"2026-11-12T08:55:01.120Z","openedBy":"Owner" },
  "opening":200000,"cashIn":149900,"cashOut":0,"salesCount":1,
  "expenses":[{ "id":"41b7…","note":"Tea","amount":5000,"at":"2026-11-12T11:02:44.000Z","staff":"Cashier" }],
  "expensesTotal":5000,"expected":344900 }
```
- **Response (no open day):** `{ "session":null,"opening":0,"cashIn":0,"cashOut":0,"salesCount":0,"expenses":[],"expensesTotal":0,"expected":0 }`
- **Errors:** role errors only.
- **Tables read:** `day_sessions, staff, payments, bills, expenses`.
- **Query (cash):** `SELECT COALESCE(SUM(CASE WHEN p.amount>0 THEN p.amount END),0) AS cin, COALESCE(-SUM(CASE WHEN p.amount<0 THEN p.amount END),0) AS cout FROM payments p JOIN bills b ON b.id=p.bill_id WHERE b.session_id=? AND b.status='completed' AND p.mode='cash'`; sales count: `SELECT COUNT(*) FROM bills WHERE session_id=? AND type='sale' AND status='completed'`.
- **Example:** opening ₹2,000, one cash sale ₹1,499, expense ₹50 → expected `200000 + 149900 − 0 − 5000 = 344900` (₹3,449).

### `window.api.day.addExpense(amount, note)` · `day:addExpense`
- **Called from:** **Add expense**. **Request:** `{ "amount":5000,"note":"Tea" }`

| Field | Type | Required | Validation |
|---|---|---|---|
| amount | integer paise | yes | whole number > 0 |
| note | string | yes | not blank (trimmed) |

- **Response:** `null`.

| When | Message |
|---|---|
| no open day | `There is no open day. Start the day first.` |
| amount ≤ 0 or not whole | `Enter the amount spent.` |
| blank note | `Enter what it was for.` |

- **Tables written:** `expenses`, `audit_log` (`expense_add`).

### `window.api.day.close(countedCash)` · `day:close`
- **Called from:** confirmation → **Close day**. **Request:** `{ "countedCash":334900 }`

| Field | Type | Required | Validation |
|---|---|---|---|
| countedCash | integer paise | yes | whole number ≥ 0 |

- **Response:**
```json
{ "expected":344900,"counted":334900,"diff":-10000,
  "backup":{ "ok":true,"file":"C:\\Users\\MARS\\AppData\\Roaming\\mars-pos\\backups\\mars-2026-11-12.db" } }
```
  or `"backup":{ "ok":false,"error":"No backup folder is set." }`.

| When | Message |
|---|---|
| no open day | `There is no open day to close.` |
| count invalid | `Enter the cash you counted (0 or more).` |

- **Tables written:** `day_sessions` (closed), `audit_log` (`day_close`, `backup_failed`), `backups`. **Side effects:** a database copy file in the backup folder; old copies beyond 30 are deleted. (No printing yet.)
- **Example:** expected ₹3,449, counted ₹3,349 → `diff:-10000` (₹100 short); backup `mars-2026-11-12.db` created.

### Related: `window.api.billing.openDay(openingCash)` · `billing:openDay`
Documented in [Billing](../billing/billing.md) (starts the day; refused if one is already open: `The day is already started.`).

## 5. Database

Read: `day_sessions, payments, bills, expenses, staff`. Written: `expenses, day_sessions, backups, audit_log`.
```sql
INSERT INTO expenses (id,session_id,amount,note,staff_id,at) VALUES (?,?,?,?,?,?);
UPDATE day_sessions SET status='closed',expected_cash=?,counted_cash=?,diff=?,closed_by=?,closed_at=? WHERE id=? AND status='open';
VACUUM INTO '<backup folder>/mars-2026-11-12.db';                 -- backup.ts
INSERT INTO backups (at,file,size_bytes) VALUES (?,?,?);
```

## 6. Business rules

- **Expected cash** = opening cash + cash payments (> 0) − cash refunds (negative cash payments) − expenses. **Only cash** counts: UPI and card are not in the drawer. **Cancelled bills are left out.**
- The figure is **always recomputed** at close, so a stale or tampered screen cannot change it.
- **Difference** = counted − expected: negative = short, positive = over.
- **A closed day cannot be changed**: no bills, no expenses, no second close. A **new day** can then be started (new opening cash). One open day per counter at a time.
- **Closing never fails because of the backup**: the day closes first, the backup is attempted, and the result says if it failed.
- **Backups:** `mars-YYYY-MM-DD.db`; a second backup the same day adds the time (`mars-2026-11-12-180509.db`), then a counter if even that exists; **newest 30 kept**, older files and their `backups` rows deleted. Folder: `backup_folder` setting, else `%APPDATA%\mars-pos\backups` (same disk; K-06). Photos are not included (K-05).
- Held bills stay held across days.
- Not built: printing the slip, re-opening a closed day (Q-8), per-payment-mode totals on screen.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| the day-end figures › has no figures when the day has not been started | `session:null`, expected 0, no sales or expenses | pass | 2026-11-13 |
| the day-end figures › works out the cash that should be in the drawer | Opening ₹2,000; cash ₹1,499; UPI bill ignored; split bill counts its ₹500 cash; expense ₹50 → cashIn ₹1,999, expected ₹3,949; 3 bills | pass | 2026-11-13 |
| the day-end figures › counts cash refunds going out of the drawer | Opening ₹1,000, cash sale ₹1,499, then a −₹500 cash payment → cashIn ₹1,499, cashOut ₹500, expected ₹1,999 | pass | 2026-11-13 |
| the day-end figures › leaves cancelled bills out | Cancelled bill: cashIn 0, no sales, expected 0 | pass | 2026-11-13 |
| expenses › needs an open day, an amount and a reason | Before the day: "no open day"; 0, −5, 10.5: "amount"; blank note: "what it was for"; note trimmed | pass | 2026-11-13 |
| closing the day › records expected, counted and the difference, locks the day and backs up the database | ₹100 short stored (`diff −10000`); session `closed`; no more bills/expenses/close; backup ok; a new day can start | pass | 2026-11-13 |
| closing the day › works out the expected cash itself, and reports an overage as a positive difference | Opening ₹500, counted ₹600 → expected ₹500, diff +₹100 | pass | 2026-11-13 |
| closing the day › refuses a missing or invalid count | −1, 1.5, NaN refused; day stays open | pass | 2026-11-13 |
| closing the day › is not for store staff | Store staff "not allowed" on summary and close | pass | 2026-11-13 |
| the backup made when closing › is a complete, readable copy of the database, recorded in the backups table | Backup file passes `integrity_check`, holds the bill and the **closed** day, one row in `backups` | pass | 2026-11-13 |
| the backup made when closing › closes the day anyway when the backup cannot be made, and says so | No folder → `backup:{ok:false,error:"No backup folder is set."}`, day closed, `backup_failed` audit | pass | 2026-11-13 |
| the backup made when closing › does not overwrite an earlier backup from the same day, and keeps only the newest 30 | 3 closes the same day → 3 files; after 36 closes exactly 30 rows and 30 files | pass | 2026-11-13 |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-12 | Day end screen: figures, expenses, counted cash, close day with confirmation | n/a (no git) |
| 2026-11-12 | Close day runs a real database backup (`backup.ts`); backup name collision in the same second fixed | n/a |
