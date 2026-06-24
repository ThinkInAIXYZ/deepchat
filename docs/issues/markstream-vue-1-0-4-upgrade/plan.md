# Plan

## Approach
Treat the existing `package.json` edit as a focused dependency maintenance fix and keep the SDD record minimal.

## Affected files
- `package.json`
- `docs/issues/markstream-vue-1-0-4-upgrade/spec.md`
- `docs/issues/markstream-vue-1-0-4-upgrade/plan.md`
- `docs/issues/markstream-vue-1-0-4-upgrade/tasks.md`

## Compatibility
A patch-level dependency bump should preserve the existing public interface while picking up upstream fixes.

## Validation
Run:
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
