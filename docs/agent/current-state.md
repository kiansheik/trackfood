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
- The active scanner is now deliberate tap-to-capture rather than a streaming collector. Opening the camera starts only the preview, model initialization and lightweight region tracker; no preview frame becomes nutrition evidence until the user taps the viewport.
- The entire viewport is the shutter when ready. It visibly dims and disables while one photo is in PP-OCR, so another observation cannot be added until the current one has finished processing.
- A tapped frame passes the existing capture-quality gate before OCR. Extreme blur/light failures and effectively identical frozen frames are rejected before they can enter consensus; accepted/rejected counts are shown separately.
- The camera no longer builds a background snapshot queue for the product flow. Deliberate accepted photos are processed one at a time, which makes the human choice of angle/focus part of evidence collection instead of treating arbitrary stream frames as independent observations.
- A subtle outer guide helps initial placement. PP-OCR nutrition polygons anchor a second live quadrilateral representing the actual region TrackFood sees; lightweight sparse optical-flow / affine tracking follows it between deliberate photos and the tracked region becomes a generous adaptive OCR crop.
- The camera HUD keeps 11 field-state indicators and names the fields still missing or conflicting, while pause/resume/start-over/review-current-result preserve user control.
- When exactly one required field remains unresolved after the rest of the label is confirmed, the scanner explicitly recommends carrying the composite into the ordinary food editor and typing that field manually instead of spending another expensive OCR pass.
- Multi-frame consensus keeps plausible contradictions separate and can revoke a previously confirmed value after a recent plausible contradiction.
- Constraint-aware numeric consensus removes physically incompatible OCR candidates before voting. For 100 g solids it uses a conservative mass budget, sugar/carbohydrate and fat subset relationships, and kcal/energy-factor lower bounds; 100 ml liquids are not treated as 100 g without density.
- Constraints are recalculated from already-confirmed fields so the plausible range for unresolved values narrows during a scan. A field may settle from two matching observations only under strong independent context; a whole scan still needs at least three independent canonical observations.
- Clean high-quality fully consistent labels can auto-complete after three deliberate OCR photos, while lower-quality or genuinely conflicting scans remain conservative.
- OCR can be paused without discarding the composite, resumed with existing evidence, started over, or accepted early. Partial and complete results both route through the normal editable food form for name, brand, barcode and final nutrition review.
- OCR methodology, regulatory assumptions, model choices, camera tracking, plausibility constraints and critique cycles are recorded in `docs/ocr-methodology.md`. The current tap-to-capture flow supersedes older notes there describing the bounded automatic capture queue.
- Regression coverage includes no-evidence-before-tap, shutter disable during in-flight OCR, rejection-before-consensus for bad manual frames, duplicate-frame rejection, pause/partial handoff, plausible contradictions reflected in the HUD, manual-finish recommendation for one unresolved field, impossible numeric outlier pruning (including a `9 g` vs `23400 g` case), three-photo clean auto-completion, permission/worker cancellation, camera cleanup and region tracking.
- Weight logging and simple progress charts.
- Settings for goals, week start, locale, theme, profile, TDEE estimate and reminders.
- JSON export/import and local data erase.
- PWA manifest/service worker configuration and GitHub Pages workflow. Heavy Paddle/ONNX assets are lazy-loaded for scanner use instead of being forced into the normal PWA precache/install path.
- Vitest regression/domain/component tests.
- IndexedDB writes are normalized to plain JSON at the Dexie boundary to avoid storing Vue reactive proxies.
- `Makefile` supports common local targets. `make push` is only `git add .`, `git commit`, and `git push origin HEAD`; validation/build is reserved for `make deploy`.

The repo was initially empty except for `LICENSE`; the `docs/agent` files were created during initial implementation.
