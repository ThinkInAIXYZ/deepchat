# VueUse Typecheck Dedupe

## User need

Release checks should not fail because renderer type declarations load two different Vue minor versions.

## Goal

Keep the renderer dependency graph on one Vue type identity so `pnpm run typecheck` can complete before cutting the beta release branch.

## Acceptance criteria

- `pnpm why vue @vueuse/core @vueuse/shared` no longer shows root `@vueuse/core` pulling `vue@3.5.34`.
- `pnpm run typecheck` passes or fails only on unrelated issues.
- The fix does not add a new dependency.

## Constraints

- Use an already-installed dependency version when possible.
- Do not change renderer behavior.
- Keep release metadata separate from this dependency fix.

## Non-goals

- Broad dependency refresh.
- Refactoring Vue components or composables.

## Open questions

None.
