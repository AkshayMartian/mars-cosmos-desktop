# MARS POS

Offline point-of-sale for clothing and accessory shops (Windows desktop).

```
npm install     # no compiler needed: better-sqlite3 ships Node-API prebuilds that work in Node and Electron
npm run dev     # run the app
npm test        # shared GST/bill maths
npm run typecheck
npm run build
```

Default PINs (development): Owner `1111`, Manager `2222`, Cashier `3333`, Store staff `4444`.
Forced PIN change at first login is switched off for now: set `FORCE_PIN_CHANGE = true` in `src/main/db/seed.ts` before go-live.

**Project notes (start here to review any module): [project-notes/README.md](project-notes/README.md).** Update them with every task.

Earlier design docs: [prototype review](docs/PROTOTYPE-REVIEW.md) · [architecture](docs/ARCHITECTURE.md) · [roadmap](docs/ROADMAP.md)
