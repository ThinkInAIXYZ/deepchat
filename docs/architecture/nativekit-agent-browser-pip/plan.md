# NativeKit Agent Browser PiP Migration Plan

## Status

Implemented on 2026-07-23 through Phase 4. The macOS arm64 packaging and native-addon smoke portion
of Phase 5 is complete; physical cross-platform interaction and performance measurements remain
open release QA.

This plan implements the contract in `spec.md` with one process-global NativeKit coordinator,
on-demand loading at the first concrete preview target, and source-specific unavailable behavior:
Browser opens its existing side panel and Computer Use exposes no PiP.

## Selected Approach

Adopt NativeKit only at the floating-window seam.

```text
existing page/session/capture owner
              |
              v
      YoBrowserPresenter
              |
       completed JPEG frame
              |
       +------+----------------+
       |                       |
       v                       v
NativeKit adapter       native unavailable
supported runtime       Browser -> side panel
                        Computer Use -> no PiP
```

DeepChat does not need a second browser page, a second Electron window, a new preload capability,
or a generic native-services layer. NativeKit receives the same bounded JPEG that currently feeds
the renderer Canvas and owns only the native panel.

## Change Boundaries

### Dependency and packaging

- Pin `"@zerob13/nativekit": "0.6.3"` in `package.json` and refresh the local install metadata.
- Add `@zerob13/nativekit: false` to `pnpm-workspace.yaml` `allowBuilds`; the published prebuild
  should load directly, and an unsupported target should not silently become a local source build.
- Keep the package external to the Electron main bundle.
- Add `node_modules/@zerob13/nativekit/prebuilds/**/*` to `asarUnpack`.
- Extend the packaging validation to require the matching prebuild only for supported target
  tuples.
- Treat Windows arm64 as intentionally unsupported by NativeKit 0.6.3 rather than a packaging
  error; Browser uses its side panel and Computer Use runs without PiP.

### Main-process coordinator

Use `src/main/desktop/preview/AgentPreviewCoordinator.ts` as the shared native owner. The
coordinator owns:

- lazy dynamic import on the first concrete preview target, process-stable capability state, and
  one-time warning;
- `start`, first-host validation, host refresh, visibility, image replacement, image removal, and
  shutdown;
- the single active logical target;
- NativeKit `activate` and configured toolbar `control` listener registration and removal;
- fixed high-contrast toolbar configuration with caller-provided open-panel and close PNG templates;
- JPEG-to-data-URL conversion at the final native boundary;
- active-session selection before showing the current presentation;
- one-time active-session/show selection so steady-state image refresh only replaces the same
  presentation;
- timing around synchronous `pushImage()` calls.

The coordinator exposes a narrow DeepChat-facing API:

```ts
type AgentPreviewTarget = {
  source: 'browser' | 'computer-use'
  windowId: number
  sessionId: string
  runId: string
  epoch: number
  claimSequence: number
}

interface AgentPreviewCoordinator {
  register(source: AgentPreviewSource, handler: AgentPreviewActionHandler): () => void
  initialize(): Promise<boolean>
  isAvailable(): boolean
  isCurrent(target: AgentPreviewTarget): boolean
  claim(input: { source: AgentPreviewSource; sessionId: string; runId: string }): number
  dismiss(target: AgentPreviewTargetRef): boolean
  prepare(target: AgentPreviewTarget, host: BrowserWindow): AgentPreviewSurface
  present(target: AgentPreviewTarget, frame: Buffer): boolean
  hide(target?: AgentPreviewTargetRef): void
  removeTarget(target?: AgentPreviewTargetRef): void
  releaseClaim(target: AgentPreviewTargetRef): void
  shutdown(): void
}
```

Exact internal method names may follow repository conventions, but the ownership boundary must not
expand.

### Presenter integration

Extend `YoBrowserPresenter` preview state with:

- selected `BrowserPreviewSurface`;
- owning `windowId`;
- native logical target and visibility;
- existing capture epoch as the stale-frame guard.

The Browser presenter performs these operations in order:

1. Resolve and validate the owning `BrowserWindow`.
2. Load NativeKit only for `capturing`; `rendering` and application startup do not load it.
3. Select the process-stable surface.
4. Keep the existing page in the 1280 x 800 render host.
5. Capture, resize, and encode with one frame in flight.
6. Revalidate session, run, window, mode, surface, and epoch.
7. Present to exactly one destination.
8. Schedule the next capture only after presentation returns.

Computer Use records eligibility without loading NativeKit. Its first concrete target initializes
the coordinator. A failed initialization removes the preview state while leaving CUA execution
unchanged.

For the first native frame, `present()` runs while hidden and `setVisible(true)` follows only after
success. Temporary ineligibility hides the panel without removing the presentation. Terminal
lifecycle edges remove it.

### Shared contracts and renderer

Change `browser.setPreviewMode` from a boolean-only result to:

```ts
type BrowserPreviewSurface = 'native-overlay' | 'renderer-canvas' | 'none'

type BrowserPreviewModeResult = {
  updated: boolean
  surface: BrowserPreviewSurface
}
```

Add a typed main-to-renderer event:

```ts
type BrowserPreviewActionPayload = {
  action: 'activate' | 'dismiss'
  windowId: number
  sessionId: string
  runId: string
}
```

`AgentBrowserPiP.vue` keeps its current eligibility calculation and request coalescing. It records
the selected surface for the latest request:

- `native-overlay`: render no PiP DOM and ignore preview-frame events;
- `renderer-canvas`: retain current frame decode, Canvas, toolbar, drag, and dismissal behavior;
- `none`: render nothing.

The renderer accepts a native action only when `windowId`, `sessionId`, and `runId` still match its
current state. Activation opens the existing Browser panel. Dismissal updates the existing
run-scoped dismissal state.

When Browser receives `none` because the coordinator is unavailable, main reuses the typed
activation event to open the same Browser panel. Computer Use remains headless on `none`.

### Host and lifecycle synchronization

- Attach with `BrowserWindow.getContentBounds()` and `getNativeWindowHandle()`.
- Refresh host bounds after move, resize, and display changes through one debounced callback.
- Hide synchronously on blur, hide, minimize, panel open, or preview stop.
- Preserve the allocated presentation across temporary hide so manual placement survives.
- Remove the presentation on run terminal, target replacement, page/session destruction, or host
  close.
- Detach closed hosts and call `overlay.stop()` exactly once during presenter shutdown.

## Implementation Phases

### Phase 1: Capability and packaging

1. Add the exact dependency and lockfile entry.
2. Disable install-time source build for NativeKit.
3. Add ASAR unpack configuration.
4. Extend configuration and `afterPack` tests for the published prebuild matrix.
5. Verify dynamic import in an unpackaged development build.

Exit condition: unsupported runtimes do not load during startup and use source-specific unavailable
behavior, while supported packaged targets fail validation if their prebuild is absent.

### Phase 2: Native adapter

1. Implement capability detection and lifecycle.
2. Implement one-host, one-presentation state.
3. Implement push-before-show and idempotent cleanup.
4. Keep steady-state refresh to one same-identity `pushImage()` call so manual placement remains
   platform-owned.
5. Map unscoped NativeKit events through the current logical target.
6. Add adapter unit tests with a mocked NativeKit module and fake `BrowserWindow`.

Exit condition: the adapter never exposes NativeKit outside main and every failure is contained.

### Phase 3: Presenter routing

1. Remove NativeKit initialization from application startup.
2. Initialize the coordinator from the first Browser capture or concrete Computer Use target.
3. Return the selected surface from `setPreviewMode`.
4. Route completed frames directly to native or renderer, never both.
5. Add host visibility and bounds synchronization.
6. Preserve capture epoch and one-in-flight scheduling across surface changes.
7. Start with the existing 4 FPS active interval; raise to at most 8 FPS only after profiling.

