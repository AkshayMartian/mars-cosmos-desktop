# Customers

## 1. Summary

- **What it does:** the customer book. Each customer has a mobile (the key), name, birthday, anniversary, **usual sizes (shirt, trouser, shoe: what the customer wears, plain text)**, notes, GSTIN for business bills, and **consent** (WhatsApp bill, offers and birthday wishes) recorded with the date and the staff member who asked. The screen also lists **today's birthdays and anniversaries** with a "Send wish on WhatsApp" link, and each customer's visits, total spent and recent bills. Billing finds customers by mobile.
- **Screen:** `Customers` (`src/renderer/screens/Customers.tsx`) with the **Add / Edit customer** dialog and a Delete confirmation.
- **Who can use it:** Owner, Manager, Cashier. Delete: Owner, Manager only. Store staff: no access.
- **Status:** **done** (2026-11-12). Not included: Coins column and credit-note balance, "alterations open" chip (those modules are pending).
- **Code:** screen `src/renderer/screens/Customers.tsx` · service `src/main/services/customers.ts` · date helpers `src/shared/dates.ts` · shapes `src/shared/customers.ts` · migration 2 in `src/main/db/schema.ts` · tests `src/main/services/customers.test.ts`.

## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| **+ Add customer** | button | Opens the Add customer dialog |
| *Today's birthdays and anniversaries (n)* | panel (only when n > 0) | One row per person: name · Birthday/Anniversary · mobile |
| **Send wish on WhatsApp** | link button | Opens WhatsApp with "Dear <name>, happy birthday/anniversary from all of us at <shop>! Visit us this week for a special surprise." Only if the customer agreed to offers; otherwise a disabled **No consent to send wishes** |
| *Search name or mobile* | text | Filters the list |
| Customer table | table | Name, Mobile, Visits, Spent. Click a row to open the profile |
| Profile panel | panel | Name, mobile, Birthday, Anniversary, Sizes (e.g. "Shirt 40 · Trouser 32 · Shoe 9"), WhatsApp bill Yes/No, Offers Yes/No, Visits, Spent, consent line ("Consent recorded 12 Nov 2026 by Cashier"), Note, GSTIN, Recent bills (last 6) |
| **Edit** | button | Opens the dialog filled in |
| **Delete** | button (owner/manager) | Confirm "Delete this customer?" → **Keep** / **Delete** |
| **Add / Edit customer dialog** | dialog | *Mobile \**, *Name \**, *Birthday (DD-MM)*, *Anniversary (DD-MM)*, **size boxes (one "<Category> size" per category)**, *Notes*, *GSTIN (business bills only)*, consent tick-boxes *Send my bill on WhatsApp* and *Send me offers and birthday wishes*, red error line, **Cancel**, **Save customer** |

**Usual sizes (removed from the dialog on 2026-11-19):** the Add / Edit customer dialog no longer has the sizes heading or the Shirt / Trouser / Shoe boxes. Sizes already saved are kept (editing a customer does not clear them) and still show on the profile and the Billing customer card; the data layer is unchanged.

## 3. Flows

**Open the screen** → `customers.list('')` (table), `customers.today()` (birthday panel), `app.info()` (shop name for the wish text).

**Open a profile** → `customers.get(id)` → profile with sizes and recent bills.

**Add** → fill the dialog → **Save customer** → `customers.save({...no id})` → validate → one transaction: insert customer with the sizes as JSON in `customers.sizes` (+ consent date/staff if any box ticked) → audit `customer_create` → the new profile opens.

**Edit** → same dialog → `customers.save({id, ...})` → update; consent date/staff are renewed **only if a consent box changed**; sizes JSON replaced (a blank box simply stays empty) → audit `customer_edit`.

**Delete** → confirm → `customers.remove(id)` → one transaction: personal data wiped (mobile NULL, name "Deleted customer", dates, notes, GSTIN, consents cleared, `sizes` set to NULL, `deleted_at` set) → audit `customer_delete`. **Bills are kept** and show "Deleted customer". The mobile number can be reused.

**Wish** → panel → link `https://wa.me/91<mobile>?text=…` → opens in the browser; staff press Send.

## 4. APIs

