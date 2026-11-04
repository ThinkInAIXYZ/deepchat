# NativeKit Agent Browser PiP Migration Spec

## Scope and Ownership

DeepChat pins `@zerob13/nativekit` to `0.6.3`. `AgentPreviewCoordinator` owns one process-global
NativeKit lifecycle and arbitrates one Browser or Computer Use presentation. Browser retains its
page, capture, panel handoff, and **Open in panel** plus **Close** controls; Computer Use supplies
bounded latest snapshots with **Close**.

The addon loads only for a concrete capture/preview request. Missing native capability opens the
existing Browser side panel and suppresses Computer Use PiP. It never blocks application startup or
either Agent tool. The renderer Canvas implementation remains source-compatible but is not the
product fallback for missing native capability.

Agent-page identity, the fixed background viewport, read-only preview, panel handoff, and run-scoped
dismissal follow [Agent Browser PiP](../../features/agent-browser-pip/spec.md). Computer Use's latest-
snapshot behavior follows [its feature contract](../../features/computer-use-snapshot-pip/spec.md).
Physical interaction and performance gates remain in [plan.md](./plan.md).

## Movement and Snapshot Freshness

The NativeKit implementation moves the window directly inside AppKit, Win32, or XCB and does
not route drag samples through renderer state or IPC. Root-level panels use the display work area;
the host-embedded XWayland compatibility path remains clipped to the host.

Native movement is independent of the remote page's content refresh rate.
NativeKit 0.6.3 still accepts complete PNG/JPEG data URLs through a synchronous
`overlay.pushImage()` call, decodes each image natively, and exposes no shared texture, raw-buffer
stream, partial update, or animation API.

The native path assigns panel movement to the platform and delivers content as a bounded snapshot
stream. Out-of-window interaction and latency require target-specific validation.

## User Need

When an Agent operates YoBrowser in the background, the user needs a preview that:

- moves with direct native input instead of renderer pointer events;
- does not compete with chat rendering and scrolling;
- keeps the same live Agent page and CDP target;
- remains read-only and cannot forward input to the remote page;
- opens the existing Browser panel on deliberate activation;
- dismisses only the current run;
- fails safely on platforms where NativeKit 0.6.3 cannot provide an overlay.

## Goals

- Use exact dependency version `@zerob13/nativekit@0.6.3`.
- Make NativeKit the preferred PiP surface on its supported runtime matrix.
- Allow the PiP to be dragged anywhere inside the current display work area, including completely
  outside the DeepChat window.
- Keep the existing 1280 x 800 focusless render host and the same page `WebContentsView`.
- Send completed JPEG frames directly from `YoBrowserPresenter` to NativeKit without renderer frame
  delivery on the native path.
- Let AppKit, Win32, or XCB own drag, work-area clamping, z-order, and native panel controls.
- Preserve one in-flight capture, epoch/run validation, last-valid-frame retention, and bounded
  image size.
- Keep NativeKit out of application startup and load it only for a concrete PiP request.
- When NativeKit is unavailable, open Browser in the existing side panel and suppress Computer Use
  PiP without affecting either Agent tool.
- Hide the native panel synchronously on stale session, panel visibility, host blur/hide/minimize,
  run terminal state, page destruction, or app shutdown.
- Add packaging validation so a supported packaged build cannot silently omit its `.node` prebuild.
- Measure drag behavior, first-frame latency, frame freshness, and synchronous native decode cost
  before calling the migration complete.

## Non-Goals

- Full-frame-rate video, shared textures, WebRTC, or GPU surface sharing.
- Making the remote page interactive inside PiP.
- Placing the live `WebContentsView` inside the native overlay.
- Maintaining a downstream NativeKit fork or install-time binary rename.
- Recreating the current Vue toolbar as a second transparent window above the native panel.
- Forcing all Linux users to launch Electron with `--ozone-platform=x11`.
- Adding multiple simultaneous PiP panels.
- Persisting native panel position across application restarts.
- Completing the deferred multi-tab or Fit-desktop work from the original feature SDD.
- Adding a generic native-capability framework around one NativeKit consumer.

## NativeKit 0.6.3 Contract

### Useful API

