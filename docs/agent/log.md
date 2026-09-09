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
- Added regression coverage that mounts the scanner into the real document, opens the camera, and asserts the manual camera service receives the actual rendered `HTMLVideoElement`.
- Latest camera-startup fix passed lint, all tests, TypeScript checking and the production build in pull-request CI.
