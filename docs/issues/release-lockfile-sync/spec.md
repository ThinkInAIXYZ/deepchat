# Web Typecheck Package Resolution

## User Story

As a maintainer preparing a beta release, I need renderer typechecking to resolve frontend packages that expose their types through modern package `exports`.

## Acceptance Criteria

- `pnpm install --frozen-lockfile` succeeds on the release-ready commit.
- `pnpm run typecheck:web` can resolve modern package `exports` types such as `@iconify/vue`.
- The fix is limited to typecheck metadata and does not change runtime behavior.

## Non-goals

- No dependency version changes.
- No runtime bundler or UI behavior changes.