Exit condition: supported runtime traffic contains no renderer frame payload on the native path.

### Phase 4: Renderer coordination

1. Extend route, client, and event contracts.
2. Make `AgentBrowserPiP.vue` conditional on the acknowledged surface.
3. Handle activate and dismiss actions with exact target validation.
4. Keep the Canvas path behavior and tests intact.

Exit condition: native activation and **Open in panel** open the same Browser panel, while native
**Close** dismisses only the current run.

### Phase 5: Performance and platform validation

1. Measure native drag on 60 Hz and 120 Hz macOS reference displays.
2. Verify full out-of-window movement and work-area clamping.
3. Measure first-frame latency, frame age, `pushImage()` duration, and main-thread long tasks.
4. Repeat interaction smoke tests on Windows x64 and Linux X11/XWayland.
5. Verify Browser side-panel handoff and absence of Computer Use PiP on Windows arm64 and native
   Wayland.
6. Build packaged artifacts and inspect the unpacked prebuild.

Exit condition: every acceptance criterion in `spec.md` has recorded evidence.

## Relevant File Map

The implemented behavior is owned by:

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `electron-builder.yml`
- `scripts/afterPack.js`
- `src/main/app/composition.ts`
- `src/main/desktop/preview/AgentPreviewCoordinator.ts`
- `src/main/desktop/browser/YoBrowserPresenter.ts`
- `src/main/desktop/computerUse/ComputerUsePreviewPresenter.ts`
- `src/main/desktop/routes.ts`
- `src/shared/contracts/routes/browser.routes.ts`
- `src/shared/contracts/events/browser.events.ts`
- `src/shared/types/desktop.ts`
- `src/renderer/api/BrowserClient.ts`
- `src/renderer/src/components/browser/AgentBrowserPiP.vue`
- focused main, renderer, contract, and packaging tests under `test/`

No preload file, persisted-settings schema, database migration, or new renderer window is expected.

## Validation Plan

### Automated

- adapter capability, lifecycle, stale-target, failure, and callback tests;
- presenter native/unavailable selection and exclusive frame-routing tests;
- route and event schema tests;
- renderer native/no-DOM, unavailable activation, and run-scoped dismiss tests;
- ASAR configuration and platform-aware `afterPack` tests;
- existing `YoBrowserPresenter` and `AgentBrowserPiP` regression suites.

Required implementation checks:

```text
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:main
pnpm run test:renderer
pnpm run build
```

### Manual

For each supported native platform:

1. Start an Agent-owned YoBrowser run while the Browser panel is closed.
2. Confirm one native PiP appears only after a current frame exists.
3. Drag it fully beyond every DeepChat window edge.
4. Continue dragging while the page snapshot updates.
5. Double-click and verify the same page opens in the Browser panel without reload.
6. Close the panel and verify native preview resumes without a stale flash.
7. Use hide and verify only the current run stays dismissed.
8. Start a later run and verify PiP can appear again.
9. Exercise blur, minimize, display change, session switch, page close, and app quit.

For each unavailable platform, verify Browser opens the existing side panel and Computer Use
continues without PiP.

## Rollout and Rollback

Keep the renderer frame path source-compatible, but do not select it after native capability
failure.

If performance or native stability misses the gate, disable native PiP with the same source-specific
behavior. Full rollback removes the adapter, dependency, and packaging rule without touching page
ownership or stored data.

## Complexity Limits

- Do not introduce a native-provider registry.
- Do not expose NativeKit through preload.
- Do not call NativeKit window/app discovery APIs.
- Do not add an Electron toolbar companion window.
- Do not add a frame queue, worker pipeline, shared texture experiment, or new video dependency.
- Do not force X11 on native Wayland sessions.
- Do not absorb the deferred browser multi-tab or Fit-desktop work into this migration.