IPC result `{ ok:true, data }` / `{ ok:false, error:"message" }`. Roles: **owner, manager, cashier** unless noted (others: `You are not allowed to do this.`).

### `window.api.customers.list(q)` · `customers:list`
- **Request:** `{ "q":"rahul" }` · **Response:** `[{ "id":"7d42…","name":"Rahul Shah","mobile":"9876500045","visits":2,"spent":299800 }]` sorted by name.
- **Tables read:** `customers`, `bills` (visits = completed `sale` bills; spent = sum of `grand` of completed bills).
- **Query:** `SELECT c.id,c.name,c.mobile,(SELECT COUNT(*) FROM bills b WHERE b.customer_id=c.id AND b.type='sale' AND b.status='completed') AS visits,(SELECT COALESCE(SUM(b.grand),0) FROM bills b WHERE b.customer_id=c.id AND b.status='completed') AS spent FROM customers c WHERE c.deleted_at IS NULL AND c.mobile IS NOT NULL AND (@q='' OR c.name LIKE @like OR c.mobile LIKE @like) ORDER BY c.name`

### `window.api.customers.get(id)` · `customers:get`
- **Response:**
```json
{ "id":"7d42…","name":"Rahul Shah","mobile":"9876500045","birthday":"08-21","anniversary":"12-04",
  "sizes":{ "shirt":"40","trouser":"32","shoe":"9" },
  "notes":"Likes slim fit","gstin":"","waConsent":true,"offersConsent":false,
  "consentAt":"2026-11-12T11:20:00.000Z","consentBy":"Cashier","visits":2,"spent":299800,
  "recentBills":[{ "no":"C1/2026-27/0002","at":"2026-11-12T12:01:00.000Z","grand":149900 }] }
```
- **Errors:** `Customer not found.` (also for a deleted customer). **Tables read:** `customers, staff, bills`.

### `window.api.customers.save(input)` · `customers:save`
- **Called from:** Add / Edit customer → Save customer.
- **Request:**
```json
{ "id":"7d42…", "mobile":"98765 00045","name":"Rahul Shah","birthday":"21-08","anniversary":"04-12",
  "sizes":{ "shirt":"40","trouser":"32","shoe":"9" },"notes":"Likes slim fit","gstin":"24AAAAA1111A1Z5",
  "waConsent":true,"offersConsent":false }
```

| Field | Type | Required | Validation |
|---|---|---|---|
| id | string | only when editing | existing, not deleted |
| mobile | string | yes | non-digits removed; exactly 10 digits; not used by another customer |
| name | string | yes | not blank |
| birthday, anniversary | string `DD-MM` | no | blank, or a real date (`31-02`, `32-01`, `10-13`, text are refused; `29-02` allowed); also accepts `/` or `.` |
| sizes | `{ shirt, trouser, shoe }` (strings) | yes | plain text; trimmed; each may be empty; ≤ 20 characters each |
| notes | string | no | trimmed |
| gstin | string | no | upper-cased; format: state code 01–38 + 5 letters + 4 digits + letter + 1–9/A–Z + `Z` + character |
| waConsent, offersConsent | boolean | yes | |

- **Response:** the profile (as `get`). Birthday is returned as `MM-DD` (`08-21`).

| When | Message |
|---|---|
| mobile not 10 digits | `Mobile must be 10 digits.` |
| name blank | `Name is required.` |
| bad birthday | `Birthday must be a real date like 21-08 (day-month).` |
| bad anniversary | `Anniversary must be a real date like 04-12 (day-month).` |
| bad GSTIN | `GSTIN is not valid. It has 15 characters, like 24ABCDE1234F1Z5.` |
| mobile used by another customer | `A customer with this mobile already exists.` |
| a size over 20 characters | `A size is too long (20 characters at most).` |
| editing a missing/deleted id | `Customer not found.` |
| store staff | `You are not allowed to do this.` |

- **Tables written:** `customers` (incl. the `sizes` JSON), `audit_log` (`customer_create` / `customer_edit`).
- **Consent rule:** on create, `consent_at` / `consent_by` are set when any box is ticked; on edit they are set only when a box **changed**.
- **Example:** cashier saves Rahul with WhatsApp ticked, shirt 40, trouser 32 and shoe 9 → `customers.sizes` = `{"shirt":"40","trouser":"32","shoe":"9"}` and `consentBy:"Cashier"`; a manager later renames him without touching the boxes → consent date and "Cashier" stay.

