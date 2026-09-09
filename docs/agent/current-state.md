# Current State

TrackFood has an initial functional static PWA implementation.

Implemented:

- Vue 3, TypeScript, Vite, Vue Router hash routing and Pinia.
- Dexie/IndexedDB persistence for foods, diary entries, weight entries and settings.
- Domain layer for serving-unit conversion, nutrition scaling, weekly calorie budgets, BMR/TDEE estimates, weight trends, OCR parsing, Open Food Facts normalization and backups.
- Food creation and edit flow with independent nutrition basis and human serving units.
- Fast food logging with recent/frequent foods, Brazilian decimal, fraction and mixed-number input parsing, and immutable diary nutrition snapshots.
- Quick calories.
- Dashboard with daily calories, weekly budget, macros, meals and weight summary.
- Barcode scan screen using native `BarcodeDetector` first and ZXing fallback.
- Optional Open Food Facts lookup routed through editable import review.
- Nutrition-label OCR supports photo/pasted-text review plus a bounded live-camera loop with one reused Tesseract worker, frozen-frame rejection, multi-frame consensus, automatic stopping, and field-by-field confirmed/collecting/conflict/missing progress in the label screen.
- Live OCR lifecycle and UI regression coverage includes cancellation with partial results preserved, contradictory readings that remain unresolved, worker/camera cleanup, bounded sessions, and automatic stopping after stable consensus.
- Weight logging and simple progress charts.
- Settings for goals, week start, locale, theme, profile, TDEE estimate and reminders.
- JSON export/import and local data erase.
- PWA manifest/service worker configuration and GitHub Pages workflow.
- Vitest regression/domain/component tests.
- The pre-live-OCR baseline passed ESLint, typecheck, tests and the production build with the current lockfile. The current OCR UI/test additions still need a local or CI validation rerun.
- IndexedDB writes are normalized to plain JSON at the Dexie boundary to avoid storing Vue reactive proxies.
- `Makefile` supports common local targets. `make push` is only `git add .`, `git commit`, and `git push origin HEAD`; `make deploy` validates/builds and publishes `dist` to `gh-pages`.

The repo was initially empty except for `LICENSE`; the `docs/agent` files were created during initial implementation.
