# Review: splash-debug-001 final

**Reviewed commits:** `fdd303f5063b46142c60a8aa2c93e56e1f4cb048` through
`e00467a34ca8ea5299d035e1c1b333f19c1fe77e` (`test(splash): cover inline fallback`)

## Judgment: pass (web typecheck externally blocked)

`e00467a34` resolves the remaining delivery gate from review 2. Its JSDOM test executes the generated
inline fallback against a mocked, scoped splash bridge. It verifies all three debug presentations, that
manual-unlock preview actions cannot send IPC, and that a subsequent real unlock request restores the
existing submit/cancel behavior. Source review found no regression to the typed main-process dev gate,
preload replay boundary, sender restrictions, or real unlock lifecycle.

## Findings

### P1 — none

- The main-process retained-mode dispatch still waits for a loaded splash renderer and re-emits after
  reload ([`src/main/app/splashWindow.ts`](../../../src/main/app/splashWindow.ts#L169-L175),
  [`src/main/app/splashWindow.ts`](../../../src/main/app/splashWindow.ts#L294-L304),
  [`src/main/app/splashWindow.ts`](../../../src/main/app/splashWindow.ts#L360-L370)).
- The context-isolated preload receives the event before renderer initialization, holds the latest mode,
  and synchronously replays it during `onDebugMode` registration
  ([`src/preload/splash-preload.ts`](../../../src/preload/splash-preload.ts#L38-L57)).
- Typed Debug routes validate input and reject production or packaged calls before delegating
  ([`src/main/app/routes.ts`](../../../src/main/app/routes.ts#L197-L217)).

### P2 — none

- The prior unexecuted-inline-fallback gap is closed by DOM-level assertions in
  [`test/main/app/splashWindow.display.test.ts`](../../../test/main/app/splashWindow.display.test.ts#L343-L462).
  The test invokes each debug listener mode, checks the disabled manual form, verifies no preview IPC,
  then injects a real unlock request and verifies enabled submit/cancel IPC with the supplied request ID.
- The test uses the production fallback document returned by `buildInlineFallbackSplashUrl`, rather than
  duplicating its implementation, so changes to the actual script and DOM contract remain observable.

### P3 — non-blocking — web typecheck cannot execute in this worktree

- **Evidence:** `pnpm run typecheck:web` exits before type analysis with `sh: vue-tsc: command not found`.
  `vue-tsc` remains declared but absent from the shared worktree dependency binaries.
- **Impact:** The Splash renderer’s application TypeScript check cannot be independently confirmed in the
  present environment. Node typechecking and every focused suite pass.
- **Recommended follow-up:** Restore/install the declared dependency, then rerun `pnpm run typecheck:web`.

### P3 — non-blocking — repository-wide English locale check has a pre-existing failure

- **Evidence:** `pnpm run i18n:en` reports only missing
  `deepchatAgents.memoryManager.loadMore` in 19 existing locale files. This task adds neither locale files
  nor i18n keys.
- **Impact:** This repository-wide optional validation remains non-green for an unrelated reason.
- **Recommended follow-up:** Correct or baseline the locale-key gap separately.

## Verification evidence

| Command | Outcome |
| --- | --- |
| `pnpm vitest run --config vitest.config.ts test/main/app/routes.test.ts test/main/app/splashWindow.display.test.ts` | Passed: 2 files, 16 tests. |
| `pnpm vitest run --config vitest.config.renderer.ts test/renderer/api/preloadBoundaries.test.ts test/renderer/components/DebugSettings.test.ts test/renderer/splash/loading.test.ts` | Passed: 3 files, 14 tests. |
| `pnpm exec oxfmt --check test/main/app/splashWindow.display.test.ts docs/features/splash-debug-tooling/tasks.md docs/plan/tasks/splash-debug-001.md` | Passed. |
| `pnpm run typecheck:node` | Passed. |
| `pnpm run lint` | Passed: cleanup guard and oxlint reported zero warnings/errors. |
| `pnpm run i18n` | Passed: no missing or invalid translations. |
| `pnpm run typecheck:web` | Blocked: `vue-tsc: command not found`. |
| `pnpm run i18n:en` | Failed only on the unrelated 19-locale missing-key gap above. |

## Remaining uncertainty

A dependency restoration is required to execute the web typecheck. The JSDOM test exercises the inline
fallback script and bridge contract, but it is not a full Electron process test; Electron-specific preload
loading remains covered by the focused preload-boundary tests rather than a packaged runtime invocation.
