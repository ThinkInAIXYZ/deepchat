# Agent Browser Surfaces and Picture-in-Picture

## Status And Scope

The single-page Agent Browser preview and panel handoff are implemented. Native presentation is
defined by [NativeKit Agent Browser PiP](../../architecture/nativekit-agent-browser-pip/spec.md).
Supported runtimes use a native read-only panel; unavailable native capability opens the existing
Browser side panel. A visible multi-tab strip, Fit desktop, and the complete responsive/expanded
page workflow remain deferred. Packaged platform, interaction, and performance validation remain
open in this goal’s execution records.

[Computer Use snapshots](../computer-use-snapshot-pip/spec.md) share process-global presentation
ownership with Browser. Browser still owns its page, capture loop, panel handoff, and run-scoped
dismissal. Sharing the native surface does not merge these feature contracts.

## Product Contract

- An Agent browser action keeps a closed right-side panel closed when native PiP is available.
- If any right-side panel surface is already open, an Agent browser action activates Browser and
  places the live page there. A user may switch back to Workspace until the next browser action.
- With the panel closed, an eligible foreground Agent session can show a native read-only preview.
- If native PiP is unavailable, the same activation path opens Browser in the side panel.
- Explicit user navigation keeps its existing behavior of opening Browser and is not PiP-eligible.
- Opening the panel moves the same live page into it without navigation, copied state, or a new
  CDP target.
- Closing PiP suppresses presentation for the current Agent run without closing the page,
  cancelling tools, or aborting the run.
- Run completion, failure, cancellation, supersession, session deactivation, page destruction, and
  host visibility changes stop or hide the preview according to the lifecycle rules below.

## Current Ownership

`YoBrowserPresenter` owns one `SessionBrowserState` per chat session, containing the live
`WebContentsView`, page, owner (`agent` or `user`), Agent run identity, placement, preview host,
capture state, and activity overlay. The current public browser state is one page per session,
not the deferred multi-tab workspace model.

`YoBrowserToolHandler` accepts run identity from Agent execution and forwards it to the presenter.
Browser status and open-request events carry owner/source and run identity. `ChatSidePanel.vue`
opens Browser for explicit user navigation or when a panel is already open; an Agent open request
alone does not force a closed panel open.

`BrowserPanel.vue` supplies stable visible bounds and manages page attachment through typed
clients. `AgentBrowserPiP.vue` derives current-session, working-run, window, and panel eligibility
and coalesces preview-mode requests. Main validates the target window, session, run, and epoch.

`AgentPreviewCoordinator` owns the one visible native presentation across Browser and Computer
Use. NativeKit owns panel dragging, display-work-area clamping, and native z-order. The renderer
receives source-specific actions and surface state; native image frames do not cross renderer IPC.

`yoBrowserSession.ts` derives its desktop Chromium user-agent version from the bundled runtime.
Narrow page bounds do not switch the browser to mobile or touch semantics.

## Live Page And Presentation

The Agent page uses a focusless background render-host `BaseWindow` while the panel is closed.
The host provides Chromium a display surface, is transparent and offscreen, and does not accept
user input. The background page viewport remains 1280 x 800, independently of preview dimensions.
Opening Browser reparents that exact page view into the visible panel.

```text
Background render host
+-- Agent WebContentsView at 1280 x 800
    +-- capture -> resize/encode -> NativeKit read-only panel

Chat BrowserWindow
+-- trusted chat renderer
+-- Browser panel: the same Agent WebContentsView when visible
```

There is one page WebContents, one page view, and one browser session. A preview is an inert image,
not another browser or another native parent for the page. Reparenting preserves URL, DOM, scroll,
cookies, focusable page state, and CDP identity.

The internal `renderer-canvas` surface value and component remain available to their existing
callers, but native capability failure does not select that surface automatically. The supported
fallback is the existing Browser panel. Canvas-only drag geometry, title toolbar, compact activity
strip, and activity halo are not requirements for the native surface.

## Eligibility And Lifecycle

Capture requires the current Agent-owned page and run, an active working session, a foreground
owning chat window, a closed right-side panel, and a run that the user has not dismissed.
Native presentation also requires the current process-global preview claim. Refreshing an image
does not claim ownership from another preview source.

An Agent run becomes relevant after its first browser action; an empty PiP is never shown merely
because a run starts. A permission or question pause is not a terminal outcome. Current run identity
and session state must remain consistent through pause, resume, cancellation, and supersession.

Preview modes separate capture from page rendering:

- `capturing`: maintain the render host and publish bounded frames while eligible;
- `rendering`: keep the page usable by Agent tools while suppressing preview capture;
- `stopped`: stop capture and release the preview host according to page lifecycle.

For each page view:

```text
number of native parents <= 1
panel       => parent is the chat host contentView
render-host => parent is the background host contentView at 1280 x 800
detached    => no native parent
```

Parent changes and capture transitions belong to main. Remove the previous parent before adding
the next one, and invalidate stale asynchronous capture work with the current epoch.

| Event                                           | Presentation                                   | Page behavior                                                       |
| ----------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| First Agent action with an open panel           | No PiP; activate Browser                       | Attach the same page after stable panel bounds                      |
| First eligible Agent action with a closed panel | Show only after a valid frame                  | Keep page in the render host                                        |
| Native capability unavailable                   | Request Browser side-panel activation          | Attach the same page through the normal panel path                  |
| Browser panel opens                             | Hide native preview and stop capture           | Reparent into the panel                                             |
| User switches Browser to Workspace              | No PiP while the panel remains open            | Detach or retain background rendering as required by the active run |
| Panel closes during an eligible run             | Push a current frame before showing            | Reparent into the render host                                       |
| PiP Close                                       | Suppress this run and stop capture             | Preserve the page and active tools                                  |
| Native Open in panel or double-click            | Focus the host and request Browser             | Reparent after stable panel bounds                                  |
| Host blur/hide/minimize                         | Hide synchronously                             | Retain rendering only while Agent work requires it                  |
| Eligible host regains foreground                | Re-evaluate ownership and show a current frame | No page reload                                                      |
| Run becomes terminal                            | Stop capture and remove presentation           | Release the render host; preserve the normal page lifecycle         |
| Session/page destruction or host closure        | Remove presentation and target                 | Release owned page/host resources                                   |
| Application shutdown                            | Stop the native overlay once                   | Run existing idempotent presenter cleanup                           |

Session switching cannot expose a prior session’s frame, URL, title, or page even transiently.
Main handles host visibility and destruction without waiting for renderer cleanup.

## Native Interaction And Layout

```text
+------------------------------------------+   +----------------------+
| DeepChat                                 |   | Native PiP           |
|                                          |   |                      |
| Active conversation                      |   | Agent page snapshot  |
| Browser panel remains closed             |   |       [Open] [Close] |
|                                          |   | drag; double-click   |
+------------------------------------------+   +----------------------+

Native unavailable -> open the existing Browser side panel
```

- Dragging the image moves the native panel within the display work area and may cross DeepChat
  window edges. It does not send renderer pointer-move IPC.
- Double-click and **Open in panel** activate the owning chat and its Browser panel.
- **Close** dismisses only the current Agent run’s preview.
- The native panel remains non-activating and forwards no pointer, wheel, keyboard, selection, or
  focus input to the remote page.
- Frame replacement preserves stable presentation identity and a user-dragged origin. Host
  movement/resize synchronization is separate from image replacement.
- Native controls use the configured **Open in panel** and **Close** actions. No companion
  renderer title toolbar or activity halo is required.

## Capture, Failure, And Security Constraints

- Capture, resize, encode, and presentation are serialized. There is at most one in-flight capture;
  schedule another tick only after the full cycle completes.
- `YoBrowserPresenter` owns configured frame dimensions and active/idle cadence. Tuning them must
  preserve usable preview legibility and the maintained latency budgets in the native contract.
- Encoded output is bounded at 512 KiB. No idle capture runs for an ineligible or stopped target.
- Validate run, session, host, mode, current claim, and epoch immediately before presentation.
- First show and resume push a current frame before making the native panel visible.
- Capture, resize, encode, or frame-push failure preserves the last valid same-target image and
  retries on the next bounded tick. It must not flash an empty preview or switch targets.
- Initialization/host-attachment failure disables native capability for the process and opens the
  Browser panel. A transient bad frame does not select another surface.
- Failure to obtain stable panel bounds retains or restores the preview and reports a recoverable
  handoff failure; it does not reload the page or attach it twice.
- Remote-page failure uses existing Browser error behavior and tool errors. Preview failure must
  not interrupt an otherwise valid Agent operation.
- Page execution stays in its existing sandbox/session. Native presentation receives only a
  downscaled image; renderer or remote content receives no NativeKit object or native handle.
- Frames remain memory-only and never enter logs, caches, persistence, or disk files.
- Logs contain bounded lifecycle/performance metadata, not image bytes, page content, or secrets.
- `YoBrowserOverlayWindow` remains the visible panel’s Agent activity layer, separate from PiP.
- Source visibility, frame timing, native movement, and packaged compositor behavior require the
  outstanding platform QA; a configured interval is not a measured frame-rate claim.

## Deferred Browser Workspace Contract

Visible tabs and expanded page-adaptation controls are not part of the shipped single-page
product. Their open implementation and validation requirements remain in `plan.md` and `tasks.md`.