| API                          | DeepChat use                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `overlay.start({ toolbar })` | Configure a high-contrast dark toolbar with **Open in panel** then **Close**  |
| `overlay.attachHost()`       | Bind one chat `BrowserWindow` by content bounds and native handle             |
| `overlay.setMaxSize(360)`    | Render the 400 x 250 source in a 360 x 225 DIP panel                          |
| `overlay.pushImage()`        | Create or replace the active Agent browser JPEG                               |
| `overlay.setActiveSession()` | Keep the current logical Agent session first before showing                   |
| `overlay.setVisible()`       | Hide without deleting the current presentation during temporary ineligibility |
| `overlay.removeImage()`      | Clear a terminal, destroyed, or replaced presentation                         |
| `overlay.detachHost()`       | Release a closed chat window                                                  |
| `overlay.stop()`             | Release all native resources during presenter shutdown                        |
| `activate`                   | Double-click intent to focus DeepChat and open the existing Browser panel     |
| `control`                    | Configured control ID, mapped to open-panel or current-run dismissal          |

`suppressSessions`, `completeSession`, app-icon lookup, and system-window query are not required for
this migration. One visible PiP and one current target make them unnecessary.

### Runtime Characteristics

- Main-process only; the package must never be imported by renderer or preload code.
- Node-API v8 prebuilds; packaged dependency validation must cover the pinned Electron runtime.
- `pushImage()` accepts a PNG/JPEG base64 data URL, not a `Buffer`.
- Calls are synchronous at the JavaScript boundary.
- macOS decodes and updates an `NSPanel` on the main thread.
- Windows synchronously marshals the update to its STA overlay thread, decodes through WIC, and
  presents with `UpdateLayeredWindow`.
- Linux synchronously updates its dedicated XCB overlay thread and decodes through GdkPixbuf.
- Dragging stays inside the platform implementation and emits no renderer `mousemove` IPC.
- Movement and transitions are immediate; 0.6.3 has no animation API.
- The native `control` event carries the caller-defined ID but no presentation ID. This is safe
  only while DeepChat enforces the one-visible-PiP invariant.

### Published Capability Matrix

| Runtime                                         | Preferred surface                       | Reason                                                                              |
| ----------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| macOS arm64/x64                                 | Native overlay                          | Published prebuild; non-activating `NSPanel`                                        |
| Windows x64                                     | Native overlay                          | Published prebuild; owned layered topmost `HWND`                                    |
| Windows arm64                                   | Browser side panel; no Computer Use PiP | NativeKit 0.6.3 publishes no win32-arm64 prebuild                                   |
| Linux x64/arm64 under X11/integrated XWayland   | Native overlay                          | Published prebuild and global XCB window model                                      |
| Linux x64/arm64 under `xwayland-satellite`      | Native overlay                          | The compatibility path embeds the XCB panel in the Electron host; dragging is clipped to host bounds |
| Linux native Wayland                            | Browser side panel; no Computer Use PiP | No global positioning or compatible X11 window handle                               |
| Missing/corrupt addon or native startup failure | Browser side panel; no Computer Use PiP | App startup and Agent tools remain usable                                           |

DeepChat will not change the user's Linux display backend merely to enable PiP.

## Target Architecture

```text
                                one live page / one CDP target
                                             |
                                             v
focusless render-host BaseWindow -> Agent WebContentsView at 1280 x 800
                                             |
                                             v
                                   capturePage (one in flight)
                                             |
                                             v
                                resize 400 x 250 / JPEG 72
                                             |
                         +-------------------+-------------------+
                         |                                       |
                 native capability                   native unavailable
                         |                                       |
                         v                              +--------+--------+
              JPEG Buffer -> base64 data URL           |                 |
                         |                              v                 v
                         v                    Browser activate event   Computer Use
              @zerob13/nativekit overlay      -> existing side panel   no PiP
                         |
               AppKit / Win32 / XCB panel
```

### Ownership

#### `YoBrowserPresenter`

- remains authoritative for page, run, render-host, capture epoch, and preview mode;
- validates the sender's `BrowserWindow` and current Agent run;
- selects `native-overlay` or `none` for native capability handling;
- requests the existing Browser side panel when native capability is unavailable;
- branches completed frames to exactly one surface;
- stops capture and clears the surface on every existing lifecycle edge.

#### `AgentPreviewCoordinator`

A focused process-global main-process coordinator owns only:

- dynamic package loading and one-time capability detection;
- `overlay.start()` / `stop()` lifecycle;
- one active host and one active presentation;
- Browser and Computer Use toolbar profile switching;
- latest explicit source claim and shared run-scoped dismissal;
- host move/resize/close synchronization;
- JPEG `Buffer` to data-URL conversion;
- prepaint-before-show ordering;
- mapping NativeKit activation and configured controls to the current source-specific handler;
- timing counters around synchronous native calls.

`YoBrowserPresenter` remains the Browser producer and `ComputerUsePreviewPresenter` remains the
Computer Use producer. The coordinator is not a public preview framework, plugin system, or
cross-native abstraction.

#### Renderer

