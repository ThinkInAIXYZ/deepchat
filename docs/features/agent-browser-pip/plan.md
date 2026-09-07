# Agent Browser Surfaces and Picture-in-Picture Implementation Plan

## Status

The read-only mirror revision is implemented. The workspace/tab and Fit-desktop sections below
remain future architecture work if visible multi-tab automation becomes necessary. Packaged
Windows and Linux validation remains open.

## Delivery Strategy

Implement lifecycle identity and the single-parent placement controller before rendering PiP or
adaptive page modes. A floating UI built on the current one-page/session model would encode the
wrong ownership and would race the existing panel attach/detach logic.

```text
LoopRun.runId
    |
    v
Tool execution context -> YoBrowserToolHandler
    |                         |
    | begin/end run           | touches Agent tab
    v                         v
Browser workspace ------> placement controller
                              |       |       |
                              v       v       v
                            panel    PiP    detached
```

## Architecture Changes

### 1. Propagate the Agent run identity

Extend the internal `ToolCallOptions`/execution context with `runId` and pass it from each
`LoopRun` through the tool batch/deferred tool paths, `ToolService`, `AgentToolManager`, and
`YoBrowserToolHandler`.

Add an explicit browser lifecycle port with idempotent methods equivalent to:

```ts
beginAgentBrowserActivity(sessionId, runId, toolCallId)
finishAgentRun(sessionId, runId, outcome)
```

The first method marks/touches the Agent tab immediately before a browser command. The second is
called from the central terminal path for completed, failed, aborted, and superseded runs. It must
also run during session teardown.

Do not subscribe to coarse renderer session status as a substitute. The runtime already owns the
exact identity and terminal boundary.

### 2. Migrate one-page state to a browser workspace

Refactor `YoBrowserPresenter` from `Map<sessionId, SessionBrowserState>` to a workspace that owns:

- a tab map and order;
- selected panel tab ID;
- primary Agent tab ID;
- active Agent run ID and last touched Agent tab ID;
- current host window/session activation state;
- panel and conversation bounds;
- Browser-surface visibility;
- PiP container/chrome state and current position;
- dismissed PiP run ID;
- a serialized placement operation queue.

Keep `BrowserTab` as the page/CDP abstraction. Add owner/run/placement metadata around it rather
than teaching it UI policy.

Preserve existing callers with an internal compatibility step: session-level navigation methods
resolve the relevant user or Agent active tab, while new typed tab methods are added for panel UI.
Remove the compatibility layer after all call sites and tests migrate; do not maintain duplicate
long-term APIs.

### 3. Create the single placement controller

Add one main-process function that computes desired placement from workspace state and performs all
native parent changes. No renderer component may call low-level attach/detach independently after
migration.

Responsibilities:

1. Reject stale layout/activation versions.
2. Evaluate the eligibility predicate.
3. Select the latest current-run Agent tab for PiP.
4. Detach its page from the old parent.
5. Attach it to the panel root or PiP container, or leave it detached.
6. Set the page and chrome bounds.
7. Move/rebound the activity overlay.
8. Publish final placement/status.

Use a per-workspace promise queue or equivalent narrow serialization. Avoid a general state-machine
library.

### 4. Build the read-only mirror pipeline

Create one focusless render-host `BaseWindow` lazily for each active Agent page that needs
background rendering. Reparent the existing page `WebContentsView` into it at 1280 x 800. The host
must be transparent, offscreen, non-focusable, excluded from taskbar/Mission Control, and destroyed
after the page returns to panel or no longer needs background rendering.

Use `webContents.capturePage` because the Electron 40.10.5 macOS feasibility spike showed that
`beginFrameSubscription` produced no frames for this WebContentsView while capture succeeded from a
technically visible transparent host. Limit capture to one in-flight request, resize in main to the
PiP output size, encode in memory, and publish a typed binary frame event. Never write frames to
disk.

The existing Vue PiP component owns a Canvas, read-only activity halo, title, and controls. Decode a
new frame completely before drawing it so the previous Canvas pixels remain visible during capture,
handoff, and loading. The remote page never receives PiP input.

### 5. Centralize renderer layout reporting

Move browser placement facts out of the current panel-only attach/detach watcher. A renderer
controller near `ChatTabView.vue` reports:

- active session ID and sender webContents identity;
- current conversation content rectangle;
- panel rectangle;
- side-panel open state and active surface;
- monotonically increasing layout version.

