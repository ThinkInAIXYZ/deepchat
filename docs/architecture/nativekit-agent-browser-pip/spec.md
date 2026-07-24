# NativeKit Agent Browser PiP Migration Spec

## Status

Implemented on 2026-07-23. DeepChat now prefers NativeKit for the Agent browser PiP on supported
runtimes and retains the renderer Canvas as the compatibility fallback.

The dependency was upgraded from 0.5.1 to 0.5.2 on 2026-07-23. Version 0.5.1's published macOS
arm64 and x64 binaries declared macOS 15.0 as their deployment target. Version 0.5.2 corrects both
prebuilds to macOS 12.0, matching DeepChat and Electron 40's Monterey floor without changing the
NativeKit API or published architecture matrix.

The dependency was then upgraded to 0.5.4 on 2026-07-23. Version 0.5.3 fixes macOS manual
placement by recording `NSWindowDidMove` after AppKit's asynchronous native drag begins; image
refreshes no longer restore the anchor. Version 0.5.4 adds host-embedded dragging under
`xwayland-satellite`. The public API, five-prebuild architecture matrix, and macOS 12.0 deployment
floor remain unchanged.

The dependency was upgraded to 0.5.5 on 2026-07-23. That packaging-only release renamed every
published N-API binary from `nativekit.napi.node` to `node.napi.node`. This fixed x64 lookup, but
`@electron/rebuild` maps arm64 to the `armv8` prebuild tag and still fell back to a source build on
macOS and Linux arm64.

Version 0.5.6 corrects the arm64 packages to `node.napi.armv8.node`, retains `node.napi.node` for
x64, and verifies each CI artifact through prebuild-only `node-gyp-build` resolution. The runtime
API and five-target capability matrix remain unchanged.

Version 0.6.0 replaces the fixed hide/relocate controls with up to two caller-configured controls.
NativeKit renders the configured icons and emits the caller's control ID without assigning product
semantics. Root-level panels now size and anchor against the display work area instead of the host
bounds; the host-bounded `xwayland-satellite` compatibility path remains constrained.

Version 0.6.1 adds a fixed-style custom toolbar. DeepChat supplies transparent PNG template images
for the open-panel and close buttons, while NativeKit owns platform-native geometry, fixed
light/dark colors, hover, pressed feedback, scaling, and contrast. DeepChat uses the fixed dark
style and larger 16 x 16 masks so the buttons remain visible over arbitrary light or dark page
content rather than matching the unrelated application chrome.

Version 0.6.2 fixes the macOS toolbar background after AppKit ignored `NSButton.bezelColor` for
the circular bezel. NativeKit now draws a style-aware layer background and border behind the
template image while retaining native button input, tooltip, accessibility, hover, and pressed
behavior. The JavaScript API and five-prebuild architecture matrix remain unchanged.

Automated integration, a real NativeKit addon smoke test, and a packaged macOS arm64 build are
complete. Cross-platform interaction runs and the 60/120 Hz latency gates remain release QA work;
they are tracked explicitly in `tasks.md` and are not implied by implementation completion.

