# Alterations

> Open question **Q-1** (GST rate and SAC code for alteration charges) must be answered by the CA before go-live. The rate is a setting (default 18%) and each job keeps the rate it was made with.

## 1. Summary

- **What it does:** tracks tailoring jobs from a bill (or a customer's own garment): *received → with tailor → ready → delivered* (or cancelled with its bill). Each job gets a number `ALT-0001`, a **tailor tag** for the garment, a **slip** for the customer, a ready-by time, a tailor and an optional charge: **added to the bill**, **collected at pickup**, or free. Marking a job ready offers a **WhatsApp** message to the customer.
- **Screens:** `Alterations` (`src/renderer/screens/Alterations.tsx`): tiles, search, tabs, job table, dialogs *New alteration*, *Tailor tag*, *Tell the customer*, *Collect alteration charge*, *Tailors and rules*. In Billing (`Billing.tsx`): the **✂ Alteration** button on each cart line and its dialog; the receipt has **Print tailor tag**. Shared form `AlterationForm.tsx`.
- **Who can use it:** Owner, Manager, Cashier, Store staff. Store staff can move jobs and print tags but not take money (the cashier collects a charge) and cannot open Billing. Only Owner and Manager manage tailors and rules.
- **Status:** **done** (2026-11-13). Tag and slip print from the tag dialog (sticker or receipt printer as set in Settings → Alterations). Not included: the "to pay tailor" report (Reports module), cancelling a single job on its own.
- **Code:** screens above · services `src/main/services/alterations.ts` (+ `altcore.ts` helpers used by Billing, `billing.ts` `createBill`) · shapes and text `src/shared/alterations.ts` · tests `src/main/services/alterations.test.ts`.

## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| Tiles | display | Open jobs · Ready by today · Late · Waiting for pickup |
| *Job number, customer name or mobile* | text | Filters the list |
| Tabs Open / Received / With tailor / Ready / Late / Delivered | tabs | Filter by status (Late = past ready-by and not ready) |
| **+ New alteration** | button | Dialog: find customer by mobile (auto on the 10th digit), *Garment* (recent items of that customer, or "Customer's own garment" + description), work ticks, notes, tailor, ready-by, charge. **Save and print tag** |
| Next button | button | *Send to tailor* → *Mark ready* (then the WhatsApp dialog) → *Hand over*. When a charge is due it says **Collect and hand over** and asks *Paid by* |
| **Tag** | button | Shows the tailor tag and the customer slip |
| **WhatsApp** | button (Ready jobs) | Opens WhatsApp with the "ready" message; staff press Send |
| **Tailors and rules** | button (owner, manager) | Tailor table (add, make inactive), *Default ready in (days)*, *GST on alteration charge %*, *Print tag on* sticker or receipt printer |
| Billing cart line **✂ Alteration** | button | Needs the customer on the bill. Dialog: work, notes, tailor, ready-by, charge; if a charge: **Add to this bill** or **Collect at pickup**. **Remove alteration** |
| Billing totals | display | A charge added to the bill appears as an "Alteration charge" line with the job's GST |

## 3. Flows

**Job with a bill** → ✂ on a cart line → pay → `window.api.billing.create` (with `alterations`) → `createBill` → bill, lines (service line for a charge), jobs and history in one transaction → receipt shows the job number → *Print tailor tag* → `window.api.alterations.byBill`.

**Job from the screen** → `window.api.alterations.customer` → `garments` → `create` → `alt:create` → `createAlteration`.

**Move a job** → `window.api.alterations.advance(id)` → `alt:advance` → `advanceAlteration` → `alterations.status`, `alteration_history`, audit.

**Collect and hand over** → `window.api.alterations.deliver({id, payMode})` → `alt:deliver` → `deliverAlteration` → one transaction: new bill (service line, job's GST rate), job `paid=1`, `pay_bill_id`, status delivered.

## 4. APIs (all return `{ ok:true, data }` or `{ ok:false, error }`)

### `window.api.alterations.list(q)` · channel `alt:list`
- **Roles:** owner, manager, cashier, store. **Request:** `q` text (job no, customer name or mobile, item). **Response:** `{ jobs: AltJobDto[], kpis: { open, dueToday, late, waiting } }`, earliest ready-by first, max 500. `AltJobDto` has `no, billNo, customerName, customerMobile, item, work[], notes, tailorName, dueAt, charge, chargeMode ('free'|'bill'|'pickup'), paid, gstRate, status, late`.
- **Tables read:** `alterations`, `customers`, `tailors`, `bills`.

### `window.api.alterations.byBill(billId)` · channel `alt:byBill`
- **Roles:** same. **Response:** the jobs made with that bill (used for the tags after billing).

### `window.api.alterations.context()` · channel `alt:context`
- **Roles:** same. **Response:** `{ tailors: TailorDto[], cfg: { dueDays, rate, tagPrinter }, canManage, canCollect, shop: { name, phone } }`.

### `window.api.alterations.customer(mobile)` · channel `alt:customer`
- **Roles:** same (store staff cannot use the Customers calls). **Response:** `{ id, name, mobile } | null`. **Error:** "Enter a 10-digit mobile number."

### `window.api.alterations.customerSearch(q)` · channel `alt:customerSearch`
- **Roles:** same as `customer` (owner, manager, cashier, store). **Request:** `{ "q":"rah" }` (every word must match the name or part of the mobile; blank = everyone) · **Response:** up to 100 `{ id, name, mobile }`, by name. **Tables read:** `customers` (not deleted, with a mobile). Used by the one customer box on the New alteration dialog (type a mobile or a name; the list scrolls).

### `window.api.alterations.garments(customerId)` · channel `alt:garments`
- **Response:** the customer's last 12 sold items `[{ key, billId, variantId, label }]` (service lines excluded).

### `window.api.alterations.create(input)` · channel `alt:create`
- **Request:**

| field | type | required | validation |
|---|---|---|---|
| customerId | string | yes | an existing customer |
| billId, variantId | string or null | no | both set when the garment is from a bill of this customer |
| ownItem | string | if no variantId | not empty |
| work | string[] | yes | at least one of Length, Waist, Sleeves, Fitting, Hem, Buttons, Other |
| notes | string | no | |
| tailorId | string | yes | an active tailor |
| dueAt | ISO date-time | yes | valid date |
| charge | paise | yes | whole rupees, 0 or more; above 0 = collected at pickup |

- **Response:** the new `AltJobDto`. **Errors:** "Find the customer first…", "Tick at least one type of work.", "Choose a tailor.", "Choose the ready-by date and time.", "The charge cannot be negative.", "Enter the charge in whole rupees.", "Type what the garment is."
- **Writes:** `alterations`, `alteration_history`, `audit_log` (`alteration_new`).

### `window.api.alterations.advance(id)` · channel `alt:advance`
- **Response:** the job one step on. **Errors:** "ALT-0001 is already delivered." / "is cancelled." · "Collect the ALT-0001 charge first." (a charge is still due: use *deliver*).

### `window.api.alterations.deliver(input)` · channel `alt:deliver`
- **Roles:** owner, manager, cashier. **Request:** `{ id, payMode: 'cash'|'upi'|'card' }`. **Response:** `{ job, billId|null }`.
- **Errors:** "ALT-0001 is not ready for pickup yet." · "Start the day first: enter the opening cash." · "You are not allowed to do this." (store staff).
- A job with no charge due is just handed over (`billId` null). A charge due makes a bill: one service line, the job's `gst_rate`, paid in the chosen mode.

### `window.api.alterations.saveTailor(input)` · channel `alt:saveTailor`
- **Roles:** owner, manager. **Request:** `{ id?, name, mobile, kind: 'In-house'|'Outside', ratePerJob (paise), active }`. **Response:** the tailor list.
- **Errors:** "Type the tailor name." · "This tailor still has open jobs…" (when making inactive).

### `window.api.alterations.saveConfig(cfg)` · channel `alt:saveConfig`
- **Roles:** owner, manager. **Request:** `{ dueDays 0-60, rate 0-28, tagPrinter 'sticker'|'receipt' }`. Stored in `settings` key `alterations`. Audit `settings_change`.

### On `window.api.billing.create`
`input.alterations: [{ variantId, work, notes, tailorId, dueAt, charge, mode: 'bill'|'pickup' }]`, one per item on the bill; needs the customer. `mode 'bill'` with a charge adds an "Alteration charge" line (GST % = the rule at that time, stored on the job). The bill and its jobs are saved together or not at all.

## 5. Database

- `alterations` (`no` ALT-0001…, `bill_id`, `customer_id`, `variant_id`, `item`, `work` "Length, Sleeves", `notes`, `tailor_id`, `due_at`, `charge`, `charge_mode`, `paid`, `pay_bill_id`, `status`, `gst_rate` (**migration 5**)), `alteration_history` (every status change with who and when), `tailors`, `settings.alterations`.
- The charge sits on a bill as a service item: product "Alteration charge" / variant barcode `ALT` in the "Alteration service" category (`is_service=1`), created on first use. It is never sold, searched, stocked or returned.

## 6. Business rules

- A customer with a mobile is required (tag and ready message). One job per item on a bill. Work, tailor (active) and ready-by are required; charges are whole rupees.
- Default ready-by: today + `dueDays` (2) at 6 pm. **Late** = past ready-by and not ready, delivered or cancelled.
- A charge collected at pickup makes its own bill at hand-over (needs an open day); a charge added to the bill is paid with it.
- **Cancelling the bill** cancels jobs still *received*; once a job is with the tailor, ready or delivered the bill cannot be cancelled. A charge line is a service: cancel puts no stock back for it. The charge line cannot be returned.
- GST of the charge: the `alterations.rate` rule (default 18%), kept on each job. Confirm rate and SAC code with the CA (Q-1).
- Tailor payments for Reports: delivered jobs × `tailors.rate_per_job`.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| Free job with a bill | `ALT-0001`, linked, on the receipt | pass | 2026-11-13 |
| Charge added to the bill | 18% GST line, no stock moved, job paid | pass | 2026-11-13 |
| Charge at pickup | off the bill, job unpaid | pass | 2026-11-13 |
| Validation (customer, work, tailor, item, whole rupees) | refused, nothing half-saved | pass | 2026-11-13 |
| GST rate kept on the job | old job 18%, new job 12% after a rule change | pass | 2026-11-13 |
| Status flow and history | four history rows | pass | 2026-11-13 |
| Hand over with a charge due | refused until collected; bill made; Day end cash up | pass | 2026-11-13 |
| Hand over not ready / free job / no open day | refused / no bill / refused and unchanged | pass | 2026-11-13 |
| Late flag and tiles; search | late counted, ready never late; search by no, name, mobile, item | pass | 2026-11-13 |
| Job from the screen (own garment, old bill item) and validation | created / refused | pass | 2026-11-13 |
| Store staff limits | can work jobs, cannot take money, manage tailors or bill | pass | 2026-11-13 |
| Tailors and rules | add, protect open jobs, inactive not selectable, validation, roles | pass | 2026-11-13 |
| Cancel bill / return with alterations | jobs cancelled and stock right; refused once with tailor; charge not returnable | pass | 2026-11-13 |
| Tag, slip, ready message text | job, customer, work, ready-by, charge at pickup | pass | 2026-11-13 |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-13 | Placeholder note created | n/a (no git) |
| 2026-11-13 | Alterations screen, Billing ✂ button, jobs with bills, collect and hand over, tailors and rules, migration 5 (`gst_rate`), tests | uncommitted |

## 2026-11-23: one customer box on New alteration

The New alteration dialog has the same single box as Billing (`src/renderer/CustomerBox.tsx`): type a 10-digit mobile and the customer loads by itself, or type a name / part of a number and a scrolling list appears (`alterations.customerSearch`, open to store staff too). Enter or Find on an empty box does nothing.