Use VueUse `useResizeObserver` and `useEventListener` for mechanical observation. Keep the existing
stable-rectangle wait for panel transitions, but make it a layout readiness signal rather than
direct native attachment ownership.

Validate every report in main against the sender's BrowserWindow and current activated session.

### 6. Add panel tabs

Migrate `YoBrowserStatus` from a single `page` to `tabs`, `activeTabId`, and placement data. Add
typed operations to create/select/close tabs and navigate the selected user tab.

Refactor `BrowserPanel.vue` into:

- a compact tab strip using existing shadcn-vue Button/Tooltip patterns;
- navigation controls bound to the selected tab;
- the native page placeholder/bounds container;
- no direct destroy-on-session-switch policy.

User link navigation explicitly creates/selects a user tab and may keep opening the Browser panel.
Agent tools resolve the primary Agent tab. A popup inherits its opener's ownership.

Retain inactive workspace pages after loop completion for inspection. Add no speculative persistent
tab database in V1; state remains process-lifetime only. If memory becomes a measured problem, add a
separate idle eviction policy after profiling.

### 7. Make Browser chrome container-responsive

Refactor the Browser panel's fixed toolbar into width-aware chrome owned by `BrowserPanel.vue` or a
focused child component:

- wide: full tab strip and navigation controls;
- compact: scrollable tabs, icon controls, flexible address field, overflow menu;
- narrow: active title/host, essential navigation, and overflow commands;
- expanded: full controls with a restore-chat action.

Prefer CSS/container queries and normal flex/grid layout. Keep one `ResizeObserver` at the surface
owner only for native bounds/reporting; do not create breakpoint watchers per tab. Reuse shadcn-vue
Button, Tooltip, DropdownMenu, and Tabs-compatible semantics where they fit.

Generalize the existing Workspace fullscreen shell state into a narrow side-panel surface mode that
can be `normal` or `expanded` for either Workspace or Browser. Keep this local to the
`ChatSidePanel`/route shell rather than adding global persisted state.

Fix target-session compatibility by deriving the user-agent Chromium version from the runtime and
keeping desktop semantics at every surface width.

### 8. Add page presentation policy and feasibility proof

Add per-tab `presentationMode: 'responsive' | 'fit-desktop'` to main-process workspace state.
Responsive mode uses real content bounds and 100% zoom.

Before implementing Fit desktop, build a throwaway proof comparing:

- `webContents.enableDeviceEmulation` with `viewSize` and `scale`;
- `webContents.setZoomFactor`/zoom level with its documented same-origin propagation.

Test a fixture matrix containing responsive layouts, fixed 1024/1280 px layouts, sticky/fixed
elements, iframes, canvas, editors, forms, context menus, and long pages. Verify renderer mouse/wheel
input, CDP input, screenshot dimensions, DOM coordinates, selection, navigation, panel/PiP movement,
and reset behavior.

Select no fit API until the proof produces one coordinate model for both the user and Agent. If
neither path is reliable, ship Responsive plus Expand and defer Fit desktop.

### 9. Implement PiP commands

#### Dismiss

Validate that the command's workspace/tab/run still matches, set `dismissedPipRunId`, and recompute.
Do not navigate, close, or interrupt tools.

#### Open in panel

Publish a renderer intent to open/activate Browser and select the Agent tab. Keep PiP visible until
the renderer returns stable visible panel bounds, then reparent atomically. If readiness times out,
leave PiP in place.

#### Drag

Use pointer capture on the entire PiP surface except buttons. Treat movement beyond a small
threshold as drag; otherwise toggle the controls. Keep drag and clamping renderer-local because the
PiP is now ordinary DOM inside the already-clipped conversation region. Avoid writing settings in
V1.

### 10. Integrate foreground/session lifecycle

Combine existing BrowserWindow focus/show/hide/resize/close listeners with typed session activation
events. Also handle minimize/restore explicitly.

On deactivation or loss of foreground:

- detach PiP synchronously;
- hide activity overlay;
- retain run/tab state.

On valid reactivation, recompute from current facts. On terminal run, clear active run state and
detach. On session destruction, destroy every page and the local chrome.

### 11. Adapt the activity overlay

First, make `YoBrowserOverlayWindow.updateBounds` accept the page-content bounds produced by the
placement controller for both panel and PiP. Cross-platform test z-order, pointer pass-through,
focus, movement, and rounded clipping.

