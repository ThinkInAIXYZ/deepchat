# Plan

## Cause

The root project depends on `@vueuse/core@12.8.2`, which depends on its own `vue@3.5.34`. The app and newer UI dependencies use `vue@3.5.39`, so `vue-tsgo` sees incompatible `Ref` and `ComputedRef` symbols across the graph.

## Implementation

- Update the root `@vueuse/core` dev dependency to `^14.3.0`, matching the version already used by `reka-ui`.
- Regenerate the lockfile with pnpm 10.
- Keep code unchanged unless typecheck reveals a real API incompatibility.

## Test strategy

- Run `pnpm why vue @vueuse/core @vueuse/shared` to confirm dedupe.
- Run `pnpm run typecheck`.
- Re-run release-required `format`, `i18n`, and `lint`.
