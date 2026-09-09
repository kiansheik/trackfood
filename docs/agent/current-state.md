# Current State

TrackFood has an initial functional static PWA implementation.

Implemented:

- Vue 3, TypeScript, Vite, Vue Router hash routing and Pinia.
- Dexie/IndexedDB persistence for foods, diary entries, weight entries and settings.
- Domain layer for serving-unit conversion, nutrition scaling, weekly calorie budgets, BMR/TDEE estimates, weight trends, OCR parsing, Open Food Facts normalization and backups.
- Food creation and edit flow with independent nutrition basis, human serving units, optional brand and optional barcode registration.
- Every food editor can scan an EAN/UPC barcode with native `BarcodeDetector` first and ZXing fallback; duplicate local barcode registration is rejected so future scans resolve unambiguously.
- Barcode identity is now separate from barcode nutrition. After label OCR/manual nutrition, scanning or entering a barcode can fetch Open Food Facts name/brand without replacing nutrition, basis or serving values. Generated placeholders such as `OCR food` may be replaced by provider identity, while a user-entered name/brand remains authoritative. Identity provenance is stored in source metadata.
- Open Food Facts identity normalization works even when the product has no nutriments at all and prefers an explicit Portuguese product name when present.
- Fast food logging with recent/frequent foods, Brazilian decimal, fraction and mixed-number input parsing, and immutable diary nutrition snapshots.
- Quick calories.
- Dashboard with daily calories, weekly budget, macros, meals and weight summary.
- Barcode scan screen using native `BarcodeDetector` first and ZXing fallback. It checks locally saved foods before Open Food Facts, so a barcode registered during food creation bypasses label OCR on later scans.
- Optional Open Food Facts lookup routed through editable import review.
- Brazilian nutrition-label OCR now has a provider layer rather than assuming one OCR engine. Capacitor native builds use bundled Google ML Kit Latin text recognition first; normal browsers/PWAs opportunistically use the Shape Detection `TextDetector` API when exposed; PP-OCRv6-small remains the robust browser fallback; Tesseract remains the final runtime/model compatibility fallback.
- Native/browser-native OCR geometry is normalized into the same `OcrLayout` contract as Paddle, so the ANVISA-aware parser, canonical 100 g/100 ml basis, semantic region model and constraint-aware consensus remain provider-independent.
- Capacitor 8 configuration and Android/iOS build scripts are present. Native platform folders are not committed yet. Native ML Kit uses `@capacitor-mlkit/text-recognition` plus a short-lived Filesystem cache image; the Android dependency bundles the Latin recognizer so scanner startup does not need a first-use ML Kit model download.
- PP-OCRv6-small remains lazy. Its first browser startup now emits a visible global progress bar and dynamic ETA. Worker mode cannot expose byte-accurate download progress, so the ETA is explicitly estimated from network downlink on first use and an exponentially weighted startup history on that device thereafter; progress never reaches 100 until initialization actually resolves.
- The two PP-OCRv6-small model archives have a separate long-lived `trackfood-ocr-models-v1` runtime cache. Heavy JS/WASM/OpenCV/ORT scanner assets remain lazy in `trackfood-ocr-runtime-v1`.
- Cropped linear labels can recover a missing 100 g/100 ml heading when repeated per-serving arithmetic independently validates the same interpretation across multiple nutrients; `Valor energético` / `Energia` are explicitly typed as kcal semantics.
- The active scanner is deliberate tap-to-capture rather than a streaming collector. Opening the camera starts only the preview, OCR provider initialization and lightweight region tracker; no preview frame becomes nutrition evidence until the user taps the viewport.
- The entire viewport is the shutter when ready. It visibly dims and disables while one selected image is in OCR, so another observation cannot be added until the current one has finished processing.
- A tapped frame passes the existing capture-quality gate before OCR. Extreme blur/light failures and effectively identical frozen frames are rejected before they can enter consensus; accepted/rejected counts are shown separately.
- The camera no longer builds a background snapshot queue for the product flow. Deliberate accepted photos are processed one at a time, which makes the human choice of angle/focus part of evidence collection instead of treating arbitrary stream frames as independent observations.
- A subtle outer dashed guide defines the generous manual capture area. The green semantic nutrition polygon is **feedback only and never the next OCR crop**; every deliberate photo reads the entire dashed guide so an inaccurate region cannot hide the unresolved nutrient from subsequent OCR.
- The semantic polygon is inferred from nutrition-aware OCR rows and can preserve rows between recognized nutrient landmarks even when the nutrient name itself was missed. It learns useful extent across deliberate photos via matching semantic landmarks and is transported from shutter-time pose to the current video pose when delayed OCR returns.
- Live tracking between OCR observations uses strong local features, bidirectional patch matching and a robust affine/RANSAC-style fit rather than the older fixed 3x3 patch grid. It drops/reacquires instead of pretending confidence through large perspective jumps or occlusion.
- The camera HUD keeps 11 field-state indicators and names fields still missing or conflicting, while pause/resume/start-over/review-current-result preserve user control.
- When exactly one required field remains unresolved after the rest of the label is confirmed, the scanner explicitly recommends carrying the composite into the ordinary food editor and typing that field manually instead of spending another expensive OCR pass.
- Multi-frame consensus keeps plausible contradictions separate and can revoke a previously confirmed value after a recent plausible contradiction.
- Constraint-aware numeric consensus removes physically incompatible OCR candidates before voting. For 100 g solids it uses a conservative mass budget, sugar/carbohydrate and fat subset relationships, and kcal/energy-factor lower bounds; 100 ml liquids are not treated as 100 g without density.
- Constraints are recalculated from already-confirmed fields so the plausible range for unresolved values narrows during a scan. A field may settle from two matching observations only under strong independent context; a whole scan still needs at least three independent canonical observations for automatic completion.
- Clean high-quality fully consistent labels can auto-complete after three deliberate OCR photos, while lower-quality or genuinely conflicting scans remain conservative. A single native OCR photo can already populate an editable partial draft, but native one-photo auto-confirm is intentionally not enabled until real-device benchmark data supports it.
- OCR can be paused without discarding the composite, resumed with existing evidence, started over, or accepted early. Partial and complete results both route through the normal editable food form for name, brand, barcode and final nutrition review.
- OCR methodology, regulatory assumptions, model choices, camera tracking, plausibility constraints and critique cycles are recorded in `docs/ocr-methodology.md`; native-provider/startup/cache details are in `docs/native-ocr.md`; semantic region details are in `docs/ocr-semantic-region.md`.
- Settings now has **Force update & reload** for stale installed PWAs. Workbox has `cacheId: "trackfood"`; the force-refresh flow unregisters only TrackFood's service worker, purges TrackFood app-shell/runtime caches, fetches a cache-busted `index.html`, and reloads while preserving IndexedDB user data and the expensive `trackfood-ocr-models-v1` cache.
- Regression coverage includes no-evidence-before-tap, shutter disable during in-flight OCR, rejection-before-consensus for bad manual frames, duplicate-frame rejection, pause/partial handoff, plausible conflicts reflected in the HUD, manual-finish recommendation for one unresolved field, impossible numeric outlier pruning (including a `9 g` vs `23400 g` case), three-photo clean auto-completion, permission/worker cancellation, camera cleanup, semantic region tracking, native `TextDetector` geometry normalization, forced-refresh cache safety, no-nutrition barcode identity normalization and barcode identity merge precedence over external nutrition data.
- Weight logging and simple progress charts.
- Settings for goals, week start, locale, theme, profile, TDEE estimate and reminders.
- JSON export/import and local data erase.
- PWA manifest/service worker configuration and GitHub Pages workflow. Heavy Paddle/ONNX assets are lazy-loaded for scanner use instead of being forced into the normal PWA precache/install path.
- Vitest regression/domain/component tests.
- IndexedDB writes are normalized to plain JSON at the Dexie boundary to avoid storing Vue reactive proxies.
- `Makefile` supports common local targets. `make push` is only `git add .`, `git commit`, and `git push origin HEAD`; validation/build is reserved for `make deploy`.
- The repository `package-lock.json` is currently not synchronized with newer scanner/native dependencies, so CI intentionally falls back from `npm ci` to `npm install --package-lock=false`. Do not claim strict `npm ci` is green until the lockfile is regenerated and validated separately.

The repo was initially empty except for `LICENSE`; the `docs/agent` files were created during initial implementation.