If it cannot reliably follow nested PiP, replace only the activity drawing surface with a trusted
local child view in the PiP container. Do not replace it preemptively and do not create a second
remote page.

## Implementation Phases

### Phase 0: interaction decisions

- Confirm PiP close suppresses only the current run.
- Confirm one retained Agent tab per session.
- Confirm behavior while a run waits for permission/question.
- Confirm Responsive + explicit Fit desktop + Expand as the adaptation model.
- Obtain the reference screenshot or approve a visual baseline.

Resolved requirements:

- when any right-side panel surface is open, each new Agent browser action activates Browser and
  selects the Agent tab;
- if the user returns to Workspace, do not force another switch until the next Agent browser action;
- use a compact activity strip when the conversation cannot fit a usable page card.

Exit criterion: no unresolved product branch changes placement semantics.

### Phase 1: lifecycle and workspace foundation

- Thread `runId` through every immediate and deferred tool path.
- Add explicit browser run finalization.
- Introduce workspace/tab ownership and status contracts.
- Add unit tests for loop/tab ownership and terminal cleanup.

Exit criterion: tests can distinguish user and Agent tabs and hide current-run presentation exactly
at terminal state without any PiP UI.

### Phase 2: placement controller, panel tabs, and responsive chrome

- Centralize layout reports and remove renderer-owned native attachment races.
- Add the single-parent placement controller.
- Add panel tab UI and migrate navigation commands.
- Add container-responsive navigation/tab chrome and Browser expanded mode.
- Replace the stale hard-coded Chromium user-agent version with runtime-derived data.
- Preserve the same page across detach/panel transitions.

Exit criterion: multiple tabs work in the Browser panel and every view satisfies the placement
invariant under stress tests.

### Phase 3: page-presentation proof and PiP surface

- Prove input/screenshot coordinate fidelity for Fit desktop candidates.
- Ship Fit desktop only if one candidate passes; otherwise keep Responsive + Expand.
- Add trusted local chrome and in-window View container.
- Add eligibility, show/hide, drag, dismiss, and open-panel handoff.
- Add size/clamp behavior, accessibility, i18n, and activity indicator.
- Add the compact activity-strip fallback for undersized chat regions.
- Integrate the existing activity overlay.

Exit criterion: the complete acceptance matrix passes in development builds on macOS, Windows, and
Linux.

### Phase 4: resilience and packaged QA

- Test focus, minimize, multiple windows, session switches, route changes, panel animation, window
  resize, display scale, tab/page/chrome crashes, and app shutdown.
- Test simultaneous Agent tool completion and user PiP/panel commands.
- Validate packaged local chrome routing and security settings.
- Profile page retention and native view churn.

Exit criterion: no cross-session frame leak, duplicate attachment, unexpected panel opening, or
tool interruption is observed in packaged builds.

## Expected File Areas

Likely implementation areas, subject to final naming:

- `src/main/agent/deepchat/**` for `runId` propagation and terminal lifecycle calls;
- `src/main/tool/**` and `src/shared/types/tool.d.ts` for internal execution context;
- `src/main/desktop/browser/YoBrowserPresenter.ts` for workspace orchestration;
- focused new files under `src/main/desktop/browser/` for workspace placement and PiP chrome;
- `src/shared/types/browser.ts`, browser routes, and browser events for tab/layout/placement state;
- `src/preload/` for typed commands and a narrow PiP chrome bridge;
- `src/renderer/src/components/sidepanel/BrowserPanel.vue` for tab UI;
- `src/renderer/src/stores/ui/sidepanel.ts` and `ChatSidePanel.vue` for generalized expanded mode;
- a renderer controller near `ChatTabView.vue` for layout facts;
- `src/renderer/src/components/sidepanel/ChatSidePanel.vue` to remove unconditional Agent open;
- `src/renderer/src/i18n/` for visible strings;
- mirrored main and renderer tests.

Avoid coupling this to `src/main/desktop/tab.ts`; standalone browser windows have a different
window/tab lifecycle and do not need Agent PiP policy.

## Contract Migration

Current session-level routes can be migrated in two steps:

1. Expand status with tabs while preserving derived `page` fields temporarily for existing
   renderer callers.
2. Move panel/client callers to explicit `tabId`, then remove the derived single-page fields and old
   attach/detach routes in the same feature branch.

The final architecture must not retain two attachment owners. Route schemas should reject stale tab
IDs and return stable `tab_not_found`, `tab_closed`, `stale_layout`, or `placement_failed` results.

