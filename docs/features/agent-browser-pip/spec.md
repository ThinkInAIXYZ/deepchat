# Agent Browser Surfaces and Picture-in-Picture Spec

## Status

V1 mirror revision implemented on 2026-07-17. The first implementation placed the live
`WebContentsView` inside the PiP, which made the preview interactive and introduced a renderer
focus/blur feedback loop. The revised contract keeps the Agent page at a fixed 1280 x 800 render
size and shows a low-frame-rate, read-only Canvas mirror in PiP. A visible multi-tab strip and
Fit-desktop emulation remain deferred. Packaged Windows and Linux validation remains open.

On 2026-07-23, the
[NativeKit 0.6.0 surface migration](../../architecture/nativekit-agent-browser-pip/spec.md) was
implemented. That architecture supersedes this document's renderer-owned PiP surface and
frame-delivery path: supported runtimes use a native, out-of-window draggable panel, while the
Canvas described here remains the compatibility fallback. This document's page ownership, fixed
background viewport, read-only preview, panel handoff, and run-scoped dismissal contracts remain
authoritative.

The referenced screenshot was not available in the current task context, so the interaction and
layout are specified here while exact visual styling remains provisional.

## Problem

Today, any YoBrowser `loadUrl` call publishes `browser.open.requested`, and
`ChatSidePanel.vue` responds by opening and activating the right-side Browser panel. This lets a
background Agent tool unexpectedly take over the user's layout.

YoBrowser also has only one page per chat session. It cannot distinguish a user-opened page from an
Agent automation page or expose multiple browser tabs in the panel.

The current Browser panel is physically constrained to a default width of 520 px and a minimum of
420 px. `BrowserPanel.vue` keeps all navigation controls in one fixed row, while the remote page
receives the exact narrow native view bounds with no presentation-mode choice. Responsive sites may
adapt, but desktop-oriented sites can become horizontally cramped or unusable.

The target session also hard-codes a Chrome/142 user-agent string while the pinned Electron 40.10.5
runtime embeds Chromium 144.0.7559.236. That mismatch is not the main cause of narrow layout, but it
is a compatibility defect and must not become part of a new adaptive-surface design.

The requested behavior is:

- never open a closed right-side panel merely because an Agent uses YoBrowser;
- show the Agent-operated page in the existing Browser panel when that surface is already visible;
- otherwise show it as a draggable in-chat floating preview;
- make the floating preview read-only while the Agent operates the same live page in a normal-size
  background render host;
- move the same live page between the background render host and panel without reload or state
  loss;
- never float user-opened browser pages;
- hide the floating preview when its Agent loop ends, the chat is no longer active/foreground, the
  page is closed, or the Browser panel becomes visible.
- make the Browser panel chrome responsive at its current supported widths;
- give desktop-oriented pages a deliberate wide/fit escape hatch instead of leaving them trapped in
  an unusable narrow viewport.

## V1 Critical Architecture Correction

This section records the shipped V1 Canvas architecture. The implemented NativeKit migration
supersedes the surface constraint below on supported runtimes; it does not change the one-page,
read-only mirror invariant.

The user-facing PiP is not another operating-system window and never contains the remote page's
native View. Electron `View` does not expose a reliable view-level ignore-mouse-input contract, and
native child views sit outside normal Vue DOM hit testing. The trusted chat renderer therefore owns
the complete PiP surface and draws captured frames into a Canvas.

The live Agent `WebContentsView` is temporarily reparented into a focusless render-host
`BaseWindow`. The render host is technically visible so Chromium owns a valid display surface, but
it is transparent, moved offscreen, excluded from taskbar/Mission Control, and never accepts input.
Its page bounds remain 1280 x 800. Opening Browser reparents that exact View into the visible panel.

