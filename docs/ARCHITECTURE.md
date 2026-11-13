# Architecture

```
┌──────────────── Electron app (one per shop PC) ────────────────┐
│ renderer (React + TS)   ──contextBridge──►  preload             │
│   screens/*                                   window.api.*      │
│                                                   │ ipcRenderer │
│ main process (Node)  ◄────────── ipcMain ─────────┘             │
│   ipc.ts → services/* → db (better-sqlite3, WAL)                │
│   later: print/ (ESC/POS, label), backup/, whatsapp (wa.me)     │
│                                                                 │
│ shared/ (pure TS, no Node/DOM): money, calc (GST), barcode,     │
│          types + role→menu map. Used by BOTH sides, unit-tested.│
└─────────────────────────────────────────────────────────────────┘
```

## Rules
- **Renderer never touches the DB or Node.** `contextIsolation` on, `nodeIntegration` off, sandbox on, CSP set. Every capability is an explicit IPC handler.
- **Every write is a service function in one SQLite transaction** (e.g. `bills.create` writes bill, lines, payments, stock moves, coin ledger, credit-note balance, audit row together or not at all).
- **The main process recomputes totals** with `shared/calc` — never trust totals sent from the UI.
- **Permissions are enforced in services**, not just by hiding menu items. Manager-approval returns the approver's id, which is stored on the record.
- **Money = integer paise. Time = UTC ISO text. Stock = sum of `stock_moves`.**
- **Migrations are append-only** (`src/main/db/schema.ts`, tracked with `PRAGMA user_version`).

## Layout
```
src/shared/     calc.ts money.ts barcode.ts types.ts (+ tests)
src/main/       index.ts ipc.ts  db/{index,schema,seed}.ts  services/{auth,pin,...}.ts
src/preload/    index.ts  (typed window.api)
src/renderer/   App.tsx  screens/*  styles.css
docs/           PROTOTYPE-REVIEW.md ARCHITECTURE.md ROADMAP.md
```
New domain = `services/<domain>.ts` + handlers in `ipc.ts` + typed wrapper in `preload` + screen in `renderer/screens`.

## Tech choices
| Concern | Choice | Why |
|---|---|---|
| Shell | Electron + electron-vite | silent print, cash drawer, file backups, offline |
| DB | better-sqlite3 | sync, fast, single file, easy backup |
| UI | React 18 + TS | matches prototype's state-driven screens |
| Tests | Vitest | shared maths is the highest-risk code |
| Packaging | electron-builder (NSIS) | one-click Windows installer |

## Backup
Daily on day-close and on demand: `VACUUM INTO '<folder>\mars-YYYY-MM-DD.db'`, keep last 30, warn in top bar after 48 h.
