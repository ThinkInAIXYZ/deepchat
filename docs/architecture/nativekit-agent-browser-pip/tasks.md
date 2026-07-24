# NativeKit Agent Browser PiP Migration Tasks

## Status

Implementation complete on 2026-07-23. Physical cross-platform interaction and performance QA
remain open.

## Documentation

- [x] Inspect the current PiP renderer, presenter, route, event, test, and packaging paths.
- [x] Review local NativeKit source at tag `v0.5.4`, commit `6e154ea`.
- [x] Review and run the upstream v0.5.4 Electron demo control flow.
- [x] Review the v0.5.5 packaging-only diff and standard N-API prebuild names.
- [x] Correct arm64 prebuild names upstream for `@electron/rebuild` compatibility.
- [x] Verify both published macOS prebuilds target macOS 12.0.
- [x] Confirm the published prebuild and runtime compatibility matrix.
- [x] Record the native movement, out-of-window drag, snapshot-stream, fallback, and lifecycle
      contracts.
- [x] Resolve implementation-blocking architecture decisions.
- [x] Update implementation evidence and status after the migration lands.

## Dependency and packaging

- [x] Add exact dependency `@zerob13/nativekit@0.6.2`.
- [x] Refresh `pnpm-lock.yaml`.
- [x] Disable NativeKit install-time source builds in `pnpm-workspace.yaml`.
- [x] Keep NativeKit external to the Electron main bundle.
- [x] Add the NativeKit prebuild glob to `asarUnpack`.
- [x] Extend `afterPack` validation for supported target tuples.
- [x] Keep Windows arm64 packaging valid with Canvas fallback.
- [x] Add or update packaging configuration tests.

## Native overlay adapter

- [x] Add focused `AgentBrowserNativeOverlay` main-process adapter.
- [x] Dynamically import and start NativeKit without blocking app startup.
- [x] Detect unsupported runtime, import failure, startup failure, and first-host attach failure.
- [x] Enforce one active host, presentation, and logical target.
- [x] Convert bounded JPEG buffers to data URLs only at the native boundary.
- [x] Select the current logical session after push and before show, matching the upstream demo.
- [x] Select/show only on the first frame and keep later refreshes to same-identity `pushImage()`.
- [x] Render the 480 x 300 source in a 360 x 225 DIP native panel.
- [x] Push a current frame before first show and resume.
- [x] Preserve the previous valid image after capture or push failure.
- [x] Map `activate` and configured `control` IDs through the exact logical target.
- [x] Supply larger custom open-panel and close templates through a fixed dark NativeKit toolbar.
- [x] Make hide, remove, detach, listener cleanup, and shutdown idempotent.
- [x] Add synchronous-call timing and rate-limited redacted logging.
- [x] Add adapter unit tests.
- [x] Cover the no-reattach/no-remove/no-re-show steady-state refresh contract.

## Presenter integration

- [x] Initialize and shut down the adapter with `YoBrowserPresenter`.
- [x] Select `native-overlay`, `renderer-canvas`, or `none` process-stably.
- [x] Return the selected surface from `setPreviewMode`.
- [x] Route each completed frame to exactly one surface.
- [x] Revalidate window, session, run, mode, surface, and epoch before presentation.
- [x] Keep one capture in flight and schedule only after presentation finishes.
- [x] Attach the validated owning `BrowserWindow`.
- [x] Debounce host move, resize, and display-bound refresh.
- [x] Hide on blur, hide, minimize, panel open, and preview stop.
- [x] Remove on run terminal, target replacement, page/session destruction, and host close.
- [x] Retain the fixed 1280 x 800 render host and same live page identity.
- [x] Add presenter native/fallback routing and lifecycle tests.

## Contracts and renderer

- [x] Add the shared `BrowserPreviewSurface` result contract.
- [x] Add the typed `browser.preview.action` event contract.
- [x] Update desktop routes and `BrowserClient`.
- [x] Track the acknowledged surface in `AgentBrowserPiP.vue`.
- [x] Render no PiP DOM and decode no frame on the native path.
- [x] Keep the current Canvas UI and frame path unchanged as fallback.
- [x] Validate exact window/session/run before native activate or dismiss handling.
- [x] Open the existing Browser panel on activate.
- [x] Reuse current run-scoped dismissal on hide.
- [x] Add contract, client, and renderer tests.

## Performance and platform QA

- [x] Verify direct native drag has no renderer pointer-move IPC by ownership and native-path tests.
- [ ] Verify the panel can move completely outside DeepChat and remains work-area-clamped.
- [x] Verify a same-identity 4 FPS image stream does not move a native-positioned panel.
- [ ] Measure drag behavior on 60 Hz and 120 Hz macOS displays.
- [ ] Measure warm first-frame p95 at or below 300 ms.
- [ ] Measure active frame-age p95 at or below 250 ms.
- [ ] Measure `pushImage()` p95 at or below 8 ms and p99 at or below 25 ms.
- [ ] Verify no PiP presentation task longer than 50 ms.
- [x] Keep active capture at 4 FPS unless profiling clears an increase, capped at 8 FPS.
- [x] Smoke-test macOS arm64 through the upstream demo and DeepChat addon sequence.
- [ ] Smoke-test macOS x64, Windows x64, and Linux X11/XWayland.
- [x] Verify Canvas fallback selection for Windows arm64 in automated coverage.
- [ ] Verify Canvas fallback on a physical native Wayland session.
- [x] Inspect the macOS arm64 packaged artifact for the correct unpacked prebuild.

## Final validation

- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run focused main and renderer tests.
- [x] Run `pnpm run build`.
- [x] Record automated and macOS arm64 packaged-platform evidence.
- [ ] Confirm all acceptance criteria in `spec.md`.
