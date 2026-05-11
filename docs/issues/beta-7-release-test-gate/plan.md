# Plan

## Scope

- Update release metadata for the next beta version.
- Repair test fixtures that lag behind the structured message/search table additions.
- Keep platform path expectations stable on macOS `/var` and `/private/var` aliases.

## Validation

- Run `pnpm run format`.
- Run `pnpm run i18n`.
- Run `pnpm run lint`.
- Run `pnpm run typecheck`.
- Run focused failing test files, then the full test suite if practical.