### `window.api.customers.remove(id)` · `customers:delete`
- **Roles:** owner, manager · **Request:** `{ "id":"7d42…" }` · **Response:** `null` · **Errors:** `Customer not found.` · `You are not allowed to do this.`
- **Tables written:** `customers` (anonymised, `sizes` NULL), `customer_sizes` (any old rows deleted), `audit_log` (`customer_delete`); bills untouched.

### `window.api.customers.today()` · `customers:today`
- **Response:** `[{ "id":"…","name":"Neha Patel","mobile":"9712300031","kind":"anniversary","offersConsent":false },{ "id":"…","name":"Rahul Shah","mobile":"9876500045","kind":"birthday","offersConsent":true }]` (a person with both gets two rows) · **Tables read:** `customers` where `birthday` or `anniversary` = today's `MM-DD`.

*(Find by mobile and the quick "Add customer" used on the Billing screen are `customer:find` / `customer:create`; both return the sizes, see [Billing](../billing/billing.md). The earlier `customers:sizeFields` call (one box per category) was removed on 2026-11-13.)*

## 5. Database

Read/written: `customers`, `audit_log`; read: `bills`, `staff`. (`customer_sizes` is no longer used.)
```sql
INSERT INTO customers (mobile,name,birthday,anniversary,notes,gstin,wa_consent,offers_consent,id,consent_at,consent_by) VALUES (…);
UPDATE customers SET mobile=?,name=?,birthday=?,anniversary=?,notes=?,gstin=?,wa_consent=?,offers_consent=? WHERE id=?;
-- sizes is the JSON text {"shirt":"40","trouser":"32","shoe":"9"} written with the customer row above
SELECT sizes FROM customers WHERE id=?;
-- delete = anonymise
UPDATE customers SET mobile=NULL,name='Deleted customer',birthday=NULL,anniversary=NULL,size_shirt=NULL,size_trouser=NULL,size_shoe=NULL,
  notes=NULL,gstin=NULL,wa_consent=0,offers_consent=0,consent_at=NULL,consent_by=NULL,deleted_at=? WHERE id=? AND deleted_at IS NULL;
```
Schema: see README section 7. `customers.sizes` (migration 4) holds the JSON. The old `size_shirt` / `size_trouser` / `size_shoe` columns and the table `customer_sizes` (migration 2) are **kept but unused**.

## 6. Business rules

