# Mars Cosmos

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

## Activation (licence)

A new PC opens on "Activate this PC"; see [project-notes/licence/licence.md](project-notes/licence/licence.md). For development set `MARS_SKIP_LICENCE=1` to skip it. To make a code for a test PC: copy the request code from the Activate screen (No internet tab), then `npm run licence -- issue <request code> --shop "Test" --days 365` and paste the response code back. The development private key is in `scripts/.keys/` (git-ignored); make a production pair with `npm run licence -- keygen` before go-live.
