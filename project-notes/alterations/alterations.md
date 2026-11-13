# Alterations

> **Status: pending.** Not started. **Blocked on Open question Q-1** (GST rate and SAC code for alteration charges) before go-live.

## 1. Summary (planned)

- **What it will do:** track tailoring jobs from a bill (or a customer's own garment): *received → with tailor → ready → delivered* (or cancelled). Each job gets a number `ALT-0001`, a **tailor tag** for the garment, a **slip** for the customer, a ready-by date, a tailor, and an optional charge (add to the bill, collect at pickup, or free). "Ready" sends a WhatsApp message to the customer.
- **Screens:** `Alterations` list (menu item exists, hidden), an *Alteration* dialog on the Billing cart line (the ✂ button), *New alteration*, *Tailor tag*, *Collect alteration charge*.
- **Who can use it:** Owner, Manager, Cashier, Store staff (the menu already lists all four).
- **Code (to create):** `Alterations.tsx`, `services/alterations.ts`, shared shapes, tests.

## 2. What already exists for it

- Tables `tailors` (name, mobile, kind In-house/Outside, `rate_per_job`), `alterations` (`no`, `bill_id`, `customer_id`, `item`, `work`, `notes`, `tailor_id`, `due_at`, `charge`, `charge_mode`, `paid`, `pay_bill_id`, `status`), `alteration_history` (status changes with who/when).
- A service category **"Alteration service"** (`is_service=1`, 18%, HSN "SAC (ask CA)") and a rule that service items are never offered for sale or stocked.

## 3. Planned rules

- Work types: Length, Waist, Sleeves, Fitting, Hem, Buttons, Other (at least one required). A customer (with mobile) is required: the tag and the ready message need it.
- Default ready-by: 2 days at 6 pm (setting).
- Charge paid at pickup creates its own bill when handed over (needs an open day).
- Late = past ready-by and not ready/delivered.
- Tailor payments: jobs delivered × the tailor's `rate_per_job` (for Reports).
- Cancelling the original bill cancels its undelivered jobs.
- **Review item:** store the GST rate on the job at creation (the prototype changed it by editing the category).

## 4. Open questions

- **Q-1** GST rate and SAC code for alteration charges.
- Print the tag on the label printer (50 × 50 mm) or the receipt printer? (Q-4)

## 5. Done when

Service + screens + tests (status flow, charge modes, late flag, tag/slip text), README status **done**, Billing cart line gets the ✂ button, this page completed.

## Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-13 | Placeholder note created | n/a (no git) |