## Test Strategy

### Pure state tests

Use a table-driven reducer/decision function for desired placement. Cover every boolean in the
predicate and every transition in the spec, including dismiss-current-run versus next-run behavior.

### Main-process tests

- single parent across panel/PiP/detached transitions;
- exact page WebContents identity across moves;
- serialized races between bounds, focus, loop finish, and tab close;
- stale sender/layout rejection;
- multiple sessions and windows without cross-session display;
- popup ownership inheritance;
- Agent tab recreation after explicit close;
- chrome/page/host destruction cleanup;
- overlay bounds for both placements.

Wrap native `View` operations behind a narrow testable adapter only where Electron objects cannot be
constructed in Vitest. Do not build a general UI framework.

### Runtime tests

- browser tool receives the exact `LoopRun.runId`;
- immediate and deferred tool execution use the same identity;
- completed, failed, aborted, and superseded runs all finalize once;
- a later run does not inherit dismissal or activity from the prior run;
- permission/question pauses do not appear terminal.

### Renderer tests

- Agent open events do not open a closed panel;
- user navigation still opens the panel intentionally;
- panel tab selection, close, Agent marker, and navigation state;
- layout versioning and stable bounds readiness;
- open-panel handoff timeout keeps PiP rather than losing the page;
- all visible controls have i18n labels and keyboard focus;
- container-width breakpoints preserve the address bar and all commands at minimum panel width;
- expanded/restore focus behavior and page identity;

### Packaged cross-platform tests

- click/focus/input routing between chat, PiP chrome, and remote page;
- responsive, fit-desktop, and expanded rendering across representative site fixtures;
- CDP input and screenshot coordinates at every approved presentation scale;
- drag and clamping at multiple DPI/display scales;
- z-order during panel animation and other overlays;
- focus/blur, minimize/restore, hide/show, and full-screen behavior;
- multiple app windows with different active sessions;
- no PiP outside chat bounds and no flash from an inactive session.

## Performance and Retention

- One retained Agent page per active session is the initial memory budget.
- PiP chrome is lazy and destroyed with its host/workspace.
- Reparent and bound updates do not recreate CDP sessions or reload pages.
- Drag updates are coalesced to one per animation frame.
- Layout reports use equality checks and versions to avoid redundant native calls.
- Browser chrome uses CSS/container layout rather than reactive resize fan-out.
- Presentation scaling is applied only after stable bounds, never on every resize sample.
- Measure retained page memory before adding an eviction abstraction. If needed, prefer a simple
  idle timeout tied to session state over a general cache.

## Rejected Approaches

- **Transparent child BrowserWindow as the user-facing PiP**: platform-dependent movement/focus and
  poor in-chat clipping.
- **Live native WebContentsView inside PiP**: cannot be made reliably read-only and creates focus,
  z-order, and renderer blur/attach feedback loops.
- **Offscreen shared texture**: requires a native graphics module and complicates moving the same
  WebContents back into the visible panel; bounded capture is sufficient for a low-frame-rate
  preview.
- **Second WebContentsView pointing at the same URL**: duplicates navigation, page state, CDP, and
  potentially side effects.
- **Inject controls into the remote page**: unsafe, spoofable, and breaks arbitrary sites.
- **Renderer CSS iframe/webview**: changes the security model and cannot adopt the existing page
  WebContents.
- **Use session `working` status as loop identity**: cannot distinguish runs or terminal races.
- **Always scale narrow pages automatically**: horizontal overflow is not a reliable signal of site
  intent and silent scaling can break readability and Agent coordinates.
- **Use only `setZoomFactor` for per-tab fit**: Chromium zoom is same-origin and may propagate beyond
  the intended tab.
- **Switch to a mobile user-agent in narrow surfaces**: changes site behavior and session/device
  assumptions instead of solving layout.
- **Create one tab per Agent URL load**: unbounded tab growth without a user need.
- **Persist full browser workspace/PiP geometry in V1**: adds restore/migration work before the
  lifecycle is proven.

## Complexity Budget

No new runtime dependency is expected. Use Electron View/WebContentsView/webContents APIs, existing
VueUse helpers, shadcn-vue controls, typed routes/events, and a small placement decision function.
The feature needs one workspace state owner, one surface layout owner, and one placement owner;
additional window managers or state-machine libraries would make correctness harder, not easier.
