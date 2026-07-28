---
id: splash-debug-001
scope: development-only Splash preview controls
status: implementation-complete-validation-blocked
depends-on: []
---

## Objective

Implement the documented development-only Splash preview capability end-to-end. Use the existing typed
renderer bridge for Settings -> main, a development/package gate in the main process, and a scoped
one-way event for main -> context-isolated splash renderer. Support loading, system-unlock and disabled
manual-unlock preview modes plus close-preview. Preserve real database-unlock behavior and the inline
fallback renderer.

## Context

- `docs/README.md`
- `docs/features/splash-debug-tooling/spec.md`
- `docs/features/splash-debug-tooling/plan.md`
- `docs/features/splash-debug-tooling/tasks.md`
- existing typed route / event contracts and Debug Settings patterns

## Paths

- `docs/features/splash-debug-tooling/`
- `src/shared/contracts/`
- `src/main/app/`
- `src/renderer/api/DebugClient.ts`
- `src/renderer/settings/components/DebugSettings.vue`
- `src/preload/splash-preload.ts`
- `src/renderer/splash/`
- focused Splash / Debug route / preload / renderer tests

## Verification

Run focused route, SplashWindow, preload boundary, splash renderer and DebugSettings tests; then the
relevant typecheck. Update the feature task checklist. Do not stage unrelated files. Commit all intended
files with a Conventional Commit after tests pass.
