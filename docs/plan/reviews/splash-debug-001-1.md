# Review: splash-debug-001

**Reviewed commit:** `fdd303f5063b46142c60a8aa2c93e56e1f4cb048` (`feat(debug): add splash previews`)

## Judgment: blocked

The typed renderer-to-main routes are correctly schema-validated and development/packaged gated, and the
manual Vue preview prevents submit/cancel IPC. However, the preview-mode delivery races renderer
subscription, so a newly created preview can remain in the default loading state. The changed files also
fail the required formatter check.

## Findings

### P1 — blocking — Initial preview event can be lost before either splash renderer subscribes

- **Evidence:** [`src/main/app/splashWindow.ts`](../../../src/main/app/splashWindow.ts#L169-L175) records the
  requested mode, creates the BrowserWindow, and sends the event as soon as `splashDidFinishLoad` becomes
  true. [`src/main/app/splashWindow.ts`](../../../src/main/app/splashWindow.ts#L359-L367) marks the splash
  loaded directly from `did-finish-load` and immediately calls `emitDebugMode`. The Vue receiver only adds
  its `ipcRenderer` listener from `onMounted` in
  [`src/renderer/splash/loading.vue`](../../../src/renderer/splash/loading.vue#L197-L203); the inline
  fallback only adds it when its page script executes in
  [`src/main/app/splashWindow.ts`](../../../src/main/app/splashWindow.ts#L600-L602).
- **Impact:** Electron does not queue an IPC event for a future `ipcRenderer.on` listener. On a newly
  created debug window, `did-finish-load` can precede either registration, losing the one-shot event and
  leaving the default `loading` visual state. This violates the selected-mode and load/replay requirements
  in the feature spec.
- **Required fix:** Make delivery subscription-safe, for example retain the last debug mode in the splash
  preload and replay it immediately from `onDebugMode`, or add an explicit ready/request handshake. Cover
  a mode emitted before Vue and inline-fallback subscription, plus renderer reload replay.

### P1 — blocking — Changed source does not pass the required formatting check

- **Evidence:** `pnpm exec oxfmt --check` over the changed source and tests exited 1. It reported format
  issues in [`src/main/app/splashWindow.ts`](../../../src/main/app/splashWindow.ts),
  [`src/renderer/settings/components/DebugSettings.vue`](../../../src/renderer/settings/components/DebugSettings.vue),
  [`src/renderer/splash/loading.vue`](../../../src/renderer/splash/loading.vue),
  [`test/renderer/api/preloadBoundaries.test.ts`](../../../test/renderer/api/preloadBoundaries.test.ts), and
  [`test/renderer/components/DebugSettings.test.ts`](../../../test/renderer/components/DebugSettings.test.ts).
- **Impact:** The repository-required formatting validation fails, so this commit is not CI-ready.
- **Required fix:** Apply Oxfmt to the listed files and rerun the formatter check.

### P2 — blocking — Required lifecycle and fallback regression coverage is absent

- **Evidence:** The feature plan explicitly requires tests for held-until-loaded delivery, reload replay,
  close state isolation, and inline fallback states. The added route test only proves a development-path
  delegate call ([`test/main/app/routes.test.ts`](../../../test/main/app/routes.test.ts#L52-L69)). The
  existing SplashWindow suite has no debug-scenario test cases
  ([`test/main/app/splashWindow.display.test.ts`](../../../test/main/app/splashWindow.display.test.ts#L134-L358)),
  and its fallback test only verifies URL selection, not received mode rendering
  ([`test/main/app/splashWindow.display.test.ts`](../../../test/main/app/splashWindow.display.test.ts#L295-L322)).
  It also does not exercise `app.isPackaged` / non-development route denial.
- **Impact:** The lost-event defect is unprotected, and safety/lifecycle requirements could regress
  unnoticed.
- **Required fix:** Add focused tests for denied gates, initial delivery after subscription readiness,
  reload replay, safe close while unlock state exists, and all inline fallback modes.

## Verification evidence

- Passed focused suites:
  - `pnpm vitest run --config vitest.config.ts test/main/app/routes.test.ts test/main/app/splashWindow.display.test.ts`
    — 13 tests passed.
  - `pnpm vitest run --config vitest.config.renderer.ts test/renderer/api/preloadBoundaries.test.ts test/renderer/components/DebugSettings.test.ts test/renderer/splash/loading.test.ts`
    — 13 tests passed.
- Passed: `pnpm run typecheck:node`.
- Could not complete web typecheck: `pnpm run typecheck:web` fails before type analysis because
  `vue-tsc: command not found` in this worktree.
- Not run: full i18n/lint suites, because the focused formatter check already fails.

## Remaining uncertainty

The event ordering defect is based on Electron IPC listener semantics and the observed lifecycle ordering;
it needs an Electron/integration regression test after the delivery mechanism is fixed. The missing
`vue-tsc` executable prevents confirming the web typecheck in this environment.
