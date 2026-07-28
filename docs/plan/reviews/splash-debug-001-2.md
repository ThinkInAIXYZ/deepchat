# Review: splash-debug-001 follow-up

**Reviewed commits:** `fdd303f5063b46142c60a8aa2c93e56e1f4cb048` and follow-ups
`c750f03b11b5c91b2b5e0d964c11b967de6d1c9e`,
`52c548ca8bbf61da8fdcc8cc87588f8de9f58414`

## Judgment: blocked

The P1 event-delivery race reported in the first review is resolved: the splash preload installs its
main-process listener before either splash renderer code runs, retains the latest debug mode, and
synchronously replays it when the Vue or inline renderer subscribes. The main-process replay after
load/reload is also preserved. Typed contracts, production/package denial, debug-menu visibility,
and close isolation meet the specification on source review and focused tests.

However, the required inline-fallback renderer regression coverage is still not behavioral. The only
fallback assertion inspects generated HTML text, so it would not detect a broken `onDebugMode`
subscription, DOM update, disabled control, or a regression of real unlock IPC. This leaves a
specified acceptance-test boundary unverified.

## Findings

### P1 — none

- `SplashWindow` retains `debugMode`, emits it only after splash document load, and resets the load
  flag before each `did-finish-load` event, so it sends again after reload
  ([`src/main/app/splashWindow.ts`](../../../src/main/app/splashWindow.ts#L169-L175),
  [`src/main/app/splashWindow.ts`](../../../src/main/app/splashWindow.ts#L294-L304),
  [`src/main/app/splashWindow.ts`](../../../src/main/app/splashWindow.ts#L360-L370)).
- The preload listener is registered at preload evaluation, before Vue `onMounted` and before the
  inline page script. It stores the latest mode and replays it synchronously after registering the
  renderer callback ([`src/preload/splash-preload.ts`](../../../src/preload/splash-preload.ts#L38-L57)).
  This resolves the lost-event ordering for both renderers; no separate inline handshake is needed.
- The preload replay is covered directly by
  [`test/renderer/api/preloadBoundaries.test.ts`](../../../test/renderer/api/preloadBoundaries.test.ts#L266-L287),
  while main-process deferred dispatch and reload dispatch are covered by
  [`test/main/app/splashWindow.display.test.ts`](../../../test/main/app/splashWindow.display.test.ts#L295-L315).

### P2 — blocking — Inline fallback behavior is not executed by a regression test

- **Evidence:** The fallback test decodes generated HTML and only asserts that source strings such as
  `if (mode === 'loading')` exist
  ([`test/main/app/splashWindow.display.test.ts`](../../../test/main/app/splashWindow.display.test.ts#L342-L374)).
  It does not execute the inline page script or invoke the exposed `onDebugMode` callback.
- **Impact:** The specification requires the inline fallback to render all three modes, present a
  non-submittable manual unlock preview, and retain real unlock IPC behavior. A typo in its listener,
  DOM IDs, state updates, disabled flags, or real unlock handler could ship while this test still
  passes.
- **Required fix:** Add a focused DOM-level fallback test that executes the generated fallback script
  with a mocked `deepchatSplash`; assert loading and system-unlock text, disabled manual-unlock input
  and actions, no debug submission/cancel IPC, and that a real unlock request restores enabled input
  and submit/cancel IPC.

### P3 — non-blocking — Repository-wide English i18n validation has a pre-existing unrelated failure

- **Evidence:** `pnpm run i18n` passed. `pnpm run i18n:en` failed only because
  `deepchatAgents.memoryManager.loadMore` is missing from 19 existing locale files; Splash Debug
  changes add no translation files or keys.
- **Impact:** This prevents a completely green repository-wide i18n command but is unrelated to this
  delivery.
- **Recommended follow-up:** Resolve or baseline the existing locale-key gap separately.

## Verified contracts and isolation

- The Debug Settings navigation entry is `developmentOnly`
  ([`src/shared/settingsNavigation.ts`](../../../src/shared/settingsNavigation.ts#L301-L308)).
- Both typed routes validate input then deny non-development or packaged invocation before delegating
  ([`src/main/app/routes.ts`](../../../src/main/app/routes.ts#L197-L217)); the route schema permits
  only `loading`, `system-unlock`, and `unlock`
  ([`src/shared/contracts/routes/debug.routes.ts`](../../../src/shared/contracts/routes/debug.routes.ts#L5-L21)).
  The packaged denial and invalid-mode path are covered by
  [`test/main/app/routes.test.ts`](../../../test/main/app/routes.test.ts#L53-L95).
- Preview mode is a one-way main-to-splash channel only; the exposed splash API contains a scoped
  subscription and existing unlock methods, not a renderer-to-main debug command
  ([`src/preload/splash-preload.ts`](../../../src/preload/splash-preload.ts#L44-L70),
  [`test/renderer/api/preloadBoundaries.test.ts`](../../../test/renderer/api/preloadBoundaries.test.ts#L289-L360)).
- Vue manual preview clears the request state and disables password entry, submit, and quit; its
  handlers also return before sending unlock IPC
  ([`src/renderer/splash/loading.vue`](../../../src/renderer/splash/loading.vue#L145-L151),
  [`src/renderer/splash/loading.vue`](../../../src/renderer/splash/loading.vue#L177-L203)).
- Debug close clears only `debugMode` and calls `close` with `resolveUnlockRequest: false`; the focused
  test verifies the outstanding unlock promise remains unresolved
  ([`src/main/app/splashWindow.ts`](../../../src/main/app/splashWindow.ts#L178-L185),
  [`test/main/app/splashWindow.display.test.ts`](../../../test/main/app/splashWindow.display.test.ts#L317-L340)).

## Verification evidence

| Command | Outcome |
| --- | --- |
| `pnpm exec oxfmt --check src/main/app/composition.ts src/main/app/mainProcess.ts src/main/app/routes.ts src/main/app/splashWindow.ts src/preload/splash-preload.ts src/renderer/api/DebugClient.ts src/renderer/settings/components/DebugSettings.vue src/renderer/splash/env.d.ts src/renderer/splash/loading.vue src/shared/contracts/routes.ts src/shared/contracts/routes/debug.routes.ts src/shared/contracts/splash.ts test/main/app/routes.test.ts test/main/app/splashWindow.display.test.ts test/renderer/api/preloadBoundaries.test.ts test/renderer/components/DebugSettings.test.ts test/renderer/splash/loading.test.ts docs/features/splash-debug-tooling/plan.md docs/features/splash-debug-tooling/spec.md docs/features/splash-debug-tooling/tasks.md docs/plan/reviews/splash-debug-001-1.md docs/plan/tasks/splash-debug-001.md` | Passed: all 17 matched files formatted. |
| `pnpm run typecheck:node` | Passed. |
| `pnpm run typecheck:web` | Blocked before analysis: `vue-tsc: command not found`. The worktree `node_modules` is a symlink to the primary worktree dependency directory, and neither location has `node_modules/.bin/vue-tsc`, despite it being declared in `devDependencies`. |
| `pnpm vitest run --config vitest.config.ts test/main/app/routes.test.ts test/main/app/splashWindow.display.test.ts` | Passed: 2 files, 16 tests. |
| `pnpm vitest run --config vitest.config.renderer.ts test/renderer/api/preloadBoundaries.test.ts test/renderer/components/DebugSettings.test.ts test/renderer/splash/loading.test.ts` | Passed: 3 files, 14 tests. |
| `pnpm run i18n` | Passed: no missing or invalid translations. |
| `pnpm run i18n:en` | Failed only on the unrelated existing `deepchatAgents.memoryManager.loadMore` locale gap described above. |
| `pnpm run lint` | Passed: cleanup guard and oxlint reported 0 warnings and 0 errors. |

## Remaining uncertainty

`typecheck:web` cannot be verified until dependencies containing the declared `vue-tsc` executable are
installed or restored. The direct preload and SplashWindow tests establish the replay ordering, but the
inline fallback still lacks executable behavior coverage; that P2 is the delivery gate.
