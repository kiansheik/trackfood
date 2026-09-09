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
- Cropped linear labels can recover a missing 100 g/100 ml heading when repeated per-serving arithmetic independently validates the same interpretation across multiple nutrients; `Valor energético` / `Energia` are explicitly typed as kcal semantics.
- Live label scanning decouples camera capture from expensive serial OCR inference: the camera samples about every 450 ms into a bounded three-frame latest-biased queue while one PP-OCR inference runs at a time. Stale queued captures are replaced rather than allowed to build an unbounded backlog.
- The live camera UI is deliberately calm: no capture flashing or animated progress frame. Red/stop means hold still briefly; solid green means a usable view was captured or the known label is tracking successfully.
- A subtle outer guide helps initial placement. PP-OCR nutrition polygons anchor a second live quadrilateral representing the actual region TrackFood sees; lightweight sparse optical-flow / affine tracking follows it between slow OCR passes and the tracked region becomes a generous adaptive OCR crop.
- The camera HUD keeps 11 field-state indicators and names the fields still missing or conflicting, while pause/continue/start-over/use-current-result preserve user control.
- Multi-frame consensus keeps plausible contradictions separate and can revoke a previously confirmed value after a recent plausible contradiction.
- Constraint-aware numeric consensus now removes physically incompatible OCR candidates before voting. For 100 g solids it uses a conservative mass budget, sugar/carbohydrate and fat subset relationships, and kcal/energy-factor lower bounds; 100 ml liquids are not treated as 100 g without density.
- Constraints are recalculated from already-confirmed fields so the plausible range for unresolved values narrows during a scan. A field may settle from two matching observations only under strong independent context; a whole scan still needs at least three independent canonical observations.
- Clean high-quality fully consistent labels can now auto-stop after three OCR observations instead of always requiring a fourth, while lower-quality or genuinely conflicting scans remain conservative.
- Live OCR can be paused without discarding the composite, continued with existing evidence, started over, or accepted early. Partial and complete results both route through the normal editable food form for name, brand, barcode and final nutrition review.
- OCR methodology, regulatory assumptions, model choices, camera tracking, plausibility constraints and critique cycles are recorded in `docs/ocr-methodology.md` and linked from implementation comments.
- Live OCR regression coverage includes pause/partial handoff, plausible contradictions reflected in the HUD, impossible numeric outlier pruning (including a `9 g` vs `23400 g` case), three-frame clean auto-stop, in-flight cancellation, permission/worker cancellation, frozen frames, bounded capture queues and sessions, camera cleanup, one-at-a-time inference and region tracking.
- Weight logging and simple progress charts.
- Settings for goals, week start, locale, theme, profile, TDEE estimate and reminders.
- JSON export/import and local data erase.
- PWA manifest/service worker configuration and GitHub Pages workflow. Heavy Paddle/ONNX assets are lazy-loaded for scanner use instead of being forced into the normal PWA precache/install path.
- Vitest regression/domain/component tests.
- IndexedDB writes are normalized to plain JSON at the Dexie boundary to avoid storing Vue reactive proxies.
- `Makefile` supports common local targets. `make push` is only `git add .`, `git commit`, and `git push origin HEAD`; validation/build is reserved for `make deploy`.

The repo was initially empty except for `LICENSE`; the `docs/agent` files were created during initial implementation.