`AgentBrowserPiP.vue` keeps:

- current-session, panel, run, and window eligibility derivation;
- the existing `setPreviewMode` request coalescing;
- handling typed native actions for open-panel and run dismissal.

On `native-overlay`, it renders no PiP DOM and receives no frame bytes.
On native capability failure, the same typed activation path opens the Browser side panel.

## Surface Selection Contract

`browser.setPreviewMode` returns:

```ts
type BrowserPreviewSurface = 'native-overlay' | 'renderer-canvas' | 'none'

type BrowserPreviewModeResult = {
  updated: boolean
  surface: BrowserPreviewSurface
}
```

Selection is process-stable after on-demand NativeKit initialization:

1. Do not import NativeKit from application startup, Browser background rendering, or Computer Use
   eligibility alone.
2. Dynamically import `@zerob13/nativekit` on the first concrete Browser capture or Computer Use
   target.
3. Start the overlay and keep it globally hidden.
4. On the first eligible host, validate `attachHost()` with the real
   `BrowserWindow.getNativeWindowHandle()`.
5. Use `native-overlay` after both steps succeed.
6. Otherwise record one redacted capability warning, keep the capability disabled for the process,
   open Browser in its existing side panel, and expose no Computer Use PiP.

A transient bad frame does not switch surfaces. NativeKit keeps the previous valid presentation,
and the next bounded capture retries.

## Native Presentation Identity

Only one presentation may be visible:

```text
hostId         = chat-window:<windowId>
presentationId = agent-browser:<windowId>:<sessionId>
native session = agent-browser:<sessionId>
logical target = { windowId, sessionId, runId, captureEpoch }
```

The logical target, not NativeKit's unscoped callback, identifies activate and dismiss actions.
Changing window or session removes the previous presentation before attaching the next host.

The presentation remains allocated but hidden while the Browser panel is temporarily visible or
the host briefly loses eligibility, preserving NativeKit's manual drag position. Terminal run,
session/page destruction, host close, and shutdown remove it.

## Frame Delivery

The existing capture safety rules remain:

- 1280 x 800 source viewport;
- 400 x 250 output;
- 360 x 225 maximum native panel size, downsampling the 400 x 250 frame;
- JPEG quality 72;
- 512 KiB DeepChat frame ceiling, well below NativeKit's 32 MiB input ceiling;
- one capture in flight;
- schedule the next capture only after capture, resize, encode, and presentation finish;
- validate mode, run ID, target window, and epoch immediately before presentation;
- drop stale results without showing them;
- retain the last valid native image when capture or decode fails.

For the native branch:

```text
JPEG Buffer
  -> data:image/jpeg;base64,<Buffer.toString('base64')>
  -> overlay.pushImage()
```

No frame is sent to the renderer on this branch.

The overlay starts hidden. On first show or resume, DeepChat pushes a current frame while hidden and
calls `setVisible(true)` only after `pushImage()` succeeds. This avoids flashing a stale or empty
panel.

The first successful frame also selects the active NativeKit session once. Later image refreshes
call only `pushImage()` with the same host, presentation, and session IDs. They do not repeat
`attachHost()`, `setActiveSession()`, `setVisible(true)`, or any removal operation. NativeKit owns
the manual frame by stable `presentationId`, so an image replacement changes pixels and size only;
it cannot reset a user-dragged origin. Host move/resize synchronization remains a separate,
debounced path.

## Interaction Contract

NativeKit 0.6.3 defines the native interaction surface:

- drag any image area outside the toolbar buttons;
- double-click the image to activate;
- click the configured **Open in panel** button to close the PiP and activate the existing Browser
  panel;
- click the configured **Close** button to dismiss the preview for the current Agent run;
- the panel never becomes the key/main window and never forwards input to the remote page.

DeepChat maps activation to:

1. show and focus the owning chat window;
2. publish a typed `browser.preview.action` event for the exact window/session/run;
3. let the current renderer open the existing Browser panel;
4. stop native capture and reparent the same page View into stable panel bounds.

DeepChat maps **Close** to:

1. mark the logical run dismissed;
2. stop capture and keep the page rendering in the hidden render host;
3. publish the same typed action event so renderer eligibility agrees;
4. allow a later run to show PiP again.

The native path configures NativeKit's two built-in icon types and maps their IDs in DeepChat. It
does not preserve the Canvas-only title toolbar, centered drag affordance, or activity halo.
Recreating those as another overlay would reintroduce the focus, z-order, and cross-window
coordination this migration removes. Native body drag moves the PiP; both the configured button and
native body double-click perform **Open in panel**. Both surfaces remain read-only and never
forward clicks into the remote page.

