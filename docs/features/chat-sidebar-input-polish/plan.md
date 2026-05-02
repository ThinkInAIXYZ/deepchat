# Chat Sidebar Input Polish Plan

## Implementation Direction

- Use [spec.md](./spec.md) as the source of requirements and acceptance criteria.
- Identify the smallest implementation slice that satisfies the documented feature goal.
- Keep renderer-main changes on typed contracts, typed clients, and existing presenter boundaries.
- Preserve compatibility for stored user data, settings, and exported artifacts unless the spec explicitly defines a migration.

## Validation

- Add or update focused Vitest coverage for changed main, renderer, or shared behavior.
- Run targeted tests for the touched subsystem before the repository quality gates.
- Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` before handoff.