### Tab identity and ownership

- Replace the single-page status with a per-session tab collection and selected tab identity only
  when the main owner, typed routes, renderer callers, and lifecycle tests move together.
- Distinguish user-created tabs from the primary Agent automation tab; do not silently convert a
  user tab into an Agent tab.
- Reuse one primary Agent tab per session across URL loads and runs. Do not create a tab for each
  `load_url` call.
- Propagate exact run identity through immediate, batch, resumed, and deferred tool paths. The
  Agent-touched tab owns preview eligibility; popups inherit the initiating ownership/run.
- User commands act on the selected tab, while Agent tools target the primary Agent tab unless a
  separately approved tool explicitly accepts a tab ID.
- Closing a tab destroys only its page and returns a recoverable page-closed result to a
  concurrent operation. Closing PiP does not close a tab.
- Retention and eviction require measured memory evidence; do not introduce speculative idle
  eviction or restart persistence.

### Responsive chrome

Use container width rather than application viewport width. At least 640 px supports the complete
tab/navigation row; 480-639 px uses compact tabs and overflow controls; narrower surfaces retain
an address bar and keyboard-accessible commands. The supported 420 px panel must remain usable.
Tab titles truncate, tabs scroll instead of squeezing, and the address bar can shrink without
clipping the commands needed to navigate.

```text
Expanded panel
+----------------------------------------------------------------+
| [User tab] [Agent tab *] [+]                                     |
| [Back] [Forward] [Reload] [URL                 ] [Fit] [Expand]  |
+----------------------------------------------------------------+

Compact panel
+----------------------------------------------+
| [User] [Agent *] ...                          |
| [Back] [Reload] [URL                   ] [...]|
+----------------------------------------------+
```

Exact tab/fit chrome styling requires an explicit visual baseline before implementation. The
open styling decision does not alter the current native panel’s ownership or input behavior.

### Page presentation and expansion

- Responsive page rendering uses actual native content bounds and 100% zoom by default. Do not
  silently scale based on horizontal overflow or pretend the narrow surface is a mobile browser.
- **Fit desktop** is an explicit per-tab choice. Choose device emulation or controlled zoom only
  after proving layout/media queries, readability, user input, CDP coordinates, screenshot
  dimensions, per-tab isolation, and deterministic reset across navigation/reparenting.
- Same-origin Chromium zoom behavior is not proof of isolated per-tab fit. Until the coordinate
  proof passes, Fit desktop remains unavailable.
- **Expand** uses the existing side-panel/fullscreen shell to occupy the chat content area, with
  a clear **Restore chat** action and focus restoration. It creates no new window, page, or CDP
  target.
- Presentation choice follows the same tab for the current process lifetime. Restart persistence
  is outside the current scope.
- Native bounds follow measured layout; apply expensive presentation changes after bounds
  stabilize. A remote page cannot modify the stored presentation policy.

## Acceptance And Regression Protection

The implemented preview must preserve page/CDP identity, source/run isolation, bounded capture,
no renderer-native-frame payload, stable native position, safe panel handoff, run-scoped dismissal,
and deterministic teardown. Regression coverage resides in
`test/main/desktop/browser/YoBrowserPresenter.test.ts`, the source-specific preview coordinator
tests, and `test/renderer/components/AgentBrowserPiP.test.ts`.

Outstanding verification includes cancellation/failure/supersession and pause/resume paths;
session/route/multi-window races; host show/hide/minimize/restore; resize/scale changes; page and
host crashes; concurrent user/Agent actions; and physical platform focus, z-order, drag, keyboard,
and accessibility behavior. A later tab/fit implementation also requires complete coordinate,
compact-width, expand/restore, and same-page identity checks.

Keep Windows/Linux packaged checks, supported macOS checks, and native movement/frame-latency
measurements open until their evidence is recorded. An unavailable native capability must retain
the normal Browser panel fallback. Repository format, i18n, lint, typecheck, and relevant focused
tests remain required for any implementation change.

## Non-Goals

- Native video PiP, `documentPictureInPicture`, or a full-frame-rate shared-texture video pipeline.
- Multiple simultaneous visible PiPs or floating pages operated only by the user.
- PiP input forwarding to remote pages or renderer ownership of remote WebContents.
- Automatic hidden page scaling, mobile user-agent switching, or unmeasured tab eviction.
- Persisted PiP geometry, generalized standalone-browser tab architecture, or a public preview
  framework.

## References

- [Electron View](https://www.electronjs.org/docs/latest/api/view)
- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron BaseWindow](https://www.electronjs.org/docs/latest/api/base-window)
- [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents)
- [CDP Input coordinates](https://chromedevtools.github.io/devtools-protocol/tot/Input/)
