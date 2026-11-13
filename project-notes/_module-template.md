# <Module name>

> Copy this file to `project-notes/<module>/<module>.md` when you start a module. Keep every section. Plain English, real values, no "TBD" once the module is done.

## 1. Summary

- **What it does:** one paragraph.
- **Screens:** names (file path of each).
- **Who can use it:** roles.
- **Status:** pending / in progress / done (date).
- **Code:** screen file(s), service file(s), shared types, tests (full paths).

## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| (every button, field, tab, shortcut key) | | |

## 3. Flows

One block per user action:

**<Action>** → what the app does, step by step → function called (`window.api.x.y` → channel → service function) → tables read / written.

## 4. APIs

One block per `window.api` function:

### `window.api.<area>.<fn>(args)` · channel `<channel>`

- **Called from:** screen and button · **Allowed roles:**
- **Request** (JSON) and a field table: field | type | required | validation
- **Success response** (JSON: this is the `data`; the wrapper is `{ ok:true, data }`)
- **Errors:** when | message shown (`{ ok:false, error:"…" }`)
- **Tables read / written · side effects** (print, drawer, audit log)
- **Steps inside the function**
- **Example** with real values

## 5. Database

Tables and columns used, and the real queries.

## 6. Business rules

Limits, validations, approvals, GST and rounding.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