```text
focusless render-host BaseWindow
+-- Agent page WebContentsView at 1280 x 800
    +-- capturePage -> resize/encode -> typed frame event

host BrowserWindow.contentView
+-- chat renderer WebContentsView
    +-- trusted PiP Canvas mirror and controls
+-- panel placement: the same Agent page WebContentsView when Browser is visible
```

There is still one page `WebContents`, one page `WebContentsView`, and one session. The mirror is
only a transient compressed frame, never a second browser. Moving the page changes only its native
parent and bounds. It does not navigate, clone cookies, recreate CDP, or copy page state.

## Goals

- Preserve the user's panel open/closed choice when an Agent opens a URL.
- Add browser tabs so user and Agent pages have explicit identity and lifecycle.
- Reuse one Agent automation tab per chat session in the first release.
- Track which Agent loop owns the current automation activity by `runId`.
- Put each page view in exactly one native placement: Browser panel, render host, or detached.
- Show at most one PiP for the foreground chat window.
- Keep PiP fully inside the active conversation region and let the user drag it.
- Keep the background Agent viewport at 1280 x 800 while PiP scales only its visual mirror.
- Keep responsive page rendering as the safe default and offer explicit desktop-fit and expanded
  modes for pages that do not work well at narrow widths.
- Let the user dismiss PiP for the current loop without closing or disrupting the automation tab.
- Let the user open the Browser panel and transfer the same page into it.
- Hide PiP deterministically on every loop/session/window/tab lifecycle edge.
- Preserve the existing Agent activity visualization over whichever placement contains the page.

## Non-Goals

- Native video picture-in-picture or `documentPictureInPicture`.
- A free-floating OS window outside the DeepChat window in V1; the implemented NativeKit migration
  supersedes this surface constraint on supported runtimes.
- Multiple simultaneous PiP cards.
- Floating pages created and navigated only by the user.
- Persisting PiP position or size across application restarts in V1.
- Guessing that every horizontally overflowing page should be silently scaled down.
- Pretending to be a mobile browser or changing touch/user-agent semantics merely because the
  surface is narrow.
- Letting the renderer own or directly manipulate remote-page `webContents`.
- Creating a new Agent tab for every `load_url` call.
- A general browser-window/tab architecture shared with standalone DeepChat browser windows.
- Closing the underlying Agent tab when the PiP close button is pressed.
- Forwarding PiP pointer, wheel, keyboard, selection, or focus events to the remote page.
- Full-frame-rate video streaming or a GPU shared-texture/native-module pipeline.

## Current Repository Contract

- `YoBrowserPresenter` owns `Map<sessionId, SessionBrowserState>` with exactly one
  `WebContentsView`, one `BrowserTab`, and one `YoBrowserOverlayWindow` per chat session.
- `YoBrowserToolHandler` can identify the chat session but does not receive the active Agent
  `runId`.
- `BrowserPanel.vue` attaches the single view to bounds reported by the Browser panel and destroys
  inactive-session pages once work stops.
- `sidepanel.ts` clamps the panel to 420-960 px, defaults to 520 px, and caps it at 62% of the
  renderer width.
- `BrowserPanel.vue` uses one fixed navigation row and has no compact toolbar, expanded-browser
  mode, or page-presentation mode.
- `yoBrowserSession.ts` hard-codes Chrome/142 rather than deriving the user-agent version from the
  bundled Chromium runtime.
- `ChatSidePanel.vue` automatically calls `sidepanelStore.openBrowser()` for every
  `browser.open.requested` event.
- `useMarkdownLinkNavigation.ts` intentionally opens the Browser panel for user navigation.
- `LoopRun` and the DeepChat runtime already own a stable `runId`; it is not currently threaded
  through `ToolCallOptions` to YoBrowser.
- `YoBrowserOverlayWindow` is a transparent transient activity effect, not a PiP surface.

## Terminology

- **Browser workspace**: all YoBrowser tabs for one chat session.
- **User tab**: a page explicitly created from user UI. It is never PiP-eligible.
- **Agent tab**: the session's automation page, created or reused by an Agent browser tool.
- **Touched run**: the Agent `runId` that most recently operated an Agent tab.
- **Browser surface visible**: the right-side panel is open and its Browser surface is the active
  panel content.
