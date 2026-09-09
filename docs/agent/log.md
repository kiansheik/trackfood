# Agent Log

## 2026-08-20

- Created the initial TrackFood Vue/Vite/PWA project in an empty repository.
- Added the domain model and tests before wiring the UI.
- Implemented IndexedDB persistence, food creation, food logging, barcode/OFF import review, OCR draft review, weekly budgeting, weight progress, backup/import, PWA config and GitHub Pages workflow.
- Added ESLint and upgraded the dev/build toolchain to Vite 8/Vitest 4 after npm audit showed older dev-server advisories.
- Verified `npm run lint`, `npm test`, `npm run typecheck`, `npm run build` and `npm audit --omit=dev`.
- Fixed a browser startup Dexie error by converting reactive store objects into plain JSON before writing them to IndexedDB.
- Added favicon links/files so `/favicon.ico` does not 404 in development.
- Added `Makefile` targets for lint/test/typecheck/build/validate/push and branch-based `gh-pages` deployment.
- Adjusted `make push` to run only `git add .`, `git commit`, and `git push origin HEAD`; validation/build is reserved for `make deploy`.

## 2026-09-08

- Extended the central numeric input parser to support simple fractions, mixed numbers, hyphenated mixed numbers and common Unicode vulgar fractions.
- Verified all 18 tests, ESLint, TypeScript checking and the production PWA build.

## 2026-09-09

- Wired the bounded multi-frame OCR camera into the nutrition-label screen with the actual crop guide, live scan state, overall consensus progress and per-field evidence progress.
- Added explicit confirmed, collecting, missing and conflict states so contradictory OCR readings are shown rather than averaged or silently accepted.
- Kept partial composites visible after user cancellation and exposed automatic-completion state when the camera stops after full repeated consensus.
- Added `OcrView` component tests for cancellation, contradictory readings and automatic stopping, complementing the service lifecycle and consensus-domain regression tests.
- Replaced flattened Tesseract-first label OCR with PP-OCRv6-small as the primary browser recognizer, retaining detection polygons and feeding them into an ANVISA-aware geometry parser for canonical 100 g/100 ml values; Tesseract remains a failure fallback.
- Added structured, broken-layout and linear/run-on parsing plus explicit serving-to-100 scaling and methodology citations in code and `docs/ocr-methodology.md`.
- Changed the slow live scanner from capture-then-wait to a responsive capture pipeline, then replaced that automatic sampling product flow with deliberate viewport-tap photos after real-world UX testing showed that expensive OCR passes should be user-selected.
- Added cheap pre-OCR viewfinder guidance for darkness, glare and focus plus tracked-region HUD feedback.
- Added pause/resume/start-over/review-current controls so partial evidence can be accepted and edited without waiting for perfect consensus.
- Added reusable barcode capture to every food editor, preserved manual barcode entry, and rejected duplicate local barcode assignments so future scans resolve directly to the saved food.
- Added physical/regulatory plausibility constraints so impossible numeric OCR outliers cannot force unnecessary additional scans.
- Added the one-field-left manual-finish recommendation so the product optimizes time-to-correct-editable-record rather than 11/11 OCR at any latency cost.
- Fixed a real-browser regression where the manual scanner's `Open camera` button could silently no-op because the Vue template video ref was unavailable while Vue reported a hoisted-vnode/ref warning. The scanner now resolves the already-rendered video element by stable DOM id, reports an explicit error instead of silently returning if it is missing, and avoids scanner-local router injection / `v-model` directives that were also present in the warning set.
- Reworked the green nutrition polygon after phone testing showed that its inaccurate crop could plausibly hide a missing field. Manual OCR now always reads the whole dashed guide; the green region is feedback only. Semantic OCR rows, cross-photo landmark registration, shutter-time pose transport and robust local-feature tracking make the HUD more useful without allowing it to blind OCR.
- Added a native-first OCR provider layer. Capacitor builds use bundled Google ML Kit Latin text recognition through `@capacitor-mlkit/text-recognition`; web installs opportunistically use `TextDetector`; PP-OCRv6-small is the browser fallback and Tesseract remains the final compatibility fallback.
- Added Capacitor 8 configuration/build scripts and a Filesystem-backed temporary-image bridge for ML Kit. Native platform folders are intentionally not committed yet.
- Added global OCR startup progress. PP-OCR worker mode cannot expose byte-accurate model progress, so TrackFood reports an explicit ETA estimate based on network downlink for first use and learned startup duration on later loads; progress reaches 100 only after initialization really completes.
- Added long-lived service-worker caching for the two PP-OCRv6-small model archives so browser fallback should not redownload roughly 30 MB on every later scan.
- Added Settings > `Force update & reload` for stale installed PWAs. Workbox caches are TrackFood-prefixed; the escape hatch unregisters only the TrackFood service worker, drops TrackFood shell/runtime caches, fetches a no-store cache-busted app shell and reloads while preserving IndexedDB and the expensive OCR model cache.
- Added regression coverage for browser-native OCR geometry normalization and forced-refresh cache safety.
- Latest code-bearing revision passed ESLint, all 69 Vitest tests across 19 test files, TypeScript checking and the production PWA build in pull-request CI. `npm ci` is still not strict-green because the repository lockfile has not been regenerated for the newer dependencies; CI uses the documented `npm install --package-lock=false` fallback.
