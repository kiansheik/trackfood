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
- Prototyped a responsive automatic capture pipeline with a bounded latest-biased queue, then superseded that product UX after phone testing showed the human could choose useful label views more efficiently than a background stream collector.
- The active scanner now opens a live preview but takes no OCR observation until the user deliberately taps the viewport. The viewport is the shutter when ready and visibly dims/disables while PP-OCR processes that photo.
- Manual photos pass capture-quality and frozen-frame checks before OCR, so rejected frames never enter consensus. Accepted and rejected photo counts are displayed separately.
- Preserved PP-OCR region detection and lightweight optical-flow tracking between deliberate photos, so the inner nutrition-block outline and adaptive crop still follow the label without automatically collecting evidence.
- Added a one-unresolved-field exit: when the other required fields are confirmed, the UI recommends carrying the composite into the ordinary food editor and typing that last field instead of paying for another OCR pass.
- Added constraint-aware numeric consensus so physically impossible OCR candidates such as `23400 g` on a 100 g basis are excluded while plausible conflicts remain visible; clean fully consistent scans can complete after three deliberate observations.
- Added pause/resume/start-over/review-current-result controls so partial evidence can be accepted and edited without waiting for perfect consensus.
- Added reusable barcode capture to every food editor, preserved manual barcode entry, and rejected duplicate local barcode assignments so future scans resolve directly to the saved food.
- Expanded regression coverage to include no evidence before a manual tap, disabled shutter during in-flight OCR, bad-photo rejection before consensus, duplicate manual frame rejection, manual-finish recommendation, plausible HUD conflicts and clean three-photo completion.