- **Native placement**: `panel`, `render-host`, or `detached`.
- **Mirror state**: `capturing`, `rendering`, or `stopped`; only `capturing` publishes PiP frames.
- **Presentation mode**: `responsive` or `fit-desktop` for how a page uses the available content
  rectangle.
- **Active session**: the chat route currently activated in the host renderer/webContents.
- **Foreground host**: the containing DeepChat window is shown, not minimized, and focused.

## Browser Tab Model

The current `SessionBrowserState` becomes a per-session workspace:

```ts
type BrowserTabOwner = 'user' | 'agent'
type BrowserPlacement = 'panel' | 'pip' | 'detached'

type YoBrowserTabState = {
  id: string
  owner: BrowserTabOwner
  page: BrowserPage
  view: WebContentsView
  placement: BrowserPlacement
  lastAgentRunId: string | null
  closed: boolean
  createdAt: number
  updatedAt: number
}
```

The public status becomes a tab collection plus `activeTabId`. User commands act on the selected
user-facing tab. Agent tools act on the dedicated Agent tab unless a future tool explicitly accepts
a tab ID.

V1 rules:

- create at most one primary Agent tab per session;
- reuse it across URL loads and across loops until the user explicitly closes it or the workspace
  is destroyed;
- set `lastAgentRunId` before executing every Agent browser tool, not only `load_url`;
- pages opened by an Agent-owned popup inherit Agent ownership and the same touched run, but the
  panel may list them as additional tabs;
- never change a user tab to Agent ownership implicitly;
- if a closed Agent tab is needed by a later browser tool, create a new Agent tab;
- choose only one current Agent tab for PiP, preferring the page touched by the latest tool.

## Responsive Surface Design

There are two different adaptation problems and they must not be conflated:

1. **Browser chrome adaptation** controls DeepChat-owned tabs, buttons, address bar, and PiP header.
2. **Page presentation** controls how the untrusted website interprets and fills its native content
   rectangle.

### Browser chrome breakpoints

Use container width, not the application viewport, because the Browser panel and PiP can have
different widths in the same window.

| Content width | DeepChat chrome behavior |
| --- | --- |
| `>= 640 px` | Full tab strip, back, forward, reload, address bar, presentation, and expand controls |
| `480-639 px` | Scrollable compact tabs, icon navigation, flexible address bar, presentation/expand in overflow |
| `< 480 px` | Active-tab title/host, back, reload, address bar, and one overflow menu; hide nonessential labels |

The address bar remains the flexible element with `min-width: 0`. Tab titles truncate, the tab strip
scrolls horizontally instead of squeezing every tab, and all hidden commands remain keyboard
reachable through the overflow menu.

```text
Wide panel
+----------------------------------------------------------------+
| [User tab] [Agent tab *] [+]                                   |
| [<-] [->] [reload] [ URL                         ] [Fit] [Expand]|
+----------------------------------------------------------------+

Compact panel
+----------------------------------------------+
| [User] [Agent *] ...                         |
| [<-] [reload] [ URL                    ] [...]|
+----------------------------------------------+

Narrow PiP
+--------------------------------------+
| agent · site.example [Panel] [...] [x]|
+--------------------------------------+
```

Use CSS/container-query layout for renderer-owned chrome where possible. Native page bounds still
come from the measured content rectangle.

### Page presentation modes

#### Responsive, default

- The website viewport equals the actual native content bounds.
- Page zoom is 100%.
- CSS media queries, viewport units, and normal responsive behavior work as designed by the site.
- PiP/panel movement changes only bounds after the destination layout is stable.

This is the only mode that can be selected automatically without guessing site intent.

#### Fit desktop, explicit per tab

