# Handoff: Live Food References and Duplicate Foods

## Goal

Let users edit or duplicate foods, and make historical diary entries reflect current food database changes instead of frozen nutrition/name snapshots.

## Files inspected

- `docs/agent/index.md`
- `docs/agent/current-state.md`
- `docs/agent/repo-map.md`
- `docs/agent/open-questions.md`
- `src/domain/types.ts`
- `src/domain/nutrition.ts`
- `src/domain/budget.ts`
- `src/views/LogView.vue`
- `src/views/DashboardView.vue`
- `src/views/ProgressView.vue`
- `src/views/FoodEditorView.vue`
- `src/views/FoodsView.vue`

## Files changed

- `src/domain/types.ts`
- `src/domain/nutrition.ts`
- `src/domain/nutrition.test.ts`
- `src/domain/budget.ts`
- `src/domain/budget.test.ts`
- `src/domain/foods.ts`
- `src/domain/foods.test.ts`
- `src/stores/app.ts`
- `src/views/DashboardView.vue`
- `src/views/LogView.vue`
- `src/views/ProgressView.vue`
- `src/views/FoodsView.vue`
- `src/views/FoodEditorView.vue`
- `docs/agent/current-state.md`
- `docs/agent/repo-map.md`
- `docs/agent/log.md`
- `docs/agent/session-handoffs/2026-08-20-live-food-history.md`

## Commands run

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `rg -n "immutable diary|snapshot|snapshots|buildDiarySnapshot" README.md docs/agent src`

## What worked

- Food diary entries now store food id, amount, unit, date, and fallback fields, but resolve current food name/nutrition at display/total time when the food still exists.
- Quick calories and deleted-food entries still use stored fallback nutrition.
- Dashboard, log view, progress charts, and weekly budget totals now pass the current food table into diary nutrition calculations.
- Food list and food editor now expose duplicate actions. Duplicates copy nutrition and serving units, generate fresh unit ids, clear barcode, and start with a changed name.
- Tests cover live budget propagation after a food nutrition edit and duplicate draft behavior.

## What failed

- Nothing failed after implementation; lint, tests, typecheck, and build passed.

## Remaining questions

- Whether deleted foods should remain restorable or be soft-deleted in a future version instead of relying on fallback entry values.

## Suggested next prompt

Create a food, log it, edit its name/nutrition, and confirm the diary/dashboard totals update. Then duplicate it and save a variant with a different name.