## UI Layout

### Before: renderer-owned card inside the conversation

```text
+----------------------------------------------------------------+
| DeepChat                                                       |
|                                                                |
| Conversation                         +----------------------+   |
|                                      | Vue toolbar          |   |
|                                      | Canvas page mirror   |   |
|                                      | drag / open / close  |   |
|                                      +----------------------+   |
+----------------------------------------------------------------+
```

### After: native panel in the desktop work area

```text
+------------------------------------------+   +----------------------+
| DeepChat                                 |   | Native PiP           |
|                                          |   |                      |
| Conversation                             |   | Agent page snapshot  |
| Browser panel remains closed             |   |                [▯][×]|
|                                          |   | drag; double-click   |
+------------------------------------------+   +----------------------+
                                                   AppKit/Win32/XCB
```

Controls are configured left-to-right as **Open in panel** then **Close**. The actual NativeKit
symbols are platform-native. The diagram shows structure, not exact icons.

### Native capability unavailable

```text
Windows arm64 / native Wayland / unavailable addon
  -> Browser: open the existing side-panel browser
  -> Computer Use: continue without PiP
```

## Lifecycle Matrix

| Event                                    | Native action                                          | Page action                                 |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| Eligible capture starts                  | Attach/update host; push current frame; show           | Keep in 1280 x 800 render host              |
| New frame                                | Replace same presentation only; preserve manual origin | No reparent                                 |
| Browser panel opens                      | Hide presentation; stop capture                        | Reparent same View into panel               |
| Browser panel closes during eligible run | Push current frame before show                         | Reparent into render host                   |
| Native **Close** control                 | Hide, remember run dismissal                           | Keep render host; stop capture              |
| Native **Open in panel** control         | Focus host; request Browser panel                      | Reparent after stable bounds                |
| Native double-click                      | Focus host; request Browser panel                      | Reparent after stable bounds                |
| Host moves/resizes/display changes       | Debounced `attachHost()` refresh                       | No page change                              |
| Host blur/hide/minimize                  | Hide synchronously                                     | Keep rendering only if Agent still needs it |
| Host refocus                             | Re-evaluate; push-before-show                          | No reload                                   |
| Run terminal                             | Remove presentation                                    | Stop capture; release render host           |
| Session/page destroyed                   | Remove presentation                                    | Destroy existing page resources             |
| Host closed                              | Remove presentation; detach host                       | Clear target                                |
| App shutdown                             | `overlay.stop()` once                                  | Existing presenter shutdown                 |

Although macOS NativeKit panels can join all Spaces, DeepChat preserves the current product policy:
the Agent page preview is hidden when its owning chat window is not foreground. Making it persist
over unrelated applications is a separate product decision.

## Performance Contract

Native feel is split into two measurable promises.

### Native movement

- no renderer pointer-move handler or drag-position IPC on the native path;
- drag, clamping, and z-order are handled inside NativeKit;
- the panel can cross every DeepChat window edge and remains constrained only by the display work
  area;
- capture work must not produce visible drag hitching on 60 Hz or 120 Hz reference displays.

### Page Freshness Acceptance Targets

- active Agent activity: target at most 8 FPS, scheduled 125 ms after the previous full cycle;
- idle page target: 1 FPS;
- never queue or overlap captures;
- warm eligible-to-first-visible-frame p95: at most 300 ms;
- active end-to-end frame age p95: at most 250 ms;
- `overlay.pushImage()` p95: at most 8 ms and p99: at most 25 ms on the supported reference
  platform;
- no main-process task longer than 50 ms attributable to PiP frame presentation.

The current Browser schedule remains 500 ms active and 2000 ms idle after each complete cycle.
Increasing cadence requires the synchronous NativeKit decode/present and physical-display gates;
the current schedule is not evidence that the freshness targets have passed. The target cap must
not exceed 8 FPS with NativeKit 0.6.3.

These are release gates, not runtime promises for arbitrary hardware. The visible claim is
"native movement with a fresh read-only preview," not "native-rate browser video."

## Security and Privacy

- NativeKit is imported only in the Electron main process.
- No NativeKit object, native handle, raw IPC channel, or generic capability is exposed through
  preload.
- Remote page execution remains sandboxed in its existing YoBrowser session.
- The native panel receives only a downscaled JPEG data URL.
- Frames remain in memory and are never logged, cached, persisted, or written to disk.
- Logs contain platform, surface, duration, dimensions, and redacted lifecycle reason only; they do
  not contain image bytes, URL, title, DOM, or session content.