For desktop-oriented sites, the user can choose **Fit desktop**. YoBrowser presents a wider virtual
desktop viewport and scales it into the available surface. A target virtual width near 1024 CSS px
is a starting hypothesis, not a committed constant.

Implementation must choose between Electron `webContents.enableDeviceEmulation` and a controlled
zoom strategy only after a feasibility proof verifies:

- layout/media-query behavior in panel and PiP;
- text readability and minimum scale;
- mouse, wheel, keyboard, focus, selection, and context-menu coordinates;
- CDP `Input.dispatchMouseEvent` coordinates;
- visible and full-page screenshot dimensions used by Agent tools;
- no per-origin zoom leakage into another tab;
- deterministic reset to Responsive mode after navigation, tab reuse, and view reparenting.

Electron's Chromium zoom policy is same-origin, so `setZoomFactor` must not be assumed to provide
isolated per-tab fit behavior. CDP/device emulation changes CSS viewport coordinates and may affect
Agent screenshots/input. Until the proof passes, the product contract is Responsive plus **Expand**,
not unverified automatic scaling.

Presentation mode belongs to the tab. It survives panel/PiP movement and the current process
lifetime, but is not persisted across app restarts in V1.

### Expanded Browser mode

Add an explicit **Expand** action that temporarily lets the Browser surface occupy the full
`ChatTabView` content area, reusing the existing Workspace fullscreen shell behavior. This is the
reliable escape hatch for complex desktop sites, wide tables, editors, and login flows where a
scaled page would become unreadable.

Expanded mode does not create a new window or page. It changes the side-panel shell geometry, keeps
the same selected tab/view, provides a clear **Restore chat** action, and returns focus to the
originating control.

### Safe adaptation policy

- DeepChat chrome adapts automatically.
- Website viewport stays Responsive automatically.
- DeepChat may detect persistent document-level horizontal overflow and offer **Fit desktop** or
  **Expand**, but it does not silently switch modes based on `scrollWidth` heuristics.
- Recompute native bounds during drag/resize at animation-frame cadence, but apply presentation-mode
  changes only after bounds stabilize or resizing ends.
- Derive the desktop user-agent Chromium version from the runtime; do not switch to a mobile
  user-agent for narrow surfaces.

## Visibility Predicate

PiP is visible only when all of these are true:

```text
tab.owner == agent
AND tab.lastAgentRunId == workspace.activeAgentRunId
AND active Agent run is not terminal
AND tab is not closed
AND right-side panel is closed
AND workspace session is the active chat in its host renderer
AND host window is foreground
AND workspace.dismissedPipRunId != workspace.activeAgentRunId
```

Every input is main-process-authoritative or validated against the sender's host window. The
renderer reports layout facts; it does not decide whether an arbitrary tab may float.

### Confirmed panel-open behavior

If the right-side panel is already open, an Agent browser action activates the Browser surface,
selects the current Agent tab, waits for stable Browser bounds, and places the page in the panel. It
does this even when Workspace was the active surface. No PiP is shown during that handoff.

The Browser surface is not pinned. The user may switch back to Workspace afterward. That switch
detaches the Agent page without showing PiP because the panel remains open; the next Agent browser
tool action activates Browser again. This prevents a continuous tab-switch fight while still making
each new Agent operation visible.

## Loop Lifecycle

An Agent run becomes relevant to YoBrowser only after its first browser tool starts. There is no
empty PiP at run start.

```text
run starts
  -> no browser action: no PiP state
  -> first browser tool: mark Agent tab with runId
       -> right-side panel open: activate Browser, then place in panel
       -> panel closed: place page in render host
       -> session/host foreground and not dismissed: capture mirror into PiP
  -> more browser tools: reuse tab and recompute placement
  -> run completes / fails / aborts: stop capture and hide PiP immediately
```

A permission or question pause is not a terminal loop state. PiP remains eligible unless the user
dismisses it or another visibility condition becomes false. Terminal means completed, failed,
cancelled, superseded, or session teardown.

