# Repo Map

- `src/main.ts` starts Vue, Pinia, Router and the PWA update prompt.
- `src/App.vue` defines the app shell, mobile tab bar and top actions.
- `src/styles.css` contains the mobile-first shared UI styling.
- `src/router.ts` uses hash routing for GitHub Pages-safe navigation.
- `src/db.ts` defines the Dexie database and default settings.
- `src/stores/app.ts` is the app state and persistence boundary.
- `src/domain/types.ts` defines durable app data shapes.
- `src/domain/nutrition.ts` contains serving-unit conversion, nutrition scaling and diary snapshot creation.
- `src/domain/budget.ts` contains date/week and calorie budget calculations.
- `src/domain/metabolism.ts` contains BMR/TDEE estimates.
- `src/domain/weight.ts` contains weight sorting, moving average and windowed changes.
- `src/domain/ocr.ts` parses Brazilian nutrition-label OCR text into editable drafts.
- `src/domain/openFoodFacts.ts` normalizes Open Food Facts API data into editable food drafts.
- `src/domain/backup.ts` builds and validates versioned JSON backups.
- `src/views/` contains route screens for dashboard, foods, food editor, logging, scanning, OCR, progress, settings and backups.
- `src/domain/*.test.ts` contains regression and calculation tests.
- `.github/workflows/pages.yml` builds and deploys static GitHub Pages artifacts.
- `Makefile` provides local wrappers for lint/test/typecheck/build, a simple git `push` workflow, and `make deploy` for `gh-pages` branch publishing.
