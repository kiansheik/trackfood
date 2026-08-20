# TrackFood

TrackFood is a local-first nutrition, calorie, weight and fitness-tracking PWA. It is designed as a small personal utility for fast food logging, Brazilian serving-size labels, weekly calorie budgeting, weight progress, backups and offline use.

There are no accounts, telemetry, ads or required backend services. IndexedDB is the primary datastore and the user owns all data.

## Serving model

Foods do not have one indivisible serving. Nutrition is stored separately from human serving units.

For a label that says:

```text
Porção: 30 g (4,75 unidades)
```

TrackFood stores the printed relationship:

```text
4.75 unidades = 30 g
```

The app derives:

```text
1 unidade = 30 / 4.75 g = 6.315789473... g
2 unidades = 12.631578947... g
```

Nutrition is scaled from its independent basis, commonly `100 g`, without rounding internal conversion values. Rounding only happens for display.

## Architecture

- Vue 3, TypeScript and Vite for the static app.
- Vue Router uses hash history so GitHub Pages deep navigation does not produce 404s.
- Pinia holds app state loaded from Dexie.
- Dexie/IndexedDB stores foods, diary entries, weight entries and settings.
- Domain math lives in `src/domain`, outside Vue components.
- `vite-plugin-pwa` generates the service worker and manifest.
- Barcode scanning tries native `BarcodeDetector`, then lazy-loads `@zxing/browser`.
- Nutrition-label OCR lazy-loads Tesseract.js and always sends recognized data through an editable review form.
- Open Food Facts is optional and never authoritative; imported data must be reviewed before saving locally.

## Local data and privacy

All normal app data is stored in the browser's IndexedDB database named `trackfood`. The app requests persistent storage when supported, but it still works if the browser denies that request.

Open Food Facts lookups send only the searched barcode to Open Food Facts. OCR runs in the browser through Tesseract.js. The current version does not persist images.

## Development

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

Common Make targets are also available:

```bash
make lint
make test
make typecheck
make build
make validate
make push
make deploy
```

`make push` intentionally runs only:

```bash
git add .
git commit
git push origin HEAD
```

The app defaults to `/` as the Vite base path. For GitHub Pages under a repository path:

```bash
BASE_PATH=/trackfood/ npm run build
```

Or with Make:

```bash
BASE_PATH=/trackfood/ make build
```

## GitHub Pages

`.github/workflows/pages.yml` builds static files and deploys `dist` with GitHub Pages Actions. It uses:

```text
BASE_PATH=${{ vars.PAGES_BASE_PATH || format('/{repo}/') }}
```

Set the repository variable `PAGES_BASE_PATH` to `/` for a custom domain root, or to another path for a custom deployment layout.

The workflow is provided only as configuration. Repository Pages settings still need to be enabled in GitHub by the repository owner.

For repositories that deploy from a `gh-pages` branch instead of GitHub Actions:

```bash
make deploy
```

The deploy target validates the app, builds with `BASE_PATH=/trackfood/` by default, copies `dist` into a temporary worktree, commits the built files on `gh-pages`, and pushes that branch. Override `BASE_PATH=/` for a custom-domain root. `make deploy-gh-pages` is kept as an alias.

## Backup format

Backups are versioned JSON:

```ts
type BackupV1 = {
  version: 1
  exportedAt: string
  settings: AppSettings
  foods: Food[]
  diaryEntries: DiaryEntry[]
  weightEntries: WeightEntry[]
}
```

Imports are validated before IndexedDB is modified and then applied inside a Dexie transaction.

## Important limitations

- Barcode scanning depends on browser camera permissions and device support. Manual barcode entry remains available.
- Open Food Facts data can be incomplete or incorrect; local saved foods are preferred on later scans.
- Tesseract OCR is an assistant, not an authority. Low-confidence or missing values must be corrected manually.
- Static PWAs cannot guarantee exact scheduled notifications while fully closed on every browser. Reminder preferences are stored for in-app and opportunistic browser notifications.
- BMR/TDEE output is an estimate and can be overridden manually.