Loop completion hides PiP but does not close the tab. This preserves the result for later inspection
in the Browser panel. A separate retention policy handles eventual destruction.

## Placement Invariant and Transitions

For each page view:

```text
number of native parents <= 1
placement == panel    => parent is host.contentView
placement == render-host => parent is focusless renderHost.contentView at 1280 x 800
placement == detached => no native parent
```

All transitions go through one main-process placement controller. It removes the old parent before
adding the new parent, applies bounds, and starts or stops frame capture. The PiP Canvas is not a
native parent and never owns the page. Concurrent renderer mode requests, panel bounds, captures,
and Agent tool events are serialized per workspace.

| Event | From | Result |
| --- | --- | --- |
| First Agent browser action, panel open | Detached | Activate Browser, then Panel |
| First Agent browser action, panel closed | Detached | Render host; mirror if eligible |
| User clicks **Open in panel** | Render host | Open/activate Browser, then Panel |
| Browser surface becomes visible | Render host | Panel |
| User switches Browser to Workspace while panel stays open | Panel | Detached until next Agent browser action |
| User closes panel during active eligible run | Panel | Render host and mirror |
| User clicks PiP **Close** | Render host | Keep rendering; stop frames and suppress mirror for this run |
| Chat session deactivates | Render host or Panel | Stop frames; retain render host only while Agent work requires it |
| Host blurs/hides/minimizes | Render host | Stop frames; keep Agent rendering |
| Same host returns foreground with eligible run | Render host | Resume mirror capture |
| Agent run becomes terminal | Render host | Stop capture, release host, retain page detached |
| Agent tab closes | Any | Destroy and no PiP |

The panel transition waits for a stable content rectangle before reparenting. During the short
handoff, show the existing Browser placeholder; never display the remote page twice.

## User Experience

### Before: Agent navigation forces the panel open

```text
+--------------------------------------+-----------------------+
| Active conversation                  | Browser               |
|                                      | [Back] [ URL       ]  |
| Agent is working...                  |                       |
|                                      | agent-operated page   |
|                                      |                       |
+--------------------------------------+-----------------------+
```

### After: closed panel stays closed and Agent page floats inside the chat

```text
+----------------------------------------------------------------+
| Active conversation                                            |
|                                                                |
| Agent is working...        +-------------------------------+   |
|                            |                               |   |
|                            | read-only Agent page mirror   |   |
|                            |                               |   |
|                            |              [Open panel] [x] |   |
|                            +-------------------------------+   |
|                                                                |
+----------------------------------------------------------------+
```

### After: Browser panel was already visible

```text
+--------------------------------------+-------------------------+
| Active conversation                  | Browser                 |
|                                      | [User tab] [Agent tab]  |
| Agent is working...                  |                         |
|                                      | same live Agent page    |
|                                      |                         |
+--------------------------------------+-------------------------+
```

### PiP controls

- Controls are hidden initially. A click without drag on any non-button point toggles a toolbar with
  a truncated title, **Open in panel**, and **Close**.
- Every point in the PiP except buttons is a drag handle. Movement beyond the drag threshold must not
  also toggle the toolbar.
- The Canvas and decorative overlays use no remote-page input forwarding. Pointer, wheel, keyboard,
  selection, and focus stay in the trusted chat renderer.
- **Close** sets `dismissedPipRunId` to the current run and stops mirror capture. It does not close
  the tab, stop the 1280 x 800 render host, cancel CDP, or abort the Agent loop.
- **Open in panel** opens and activates the Browser panel, selects the Agent tab, and reparents the
  same page after the panel bounds stabilize.
- A keyboard user can focus both buttons. Dragging is pointer-based; keyboard movement is a later
  enhancement unless accessibility review requires it for V1.

### Geometry

