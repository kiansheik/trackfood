# Handoff: Fraction and Mixed-Number Inputs

## Goal

Allow package-style numeric inputs such as `4 3/4` for serving-unit relationships, while preserving support for decimal dots and Brazilian decimal commas.

## Files inspected

- `docs/agent/index.md`
- `docs/agent/current-state.md`
- `docs/agent/repo-map.md`
- `docs/agent/open-questions.md`
- `src/domain/number.ts`
- `src/domain/ocr.ts`
- `src/views/FoodEditorView.vue`
- `src/views/SettingsView.vue`

## Files changed

- `src/domain/number.ts`
- `src/domain/number.test.ts`
- `src/domain/ocr.ts`
- `src/domain/ocr.test.ts`
- `src/views/FoodEditorView.vue`
- `src/views/SettingsView.vue`
- `README.md`
- `docs/agent/current-state.md`
- `docs/agent/log.md`
- `docs/agent/session-handoffs/2026-08-20-fraction-inputs.md`

## Commands run

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build`

## What worked

- `parseDecimalInput` now accepts `4.75`, `4,75`, `3/4`, `4 3/4`, `4-3/4`, and common unicode vulgar fractions such as `¾`.
- Food serving-unit inputs no longer use Vue `.number`, avoiding premature coercion of `4 3/4` to `4`.
- OCR parsing now recognizes mixed-number serving counts in text such as `Porção: 30 g (4 3/4 unidades)`.
- Lint, tests, typecheck, and build pass.

## What failed

- Initial typecheck rejected `String.prototype.replaceAll` because the current TypeScript app lib target does not include it; replaced with `split().join()`.

## Remaining questions

- None for this change.

## Suggested next prompt

Try creating a food with `Printed quantity = 4 3/4` and `Printed grams = 30`, then log `2 unidades` to verify the same grams/nutrition preview as the decimal path.