- Main validates the target `BrowserWindow`, session, run ID, mode, and epoch before every show.
- A stale capture cannot replace the current session's panel.
- Host blur/hide/minimize and session deactivation hide the native panel in main, without waiting
  for renderer cleanup.

## Packaging and Compatibility

- Add exact dependency `"@zerob13/nativekit": "0.6.3"`.
- Mark `@zerob13/nativekit` as a disallowed install-time build in `pnpm-workspace.yaml`; published
  prebuilds are resolved at runtime, and unsupported targets must disable native PiP instead of
  compiling a local addon.
- Keep it external to the Electron main bundle so `node-gyp-build` resolves the packaged native
  addon.
- Unpack `node_modules/@zerob13/nativekit/prebuilds/**/*` from ASAR.
- Verify `node.napi.armv8.node` after packaging for darwin-arm64 and linux-arm64, and verify
  `node.napi.node` for darwin-x64, win32-x64, and linux-x64.
- Do not make win32-arm64 packaging fail; that target intentionally uses the source-specific
  unavailable behavior with version 0.6.3.
- Do not source-build the addon as part of a normal DeepChat release.
- A missing supported prebuild is a packaging failure. An unsupported runtime disables native PiP
  without blocking application startup or Agent tools.

No persisted data or settings schema changes are required.

## Rollback

Rollback is code-local:

1. select `renderer-canvas` unconditionally;
2. stop loading NativeKit;
3. remove the exact dependency and ASAR rule after confirming no other consumer exists.

The browser page, routes, render host, capture format, and Canvas implementation remain compatible,
so rollback does not navigate pages, migrate user data, or change stored settings.

## Failure Semantics

- Dynamic import or `overlay.start()` failure: log once and disable native PiP for the process.
- First real-host `attachHost()` failure: mark the native capability unavailable for the process.
- Browser native capability failure: publish the existing activate action and open the side panel.
- Computer Use native capability failure: expose no preview surface and keep tool execution
  unchanged.
- Frame capture/resize/encode failure: retain the previous frame and retry on the next bounded tick.
- `pushImage()` failure: NativeKit transactionally retains its previous presentation; log a
  rate-limited warning and retry.
- Stale frame after mode/run/window change: drop before `pushImage()`.
- Native action with no current logical target: ignore.
- Panel activation timeout: keep or restore the native PiP; never lose the live page.
- Host close or addon shutdown: cleanup is idempotent.

## Acceptance Criteria

- Supported platforms load exactly NativeKit 0.6.3 and use its native overlay.
- Windows arm64, native Wayland, and unavailable-addon cases open Browser in the existing side
  panel and show no Computer Use PiP.
- The preferred path sends no `browser.preview.frame` payload to the renderer.
- The remote page retains the same `WebContents`, `WebContentsView`, session, URL, DOM state,
  scroll state, cookies, and CDP target across native PiP and Browser panel handoff.
- The native panel is read-only, draggable, work-area-clamped, and non-activating.
- The native panel can be dragged completely outside the DeepChat window without snapping back to
  conversation bounds.
- Replacing the image under the same presentation does not reattach, reactivate, re-show, remove,
  or reset the panel's manual position.
- Double-click and **Open in panel** open the existing Browser panel; **Close** dismisses only the
  current run.
- Exactly one native PiP may be visible process-wide.
- First show and resume push a current frame before making the panel visible.
- No stale session/run frame is shown after route, window, or run changes.
- Host blur/hide/minimize, panel open, run terminal, page destruction, and shutdown hide or remove
  the panel deterministically.
- Dragging performs no renderer `mousemove` IPC and passes the native movement QA gate.
- Frame delivery must satisfy the stated latency and synchronous-call budgets before higher
  capture cadence is enabled. The current lower cadence does not close the unverified gates.
- The packaged app contains the correct prebuild on every supported target.
- Renderer/preload security boundaries remain unchanged.
- Tests cover on-demand loading, process-stable disablement, Browser side-panel handoff, Computer
  Use no-surface behavior, native adapter selection, action mapping, and packaging.
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, typecheck, focused tests, build, and packaged
  platform checks pass after implementation.

## Resolved Decisions

- NativeKit version is exactly 0.6.3.
- Native movement is the primary smoothness win; the page remains a bounded snapshot stream.
- NativeKit is never loaded by application startup or eligibility-only state.
- Native capability failure opens Browser in the existing side panel and disables Computer Use PiP.
- Linux display backend is not forced.
- NativeKit's caller-configured toolbar is used; no companion Vue/native toolbar window is added.
- One visible PiP makes NativeKit's unscoped action callbacks safe.
- Existing foreground-window visibility policy is preserved.
- No implementation-blocking clarification markers remain.