- Default to the bottom-right of the measured conversation content with a 12 px inset.
- Prefer a 400 x 250 px 16:10 mirror when the conversation has room. Keep the captured frame at
  480 x 300 so the smaller display remains legible without changing the background page's
  1280 x 800 CSS viewport.
- Reveal the top actions and a centered drag affordance on hover or keyboard focus. A non-drag tap
  keeps those controls visible for pointer devices without hover.
- Clamp height to at most 58% of the conversation region and keep the full header reachable.
- On smaller regions, shrink to the available bounds. If usable page content would fall below
  360 x 240, replace the page card with a compact Agent-browser activity strip containing
  **Open in panel** and **Dismiss** rather than obscuring the entire conversation with an unusable
  webpage.
- Drag updates are renderer-local, throttled to animation-frame cadence, and clamped against the
  measured conversation bounds.
- Remember the last position only for the current host window lifetime. Re-clamp on resize, panel
  animation, route changes, and display scale changes.

Exact radius, shadow, header height, and icon treatment should be matched to the missing reference
screenshot during implementation review.

## Panel Tab Interaction

The Browser panel adds a compact tab strip below its existing Workspace/Browser selector and above
navigation controls. This is browser-tab state, not a second copy of the global side-panel tabs.

```text
+--------------------------------------------------+
| [Workspace] [Browser]                         [x] |
| [User page] [Agent page *] [+]                   |
| [<-] [->] [reload] [ URL                      ]  |
|                                                  |
| active page                                      |
+--------------------------------------------------+
```

- User navigation from a markdown link may keep its current explicit behavior of opening the
  Browser panel and creates/selects a user tab.
- Agent navigation never selects a user tab and never creates one tab per URL.
- An Agent marker distinguishes automation tabs.
- Closing an Agent tab destroys that page and removes PiP eligibility. The Agent receives a stable,
  recoverable page-closed result if a concurrent command loses the tab.
- Closing the panel detaches user pages. During an eligible Agent run, its active Agent page moves
  to PiP; otherwise it also detaches.
- **Expand** is available for user and Agent tabs. Presentation mode is stored per tab and follows
  the same live page into panel, PiP, and expanded placement.

## Active Session and Foreground Semantics

- Bind workspace visibility to the renderer `webContentsId` that reports the session as activated.
- Reject layout reports whose sender does not own the target host window/session route.
- A session visible in another window wins only when it is the currently activated copy; do not
  mirror one page view into two windows.
- Window blur, hide, minimize, close, route replacement, or session deactivation hides the Canvas
  mirror and stops frame delivery. These events are derived from BrowserWindow state, not
  `document.hasFocus()`, because focus can legitimately move between WebContents in one window.
- Window refocus may restore PiP only if the same non-terminal Agent run remains active and was not
  dismissed.
- Switching to another chat cannot expose the previous chat's page even for one frame.

## Activity Overlay

The existing `YoBrowserOverlayWindow` visualizes pointer, keyboard, navigation, and vision activity.
It should remain an activity layer, not become the PiP implementation.

Its native bounds follow the page only in the visible Browser panel. PiP reuses the typed activity
event and draws a trusted renderer halo over the Canvas, avoiding another native overlay window,
z-order interaction, or focus change.

## Events and Public State

Replace the ambiguous open request with intent-rich state. Proposed public concepts:

- workspace/tabs status: IDs, owner, URL/title/favicon, page status, active tab, placement;
- per-tab presentation mode and current effective page viewport/scale metadata;
- Agent browser activity: `sessionId`, `runId`, `tabId`, tool activity phase;
- layout report: host window, active session, conversation bounds, panel bounds, Browser surface
  visibility;
- placement status: `panel`, `pip`, `detached`, plus a redacted reason;
- preview-mode command: `capturing`, `rendering`, or `stopped`;
- typed preview-frame event: session/run/sequence, dimensions, MIME type, and bounded binary data;
- PiP commands: dismiss current run and open the current page in panel. Drag position remains local.