- **Mobile is the identity**: 10 digits, unique (a deleted customer frees the number).
- **Consent** is recorded with date and the staff member who asked. Wishes (promotional) are offered **only** for customers who ticked *offers and birthday wishes* (D-21). Bill on WhatsApp needs the customer's mobile; ticking WhatsApp consent is recorded, the link itself is not blocked.
- **Birthday/anniversary** are typed `DD-MM`, stored `MM-DD`, no year; matched against today. On screen the boxes format as you type (digits only, the dash comes by itself, "5" becomes "05"), and a red hint appears if the finished date does not exist (e.g. 31-02).
- **Usual sizes are three fixed plain-text boxes** (shirt, trouser, shoe), stored as JSON in `customers.sizes` (D-27, which replaces the per-category sizes of D-19). They are what the customer wears, not products: no search, no price, no stock. Reading is forgiving: empty, broken or wrongly typed JSON shows blank boxes. Migration 4 moved earlier data: the per-category sizes of Shirts/Trousers/Shoes (or, for older rows, the three old columns) became the JSON.
- **GSTIN**: format and state code are checked, the final check character is not (D-22). Only needed for business customers.
- **Delete anonymises**: old bills stay and show "Deleted customer"; personal data is wiped.
- **Visits / spent** are computed from completed bills (returns will subtract once Returns exists).
- Not built: alterations chip. The profile shows the coin balance and the unused credit note balance.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| day-month dates › turns typed DD-MM into stored MM-DD and back | `21-08` → `08-21`; ` 4/12 ` → `12-04`; blank → ''; `29-02` kept; back-conversion works | pass | 2026-11-13 |
| day-month dates › refuses dates that do not exist | `31-02, 32-01, 00-05, 10-13, aug 21, 2108, 21-8-1990, 31-04` refused | pass | 2026-11-13 |
| adding and editing a customer › saves every detail and shows it back | All fields, sizes shirt 40 / trouser 32 / shoe 9, GSTIN upper-cased, consent by "Cashier"; found by billing's lookup | pass | 2026-11-13 |
| adding and editing a customer › checks the form | Short mobile, blank name, bad dates, bad GSTIN, unknown state code, duplicate mobile all refused | pass | 2026-11-13 |
| adding and editing a customer › keeps the first consent record on an edit, and renews it only when consent changes | Rename keeps consent date and "Cashier"; ticking offers sets "Manager" | pass | 2026-11-13 |
| adding and editing a customer › records no consent when none is given, and lets the mobile change if it is not taken | No consent → null date/staff; taking another customer's number refused; a free number accepted | pass | 2026-11-13 |
| adding and editing a customer › is for owner, manager and cashier, not store staff | Store staff "not allowed" on save and list | pass | 2026-11-13 |
| the customer's usual sizes › keeps the three sizes as JSON in customers.sizes and shows them back | Saves 40 / 32 / 9; the column holds `{shirt:'40',trouser:'32',shoe:'9'}`; text "Shirt 40 · Trouser 32 · Shoe 9" | pass | 2026-11-13 |
| the customer's usual sizes › takes plain text, trims it, and lets any box stay empty | ` L ` → `L`, `UK 9` kept, blank box stays empty; text "Shirt L · Shoe UK 9"; all-empty still stores all three keys | pass | 2026-11-13 |
| the customer's usual sizes › changes and clears sizes when the customer is edited | Edit 42 / 32 / empty is saved and read back | pass | 2026-11-13 |
| the customer's usual sizes › refuses a size that is far too long, and saves nothing | 21 characters → "too long", no customer saved; 20 is accepted | pass | 2026-11-13 |
| the customer's usual sizes › reads stored sizes safely | `null`, `''`, broken JSON and numbers-instead-of-text give blank boxes; stray keys ignored | pass | 2026-11-13 |
| the customer's usual sizes › gives Billing the sizes when it finds the customer by mobile, and blank sizes for a quick-added one | `customer:find` returns the three sizes; a customer made in Billing has blank sizes | pass | 2026-11-13 |
| the customer's usual sizes › forgets the sizes when the customer is deleted | `customers.sizes` is NULL after delete | pass | 2026-11-13 |
| upgrading an existing database › moves the old fixed columns (version 1 database) into the JSON sizes | Shirt 40, trouser 32, shoe 9 all kept (the shoe size is no longer lost); an empty customer gets three empty keys | pass | 2026-11-13 |
| upgrading an existing database › moves the per-category sizes of a version 3 database into the JSON sizes | Shirts L, Trousers 34, Shoes 10 → `{shirt:'L',trouser:'34',shoe:'10'}`; the old `customer_sizes` table is left as it was | pass | 2026-11-13 |
| visits and spend › counts completed bills and adds up what the customer spent | 2 bills → visits 2, spent ₹2,998; newest bill first | pass | 2026-11-13 |
| deleting a customer › removes the person but keeps their old bills, and only for owner or manager | Cashier refused; manager deletes; list empty; bill still there as "Deleted customer"; number reusable | pass | 2026-11-13 |
| birthdays and anniversaries today › lists today's celebrations and who agreed to wishes | Two rows (anniversary, birthday) with their consent flags; a customer with another date is absent | pass | 2026-11-13 |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-12 | Customers screen: list, search, profile, add/edit dialog, delete, birthdays panel with WhatsApp wish | n/a (no git) |
| 2026-11-12 | Sizes made dynamic per category; migration 2 (`customer_sizes`) | n/a |
| 2026-11-13 | **Usual sizes are now three fixed plain-text boxes** (shirt, trouser, shoe) stored as JSON in `customers.sizes` (schema v4); heading "Customer's usual sizes (optional)" with a hint and placeholders; per-category boxes and `customers:sizeFields` removed (D-27); Billing customer card shows the sizes and finds the customer as soon as 10 digits are typed | n/a |
| 2026-11-16 | Profile shows coins and unused credit note balance | uncommitted |