The migration pins `@zerob13/nativekit` to exactly `0.6.2`. The reviewed source is tag
[`v0.6.2`](https://github.com/zerob13/nativekit/tree/v0.6.2), commit `b40e63d`. The npm registry
exposes `0.6.2` with Electron `>=28.0.0` and Node `>=18` compatibility.

This architecture supersedes only the user-facing PiP surface and frame-delivery path in
`docs/features/agent-browser-pip/spec.md`. The existing Agent-page ownership, fixed background
viewport, read-only preview, panel handoff, run-scoped dismissal, and single-page identity
contracts remain in force. The current renderer Canvas remains the compatibility fallback.

GitHub issue sync was not requested and was not performed.

## Counterpoint

The NativeKit path will make panel dragging fluid and allow the panel to leave the DeepChat window.
The reviewed implementations move the native window directly inside AppKit, Win32, or XCB and do
not route drag samples through renderer state or IPC.

That confirmed window-motion result is separate from the remote page's content refresh rate.
NativeKit 0.6.2 still accepts complete PNG/JPEG data URLs through a synchronous
`overlay.pushImage()` call, decodes each image natively, and exposes no shared texture, raw-buffer
stream, partial update, or animation API.

The migration therefore guarantees native, out-of-window movement while describing page freshness
honestly as a bounded snapshot stream rather than 60 FPS browser video.

## Current Engineering Brief

### Target

- User-visible behavior: show a read-only Agent browser preview without forcing the Browser panel
  open, and let the user move or dismiss it without disrupting the Agent.
- Current renderer owner: `AgentBrowserPiP.vue`, mounted by `ChatTabView.vue`.
- Current main-process owner: `YoBrowserPresenter`.
- Trigger path: renderer session, side-panel, and window state derive
  `capturing | rendering | stopped`, then call `browser.setPreviewMode`.
- Existing native page: one `WebContentsView` reparented into a transparent off-screen
  `BaseWindow` at 1280 x 800 while the panel is closed.

### Current Hot Path

```text
Agent WebContentsView at 1280 x 800
  -> webContents.capturePage()
  -> NativeImage.resize(480 x 300)
  -> JPEG quality 72 Buffer
  -> typed main-to-renderer event
  -> structured clone / Uint8Array
  -> Blob
  -> createImageBitmap()
  -> Canvas resize + drawImage()
  -> Vue DOM card, toolbar, halo, and pointer drag
```

Active capture is currently capped at 4 FPS and idle capture at 1 FPS. There is one capture in
flight, so frames do not queue.

### Diagnosis

The expensive and fragile part is not the background page or `capturePage()`. It is the second
half of the path:

- every frame crosses into the chat renderer;
- the renderer allocates and decodes another image object;
- Canvas replacement participates in the chat renderer's paint/compositing work;
- pointer dragging updates Vue state and layout inside the conversation;
- the PiP disappears with the app content region and cannot use native work-area clamping.

The correct ownership layer for the floating surface is the Electron main process plus NativeKit.
The renderer should retain only eligibility coordination and the compatibility Canvas.

## User Need

When an Agent operates YoBrowser in the background, the user needs a preview that:

- moves with direct native input instead of renderer pointer events;
- does not compete with chat rendering and scrolling;
- keeps the same live Agent page and CDP target;
- remains read-only and cannot forward input to the remote page;
- opens the existing Browser panel on deliberate activation;
- dismisses only the current run;
- fails safely on platforms where NativeKit 0.6.2 cannot provide an overlay.

## Goals

- Use exact dependency version `@zerob13/nativekit@0.6.2`.
- Make NativeKit the preferred PiP surface on its supported runtime matrix.
- Allow the PiP to be dragged anywhere inside the current display work area, including completely
  outside the DeepChat window.
- Keep the existing 1280 x 800 focusless render host and the same page `WebContentsView`.
- Send completed JPEG frames directly from `YoBrowserPresenter` to NativeKit without renderer frame
  delivery on the native path.
- Let AppKit, Win32, or XCB own drag, work-area clamping, z-order, and native panel controls.
- Preserve one in-flight capture, epoch/run validation, last-valid-frame retention, and bounded
  image size.
- Preserve the current Canvas PiP as a graceful fallback instead of forcing Linux onto X11 or
  breaking Windows arm64.
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

## NativeKit 0.6.2 Contract

### Useful API

| API | DeepChat use |
| --- | --- |
| `overlay.start({ toolbar })` | Configure a high-contrast dark toolbar with **Open in panel** then **Close** |
| `overlay.attachHost()` | Bind one chat `BrowserWindow` by content bounds and native handle |
| `overlay.setMaxSize(360)` | Render the 480 x 300 source in a sharper 360 x 225 DIP panel |
| `overlay.pushImage()` | Create or replace the active Agent browser JPEG |
| `overlay.setActiveSession()` | Keep the current logical Agent session first before showing |
| `overlay.setVisible()` | Hide without deleting the current presentation during temporary ineligibility |
| `overlay.removeImage()` | Clear a terminal, destroyed, or replaced presentation |
| `overlay.detachHost()` | Release a closed chat window |
| `overlay.stop()` | Release all native resources during presenter shutdown |
| `activate` | Double-click intent to focus DeepChat and open the existing Browser panel |
| `control` | Configured control ID, mapped to open-panel or current-run dismissal |

`suppressSessions`, `completeSession`, app-icon lookup, and system-window query are not required for
this migration. One visible PiP and one current target make them unnecessary.

### Runtime Characteristics

- Main-process only; the package must never be imported by renderer or preload code.
- Node-API v8 prebuilds; Electron 40.10.5 is within the declared peer range.
- `pushImage()` accepts a PNG/JPEG base64 data URL, not a `Buffer`.
- Calls are synchronous at the JavaScript boundary.
- macOS decodes and updates an `NSPanel` on the main thread.
- Windows synchronously marshals the update to its STA overlay thread, decodes through WIC, and
  presents with `UpdateLayeredWindow`.
- Linux synchronously updates its dedicated XCB overlay thread and decodes through GdkPixbuf.
- Dragging stays inside the platform implementation and emits no renderer `mousemove` IPC.
- Movement and transitions are immediate; 0.6.2 has no animation API.
- The native `control` event carries the caller-defined ID but no presentation ID. This is safe
  only while DeepChat enforces the one-visible-PiP invariant.

### Published Capability Matrix

| Runtime | Preferred surface | Reason |
| --- | --- | --- |
| macOS arm64/x64 | Native overlay | Published prebuild; non-activating `NSPanel` |
| Windows x64 | Native overlay | Published prebuild; owned layered topmost `HWND` |
| Windows arm64 | Canvas fallback | NativeKit 0.6.2 publishes no win32-arm64 prebuild |
| Linux x64/arm64 under X11/integrated XWayland | Native overlay | Published prebuild and global XCB window model |
| Linux x64/arm64 under `xwayland-satellite` | Native overlay | 0.5.4 embeds the XCB panel in the Electron host; dragging is clipped to host bounds |
| Linux native Wayland | Canvas fallback | No global positioning or compatible X11 window handle |
| Missing/corrupt addon or native startup failure | Canvas fallback | App startup and Agent tools must remain usable |

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
                                resize 480 x 300 / JPEG 72
                                             |
                         +-------------------+-------------------+
                         |                                       |
                 native capability                        fallback capability
                         |                                       |
                         v                                       v
              JPEG Buffer -> base64 data URL          typed preview-frame event
                         |                                       |
                         v                                       v
              @zerob13/nativekit overlay              existing Vue Canvas PiP
                         |
               AppKit / Win32 / XCB panel
```

### Ownership

#### `YoBrowserPresenter`

- remains authoritative for page, run, render-host, capture epoch, and preview mode;
- validates the sender's `BrowserWindow` and current Agent run;
- selects `native-overlay`, `renderer-canvas`, or `none`;
- branches completed frames to exactly one surface;
- stops capture and clears the surface on every existing lifecycle edge.

#### `AgentBrowserNativeOverlay`

A focused main-process adapter owns only:

- dynamic package loading and one-time capability detection;
- `overlay.start()` / `stop()` lifecycle;
- one active host and one active presentation;
- host move/resize/close synchronization;
- JPEG `Buffer` to data-URL conversion;
- prepaint-before-show ordering;
- mapping NativeKit `activate` and configured `control` IDs to the current logical
  `{ sessionId, runId, windowId }`;
- timing counters around synchronous native calls.

It is not a general Presenter, registry, plugin system, or cross-native abstraction.

#### Renderer

`AgentBrowserPiP.vue` keeps:

- current-session, panel, run, and window eligibility derivation;
- the existing `setPreviewMode` request coalescing;
- current Canvas rendering and drag only when main selects `renderer-canvas`;
- handling typed native actions for open-panel and run dismissal.

On `native-overlay`, it renders no PiP DOM and receives no frame bytes.

## Surface Selection Contract

`browser.setPreviewMode` returns:

```ts
type BrowserPreviewSurface = 'native-overlay' | 'renderer-canvas' | 'none'

type BrowserPreviewModeResult = {
  updated: boolean
  surface: BrowserPreviewSurface
}
```

Selection is process-stable after NativeKit initialization:

1. Dynamically import `@zerob13/nativekit`.
2. Start the overlay and keep it globally hidden.
3. On the first eligible host, validate `attachHost()` with the real
   `BrowserWindow.getNativeWindowHandle()`.
4. Use `native-overlay` after both steps succeed.
5. Otherwise record one redacted capability warning and use `renderer-canvas` for the process.

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
- 480 x 300 output;
- 360 x 225 maximum native panel size, downsampling the 480 x 300 frame for a sharper preview;
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

NativeKit 0.6.2 defines the native interaction surface:

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

### Compatibility fallback

```text
Windows arm64 / native Wayland / unavailable addon
  -> keep the existing in-conversation Canvas card and controls
```

## Lifecycle Matrix

| Event | Native action | Page action |
| --- | --- | --- |
| Eligible capture starts | Attach/update host; push current frame; show | Keep in 1280 x 800 render host |
| New frame | Replace same presentation only; preserve manual origin | No reparent |
| Browser panel opens | Hide presentation; stop capture | Reparent same View into panel |
| Browser panel closes during eligible run | Push current frame before show | Reparent into render host |
| Native **Close** control | Hide, remember run dismissal | Keep render host; stop capture |
| Native **Open in panel** control | Focus host; request Browser panel | Reparent after stable bounds |
| Native double-click | Focus host; request Browser panel | Reparent after stable bounds |
| Host moves/resizes/display changes | Debounced `attachHost()` refresh | No page change |
| Host blur/hide/minimize | Hide synchronously | Keep rendering only if Agent still needs it |
| Host refocus | Re-evaluate; push-before-show | No reload |
| Run terminal | Remove presentation | Stop capture; release render host |
| Session/page destroyed | Remove presentation | Destroy existing page resources |
| Host closed | Remove presentation; detach host | Clear target |
| App shutdown | `overlay.stop()` once | Existing presenter shutdown |

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

### Page freshness

- active Agent activity: target at most 8 FPS, scheduled 125 ms after the previous full cycle;
- idle page: 1 FPS;
- never queue or overlap captures;
- warm eligible-to-first-visible-frame p95: at most 300 ms;
- active end-to-end frame age p95: at most 250 ms;
- `overlay.pushImage()` p95: at most 8 ms and p99: at most 25 ms on the supported reference
  platform;
- no main-process task longer than 50 ms attributable to PiP frame presentation.

The initial implementation may fall back to the current 4 FPS active cap if the synchronous
NativeKit decode/present gate fails. It must not raise the cap above 8 FPS with NativeKit 0.6.2.

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

- Add exact dependency `"@zerob13/nativekit": "0.6.2"`.
- Mark `@zerob13/nativekit` as a disallowed install-time build in `pnpm-workspace.yaml`; published
  prebuilds are resolved at runtime, and unsupported targets must fall back instead of compiling a
  local addon.
- Keep it external to the Electron main bundle so `node-gyp-build` resolves the packaged native
  addon.
- Unpack `node_modules/@zerob13/nativekit/prebuilds/**/*` from ASAR.
- Verify `node.napi.armv8.node` after packaging for darwin-arm64 and linux-arm64, and verify
  `node.napi.node` for darwin-x64, win32-x64, and linux-x64.
- Do not make win32-arm64 packaging fail; that target intentionally uses Canvas fallback with
  version 0.6.2.
- Do not source-build the addon as part of a normal DeepChat release.
- A missing supported prebuild is a packaging failure. An unsupported runtime is a capability
  fallback.

No persisted data or settings schema changes are required.

## Rollback

Rollback is code-local:

1. select `renderer-canvas` unconditionally;
2. stop loading NativeKit;
3. remove the exact dependency and ASAR rule after confirming no other consumer exists.

The browser page, routes, render host, capture format, and Canvas implementation remain compatible,
so rollback does not navigate pages, migrate user data, or change stored settings.

## Failure Semantics

- Dynamic import or `overlay.start()` failure: log once and use Canvas for the process.
- First real-host `attachHost()` failure: mark the native capability unavailable and use Canvas.
- Frame capture/resize/encode failure: retain the previous frame and retry on the next bounded tick.
- `pushImage()` failure: NativeKit transactionally retains its previous presentation; log a
  rate-limited warning and retry.
- Stale frame after mode/run/window change: drop before `pushImage()`.
- Native action with no current logical target: ignore.
- Panel activation timeout: keep or restore the native PiP; never lose the live page.
- Host close or addon shutdown: cleanup is idempotent.
- Fallback Canvas failure: preserve the existing last-frame and placeholder behavior.

## Acceptance Criteria

- Supported platforms load exactly NativeKit 0.6.2 and use its native overlay.
- Windows arm64, native Wayland, and unavailable-addon cases keep the existing Canvas PiP.
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
- Frame delivery passes the stated latency and synchronous-call budgets, or active capture remains
  capped at 4 FPS.
- The packaged app contains the correct prebuild on every supported target.
- Renderer/preload security boundaries remain unchanged.
- Existing Canvas PiP tests remain as fallback coverage; native adapter, presenter selection,
  action mapping, packaging, and packaged smoke tests are added.
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, typecheck, focused tests, build, and packaged
  platform checks pass after implementation.

## Implementation Evidence

Recorded on 2026-07-23:

- `@zerob13/nativekit` is pinned to `0.6.2`, remains external to the main bundle, and its prebuilds
  are unpacked from ASAR.
- NativeKit 0.6.2 configures a fixed dark custom toolbar with larger caller-provided transparent
  PNG templates for `open-panel` and `close`, emits their IDs through `control`, sizes the native
  panel to 360 x 225 DIP, and keeps root-level sizing independent of host bounds.
- The published 0.5.5 tarball uses `node.napi.node` for all five prebuilds. This matches
  `@electron/rebuild` on x64, but its arm64 lookup requires `node.napi.armv8.node`; the missing
  match caused the Linux arm64 install to fall back to `node-gyp` and fail on unavailable X11
  development packages.
- NativeKit 0.5.6 uses the architecture-specific filenames expected by `@electron/rebuild`:
  `node.napi.armv8.node` for arm64 and `node.napi.node` for x64.
- Installing the published 0.6.0 package on macOS arm64 completes
  `electron-builder install-app-deps`, resolves the arm64 prebuild with `PREBUILDS_ONLY=1`, and
  creates no NativeKit `build/Release` fallback binary.
- The published 0.6.1 package resolves from the registry with the reviewed custom-toolbar types.
  Platform addon and packaged application validation are delegated to CI.
- The published 0.6.2 package contains the reviewed macOS contrast fix and all five expected
  prebuilds. ARM64 uses `node.napi.armv8.node`; x64 uses `node.napi.node`.
- The published 0.5.4 macOS arm64 and x64 binaries both report `minos 12.0`; the previous 0.5.1
  prebuilds reported `minos 15.0`.
- A real Electron smoke test loaded NativeKit 0.5.4 and completed
  `start -> attachHost -> pushImage -> removeImage -> detachHost -> stop`.
- A published-prebuild regression run moved the macOS panel to `(180, 420)` while replacing the
  same presentation every 250 ms. The panel remained at `(180, 420)` after three seconds, proving
  image refresh no longer restores the top-right anchor.
- The upstream v0.5.4 Electron demo was reviewed and its smoke run passed. DeepChat follows its
  main-process sequence of `start -> attachHost -> pushImage -> setActiveSession -> setVisible`,
  refreshes the host after move/resize, handles `activate` and configured controls, and stops the
  overlay on shutdown. DeepChat runs the selection/show tail only for the first frame; later
  refreshes use only the demo's stable-identity `pushImage` update. DeepChat reuses its existing
  typed route/event bridge instead of adding the demo's dedicated preload API.
- A macOS arm64 directory package completed, and
  `app.asar.unpacked/node_modules/@zerob13/nativekit/prebuilds/darwin-arm64/nativekit.napi.node`
  was present, byte-identical to the installed 0.5.4 prebuild, and reported `minos 12.0`. The
  packaged DeepChat executable and `LSMinimumSystemVersion` also report macOS 12.0.
- Focused NativeKit adapter, packaging configuration, and Canvas fallback tests pass all 23 tests,
  including configured control mapping and unknown-control rejection.
- After merging `origin/dev` at `011407ab6`, the merge-focused suite passes all 90 tests and the
  current full main suite passes 405 files and 4,636 tests, with 19 files and 233 tests skipped.
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm run build` pass.
- The full renderer suite reaches 173 passing files and 1,328 passing tests, but its existing
  `App.startup.test.ts` mock returns `undefined` from `initAppStores()` while production chains
  `.then()`. That baseline mismatch leaves 15 unrelated startup tests failing and is outside this
  migration.
- Windows, Linux, macOS x64, native Wayland fallback, out-of-window visual interaction, and
  60/120 Hz performance measurements remain unverified on physical target environments.

## Resolved Decisions

- NativeKit version is exactly 0.6.2.
- Native movement is the primary smoothness win; the page remains a bounded snapshot stream.
- The current Canvas is retained only as a compatibility fallback.
- Linux display backend is not forced.
- NativeKit's caller-configured toolbar is used; no companion Vue/native toolbar window is added.
- One visible PiP makes NativeKit's unscoped action callbacks safe.
- Existing foreground-window visibility policy is preserved.
- No implementation-blocking clarification markers remain.