`runId` must be added to the internal tool execution context and passed through the Agent tool
manager into `YoBrowserToolHandler`. Do not derive loop ownership from session `working` status or
from a timeout: a session can wait for permission, queue another turn, or be superseded.

## Security and Isolation

- Remote page execution remains in its existing sandbox/session. PiP receives only an inert,
  downscaled image frame and never remote DOM or script.
- PiP chrome loads only a packaged local route with no remote navigation, no Node integration, and a
  narrow validated IPC surface.
- Remote pages cannot receive PiP input, drag the PiP, close it, activate the panel, spoof Agent
  ownership, or send PiP commands.
- Preview frames remain memory-only, are bounded in dimensions and rate, and are never logged,
  cached, or written to disk.
- Device-emulation or zoom state is applied only by main-process tab policy; remote pages cannot
  change the stored presentation mode.
- Bounds and IDs received from renderers are validated and clamped in main.
- The page's DevTools/CDP attachment remains unchanged during reparenting.
- No page URL, title, or favicon from an inactive session is shown after a session switch.
- The trusted header truncates untrusted title/host text and never interprets it as HTML.

## Failure Semantics

- A failed render-host creation or reparent falls back to `detached`, publishes `placement_failed`,
  and never leaves the page registered under two parents.
- A capture or decode failure retains the last Canvas frame and retries on the next bounded tick;
  it never clears the PiP to a blank frame.
- At most one capture is in flight per page. New ticks are dropped rather than queued.
- A destroyed host window clears placement synchronously and destroys its PiP chrome.
- A stale bounds or session-activation update is ignored by monotonically increasing layout
  versions.
- If panel bounds never stabilize, keep the PiP visible and report the handoff failure; do not reload
  the page.
- If PiP chrome crashes, detach PiP and keep the Agent page alive for tools.
- If the remote page crashes, show the existing browser error state in the panel/placeholder and let
  tool calls return the current page error.
- Loop-finalization cleanup is idempotent and safe when the page or window has already closed.

## Feasibility Assessment

| Requirement | Feasibility | Evidence / risk |
| --- | --- | --- |
| Same page in render host and panel by movement | High | Electron View supports child-view reparenting; serialize parent changes |
| Read-only in-chat mirror and dragging | High | Canvas stays in the trusted renderer and cannot target remote content |
| Preserve page/CDP/session state | High | Reuse the same `WebContentsView`; no navigation or recreation |
| macOS transparent render host capture | High | Proven locally against Electron 40.10.5 with 1280 x 800 animated content |
| Windows/Linux transparent render host capture | Medium | Requires packaged compositor/window-manager validation |
| Bounded frame cost | Medium-high | 480 x 300 output, adaptive 1-4 FPS, one in-flight capture, stop when ineligible |
| Agent-only eligibility | High | Requires `runId` propagation and explicit tab ownership |
| Hide exactly at loop terminal state | High | Runtime owns `LoopRun.runId`; add an explicit finalization port |
| Multiple browser tabs | Medium-high | Current single-page status/contracts and panel must be migrated |
| Responsive DeepChat chrome | High | Container-width layout can reuse current panel ownership and existing UI primitives |
| Responsive website rendering | High for native Responsive mode | Current native bounds already drive the page viewport |
| Fit desktop mode | Medium | Must prove emulation/zoom input and Agent screenshot coordinate fidelity |
| Expanded Browser surface | High | Reuse the existing side-panel fullscreen shell behavior |
| Existing activity overlay in nested PiP | Medium | Separate transparent window may need a local-view fallback after cross-platform QA |
| Identical cross-platform window behavior | High with in-window View | Avoids child `BrowserWindow` platform differences |

The largest implementation risk is not rendering the card. It is lifecycle correctness across
Agent finalization, session switching, panel animation, window focus, tab closing, and concurrent
bounds updates. The placement invariant and run ID are mandatory, not optional polish.

## Acceptance Criteria

