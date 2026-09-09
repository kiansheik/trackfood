# Current State

TrackFood has an initial functional static PWA implementation.

Implemented:

- Vue 3, TypeScript, Vite, Vue Router hash routing and Pinia.
- Dexie/IndexedDB persistence for foods, diary entries, weight entries and settings.
- Domain layer for serving-unit conversion, nutrition scaling, weekly calorie budgets, BMR/TDEE estimates, weight trends, OCR parsing, Open Food Facts normalization and backups.
- Food creation and edit flow with independent nutrition basis, human serving units, optional brand and optional barcode registration.
- Every food editor can scan an EAN/UPC barcode with native `BarcodeDetector` first and ZXing fallback; duplicate local barcode registration is rejected so future scans resolve unambiguously.
- Fast food logging with recent/frequent foods, Brazilian decimal, fraction and mixed-number input parsing, and immutable diary nutrition snapshots.
- Quick calories.
- Dashboard with daily calories, weekly budget, macros, meals and weight summary.
- Barcode scan screen using native `BarcodeDetector` first and ZXing fallback. It checks locally saved foods before Open Food Facts, so a barcode registered during food creation bypasses label OCR on later scans.
- Optional Open Food Facts lookup routed through editable import review.
- Brazilian nutrition-label OCR uses PP-OCRv6-small as the primary in-browser recognizer, with Tesseract as a runtime/model failure fallback. Paddle polygons feed a geometry-aware parser that targets the ANVISA-required canonical 100 g/100 ml values and keeps legal linear/run-on labels as a separate text path.
- Live label scanning decouples camera capture from expensive serial OCR inference: the camera samples about every 450 ms into a bounded three-frame latest-biased queue while one PP-OCR inference runs at a time. Stale queued captures are replaced rather than allowed to build an unbounded backlog.
- The live camera HUD provides capture feedback for focus/light/glare/frozen views, a capture flash, an external field-completion frame, queue/processing status, 11 field-state indicators, and names of the fields still missing or conflicting.
- Live OCR can be paused without discarding the composite, continued with existing evidence, started over, or accepted early. Partial and complete results both route through the normal editable food form for name, brand, barcode and final nutrition review.
- Multi-frame consensus keeps contradictory values separate, can revoke a previously confirmed value after a recent contradiction, and automatically stops only when the canonical per-100 basis and all required nutrient fields reach stable repeated agreement.
- OCR methodology, regulatory assumptions, model choices, capture heuristics and critique cycles are recorded in `docs/ocr-methodology.md` and linked from implementation comments.
- Live OCR regression coverage includes pause/partial handoff, contradictions reflected in the HUD, automatic completion, in-flight cancellation, permission/worker cancellation, frozen frames, bounded capture queues and sessions, camera cleanup and one-at-a-time inference.
- Weight logging and simple progress charts.
- Settings for goals, week start, locale, theme, profile, TDEE estimate and reminders.
- JSON export/import and local data erase.
- PWA manifest/service worker configuration and GitHub Pages workflow. Heavy Paddle/ONNX assets are lazy-loaded for scanner use instead of being forced into the normal PWA precache/install path.
- Vitest regression/domain/component tests.
- IndexedDB writes are normalized to plain JSON at the Dexie boundary to avoid storing Vue reactive proxies.
- `Makefile` supports common local targets. `make push` is only `git add .`, `git commit`, and `git push origin HEAD`; validation/build is reserved for `make deploy`.

The repo was initially empty except for `LICENSE`; the `docs/agent` files were created during initial implementation.
