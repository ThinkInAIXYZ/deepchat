# Tasks: Splash Window UX Refresh

## 0) Spec & plan quality gate
1. Confirm acceptance criteria are measurable.
2. Confirm touched files match architecture boundaries.

## 1) Main process
1. Delay splash creation by 1s and skip if a window already exists.
2. Cache last progress update and flush it after splash loads.
3. Remove extra show delay to reduce blank/late splash.

## 2) Splash renderer UI
1. Replace current splash UI with a compact icon + status text (and progress bar).
2. Subscribe to `splash-update` and update UI reactively.
3. Add/adjust TS global typings for `window.electron` in splash entry.

## 3) Quality gates
1. Run `pnpm run format`.
2. Run `pnpm run lint`.
3. Run `pnpm run typecheck`.
4. Run `pnpm test` (or targeted suites if needed).