- An Agent browser tool never opens a closed right-side panel.
- A user-opened page never appears in PiP.
- The first browser tool in an active loop creates/reuses an Agent tab and associates the exact
  `runId`.
- If the Browser surface is visible, the Agent tab is shown there with no PiP.
- If any right-side panel surface is open when an Agent browser action starts, DeepChat activates
  Browser and shows the Agent tab there instead of opening PiP.
- Switching back to Workspace is respected until the next Agent browser action; DeepChat does not
  continuously force Browser active.
- If all PiP predicate conditions hold, exactly one PiP appears inside the active conversation.
- PiP is read-only: clicking, dragging, scrolling, typing, or focusing it never affects the page.
- The live remote page exists in only one native placement; the Canvas contains only its last
  completed image frame.
- While mirrored, page layout reports a stable 1280 x 800 CSS viewport independent of PiP size.
- Moving PiP to the panel preserves URL, DOM state, scroll, focusable page state, cookies, and CDP
  target identity without reload.
- Closing PiP suppresses it for the rest of that run without closing the page or interrupting the
  Agent.
- A later Agent run may show the retained Agent tab again after its first browser action.
- Completing, failing, cancelling, or superseding the loop hides PiP immediately.
- Session deactivation and real BrowserWindow blur/hide/minimize hide PiP; internal focus movement
  between chat and page WebContents does not hide or flash it.
- New frames replace Canvas pixels only after decode, so capture and handoff never create a blank
  intermediate frame.
- Dragging stays inside current chat bounds through resize and scale changes.
- Browser tabs and controls remain usable at 420 px panel width without clipping the address bar or
  hiding commands from keyboard users.
- Responsive mode exposes the real content bounds at 100% page zoom.
- Fit desktop is never selected silently and passes user-input/CDP/screenshot coordinate tests
  before release.
- Expand/restore preserves the exact tab and page state without reload.
- The YoBrowser user-agent Chromium version matches the bundled runtime rather than a stale literal.
- Panel tabs distinguish user and Agent pages and closing a tab destroys only that page.
- Tool operations remain correct while the page moves between placements.
- Cross-platform focus, input, z-order, overlay, and accessibility tests pass.
- Format, i18n, lint, typecheck, and focused tests pass after implementation.

## Decision Gates

1. **What does PiP close mean?** Recommendation: dismiss presentation for the current run only; it
   must not close the tab or disrupt automation.
2. **Agent tab retention**: recommendation is one retained Agent tab per session, destroyed when the
   session/browser workspace is explicitly destroyed or by a later memory-pressure policy.
3. **Run pause behavior**: recommendation is to keep PiP eligible while waiting for permission or a
   question, because the loop has not ended; the user can dismiss it.
4. **Page adaptation**: recommendation is automatic responsive chrome plus Responsive page mode by
   default, with explicit Fit desktop and Expand actions. Silent overflow-based scaling is too
   unpredictable for arbitrary sites and Agent coordinates.
5. **Fit implementation**: choose device emulation versus controlled zoom only after the coordinate
   fidelity proof; no API is approved by this spec yet.
6. **Exact styling**: requires the referenced screenshot or a new visual decision before UI polish.

Confirmed product decisions:

- an already open right-side panel automatically switches from Workspace to Browser for each new
  Agent browser action;
- an undersized conversation shows a compact Agent-browser activity strip instead of forcing an
  unusably small webpage.

## Verified References

- [Electron View API](https://www.electronjs.org/docs/latest/api/view)
- [Electron WebContentsView API](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron BaseWindow child-window behavior](https://www.electronjs.org/docs/latest/api/base-window)
- [Electron webContents zoom and device-emulation APIs](https://www.electronjs.org/docs/latest/api/web-contents)
- [Electron 40.10.5 runtime versions](https://releases.electronjs.org/release/v40.10.5)
- [Chrome DevTools Protocol Input coordinates](https://chromedevtools.github.io/devtools-protocol/tot/Input/)
