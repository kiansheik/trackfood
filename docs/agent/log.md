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
