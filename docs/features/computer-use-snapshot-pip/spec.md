# Computer Use Snapshot Picture-in-Picture Spec

## Status

Implemented on branch `codex/computer-use-snapshot-pip` on 2026-07-28.

Format, i18n, lint, typecheck, focused main/renderer coverage, and the complete renderer suite pass.
The complete main suite has one unrelated provider-metadata expectation failure in
`test/main/provider/modelConfig.test.ts`; the same test fails in isolation and neither it nor its
implementation is changed by this feature. Packaged native-overlay and native-unavailable QA,
cross-platform interaction checks, and the 150 ms p95 result-to-visible measurement remain open and
are tracked in `tasks.md`.

This feature adds a read-only picture-in-picture surface for the current Computer Use target by
reusing successful `get_window_state` image results. In addition to Agent-requested snapshots, one
eligible successful `click` may schedule one private `get_window_state` refresh whose result is
consumed only by PiP. It does not add a capture loop, change the CUA runtime, enable the upstream
experimental PiP, or modify CUA plugin policies and skill instructions.

The existing
[Agent Browser NativeKit architecture](../../architecture/nativekit-agent-browser-pip/spec.md)
now uses the implemented process-global, single-PiP coordinator shared with Computer Use while
preserving Browser-specific behavior.

GitHub issue sync was not requested and was not performed.

## Counterpoint

Calling this surface "live Computer Use PiP" would promise behavior the available data source does
not provide. A Computer Use tool result contains a point-in-time image only when
`get_window_state` runs; no frame exists between those calls.

Polling `get_window_state` merely to animate PiP is the wrong tradeoff. The call also performs
accessibility-state work and updates the driver's element cache, so extra polling would consume
driver, IPC, and model-adjacent resources while changing the semantics of the automation flow.

An event-driven refresh after a successful `click` is a narrower tradeoff than polling: it adds at
most one capture at a user-visible state boundary, only while PiP is eligible, and does not put the
private result on the Agent path. `get_window_state` still refreshes the CUA accessibility cache, so
Agents must continue to obtain their own current state before selecting a later element index.

The correct version is therefore an honest **latest snapshot** surface:

- no idle or timer-driven captures;
- at most one private snapshot request after each eligible successful `click`;
- first appearance only after a valid snapshot exists;
- immediate replacement when the next valid snapshot arrives;
- retention of the last valid current-run image between snapshots;
- no video, freshness animation, or fake activity.

## Feasibility Assessment

The snapshot PiP is feasible without changing CUA.

| Question | Finding | Consequence |
| --- | --- | --- |
| Is a usable image already available? | Successful `get_window_state` results contain an inline MCP image block. | Reuse Agent-requested results and issue only an event-driven private refresh after eligible clicks; add no capture API or polling. |
| Can the existing PiP surface be reused? | NativeKit accepts PNG/JPEG data URLs and supports repeated toolbar reconfiguration. | Share one native owner and switch explicit Browser/Computer profiles. |
| Can a result be tied to the correct Agent run? | The Agent runtime has a stable `runId`, but the MCP branch currently drops it. | Forward internal execution metadata through the MCP service path. |
| Can stale pixels be isolated? | ToolManager knows the resolved plugin source, original tool, prepared target arguments, and tool-call identity. | Observe at that boundary and validate run, target, claim, and epoch before display. |
| Does every platform have a native overlay? | No; the existing NativeKit matrix has Windows arm64, native Wayland, and load-failure gaps. | Disable Computer Use PiP without changing CUA execution. |

The main engineering risk is not screenshot performance. It is ownership: NativeKit is
process-global, while Browser and Computer Use have different controls and lifecycles. A shared
coordinator is therefore required for correctness. With that boundary in place, the Computer Use
path is a bounded image-result consumer rather than a new screen-capture subsystem.

## Problem

When an Agent operates a desktop application through Computer Use, the user can see tool calls in
the conversation but cannot see the target application's latest state without switching away from
DeepChat. That makes long-running automation difficult to supervise.

The existing Agent Browser PiP solves a related problem, but it cannot be copied directly:

- Browser owns a continuously capturable `WebContentsView`; Computer Use receives discrete MCP
  image results from an external application.
- Browser PiP offers **Open in panel**; Computer Use has no DeepChat side panel to open.
- NativeKit exposes one process-global overlay manager whose toolbar is configured by
  `overlay.start()`. Two independent adapters would race and replace each other's configuration.
- Browser emits frames continuously at a bounded rate; Computer Use uses discrete Agent-requested
  and post-click snapshots and must not add background polling to simulate that behavior.

## User Experience

### Before

```text
┌──────────────────────────────────────┐
│ DeepChat                             │
│                                      │
│ Agent tool calls only; the target    │
│ application state is not visible.    │
└──────────────────────────────────────┘
```

### After

```text
┌──────────────────────────────────────┐       ┌────────────────── × ┐
│ DeepChat                             │       │                    │
│                                      │       │ latest target app  │
│ Agent is working                     │       │ snapshot           │
└──────────────────────────────────────┘       └────────────────────┘
```

The Computer Use PiP:

- shows only the latest valid snapshot for the active target window;
- is draggable from any non-control point;
- has one **Close** button and no expand, open-panel, title, status, or action controls;
- is read-only and never forwards pointer, wheel, keyboard, or focus input to the target
  application;
- closes only the preview for the current run and never closes the target application, cancels the
  Agent, or interrupts a tool;
- disappears while DeepChat is not the foreground application, allowing the user to inspect the
  real target application instead.

Post-click freshness changes without changing the layout:

```text
BEFORE  click -> Agent receives click result -> PiP retains the prior snapshot
AFTER   click -> Agent receives click result
              `-> private get_window_state -> PiP replaces the snapshot
```

The existing `common.close` translation is sufficient. This feature adds no user-facing copy.

## Goals

- Let users supervise the current Computer Use target without leaving DeepChat.
- Reuse inline images returned by successful CUA `get_window_state` calls.
- Refresh PiP after an eligible successful `click` without exposing the private snapshot result to
  the Agent, conversation, or generic MCP result event.
- Show the first PiP only after a valid current-run image has been decoded.
- Update the PiP after each later valid snapshot for the same active target.
- Keep the last valid image visible between snapshots without showing stale images from another
  run, session, or target.
- Use the existing NativeKit overlay on supported runtimes and expose no Computer Use PiP when the
  native capability is unavailable.
- Share one process-global native overlay safely between Browser and Computer Use.
- Preserve Browser PiP's existing **Open in panel** plus **Close** controls.
- Give Computer Use exactly one **Close** control and ignore native activation.
- Keep image bytes in the main process on the native path.
- Bound image input, transform work, output size, and queued work.
- Hide and remove the surface deterministically across focus, route, session, run, target, and
  shutdown lifecycle edges.

## Non-Goals

- Updating the CUA runtime, driver, plugin manifest, policies, skill, or packaged assets.
- Enabling or integrating the upstream CUA experimental PiP.
- Adding a CUA driver screenshot hook, daemon socket, callback, or runtime patch.
- Polling `get_window_state` to produce a 2-4 FPS stream.
- Capturing external windows through Electron `desktopCapturer` or a new native capture module.
- Presenting video, shared textures, WebRTC, or a GPU surface.
- Interacting with the target application through the PiP.
- Opening a side panel or adding an expand button for Computer Use.
- Displaying more than one PiP at a time.
- Persisting PiP position, size, image, target identity, or dismissal across app restarts.
- Publishing raw Computer Use images through a generic MCP result event.
- Generalizing all tool previews into a public framework.

## Terminology

- **Computer Use source**: the trusted plugin-owned MCP server identified by
  `ownerPluginId` or `sourceId`, not by a user-editable server name.
- **Snapshot call**: a CUA `get_window_state` tool invocation with valid `pid` and `window_id`
  arguments.
- **Private post-click snapshot**: an asynchronous `get_window_state` invocation made through the
  same resolved official CUA client after a successful `click`; its result is PiP-only.
- **Snapshot frame**: the first supported inline image block in a successful snapshot result.
- **Target**: the tuple `(pid, windowId)` within one chat session and Agent run.
- **Run**: the stable Agent execution identity already carried as `ToolCallOptions.runId`.
- **Claim**: explicit Browser tool activity or a Computer Use snapshot-call start that requests
  ownership of the single PiP surface.
- **Refresh**: a new frame for the source that already owns the PiP. A refresh is not a claim.
- **Eligible**: the renderer session is active and working; the presenter may show a valid frame
  when the host is foreground.
- **Suspended**: retain current target and frame but hide the surface temporarily.
- **Stopped**: remove the presentation and target state for the session.

`sessionId` in the preview contract is the current chat `conversationId`.

## Baseline Repository Contract

- `YoBrowserPresenter` owns Browser capture, preview mode, and frame delivery.
- `AgentBrowserNativeOverlay` owns the current NativeKit integration and configures
  **Open in panel** plus **Close** during `overlay.start()`.
- NativeKit provides one process-global overlay manager. Starting a second independent adapter
  would replace global toolbar configuration.
- `AgentBrowserPiP.vue`, mounted by `ChatTabView.vue`, coordinates Browser preview eligibility and
  opens the existing Browser side panel when native PiP is unavailable.
- The Agent runtime already passes `io.requestId` as `ToolCallOptions.runId`.
- `ToolService` forwards `runId` to built-in Agent tools but currently drops it on the MCP path
  before `McpService.callTool`.
- `ToolManager` resolves the actual MCP client, original tool name, plugin identity, repaired
  arguments, permissions, and prepared arguments before invoking the tool.
- CUA recognition already uses plugin ownership metadata rather than the server display name.
- A successful MCP image block has `type: 'image'`, base64 `data`, and `mimeType`.
- The generic `mcp.toolCall.result` publication does not carry the complete run, source, and target
  identity needed for safe preview routing and must not become a pixel transport.
- `toolCallImagePreviews` caches result images for conversation rendering after tool execution. PiP
  must consume the inline result before that persistence path and must not create another cached
  copy.

## Implemented Deviations

- Added source-specific `computerUse.preview.surface.changed` and
  `browser.preview.surface.changed` events. They carry only bounded identity and surface metadata,
  never image bytes, and let renderers react to native failure and cross-source arbitration without
  polling.
- Added an `epoch` to Computer Use surface and frame events so a later target in the same run cannot
  accept an in-flight frame from the prior target.
- The shared coordinator permanently disables native PiP after a NativeKit load, startup, toolbar,
  or host-attach failure for the current process. A frame-push failure retains the previous native
  presentation and retries on the next valid snapshot.
- An eligible successful official CUA `click` schedules one non-blocking private
  `get_window_state({ pid, window_id })` call. The private response is routed only to the preview
  observer and is never published as an MCP result or returned to the Agent.
- No CUA runtime, driver, plugin manifest, policy, skill, or packaged asset was changed.

## Product Contract

### Frame Source

Only an actual Agent-requested or private post-click invocation that meets every condition may
update the preview:

1. The resolved MCP client belongs to the official Computer Use plugin.
2. The resolved original tool name is `get_window_state`.
3. The prepared arguments contain finite positive integer `pid` and `window_id` values.
4. The tool result is not an error.
5. The result contains a PNG or JPEG inline image block.
6. The call still matches the active session, run, target, tool call, and presenter epoch when
   asynchronous transform work completes.

Text, resources, cached preview references, permission responses, failed calls, and images from
other CUA tools are not frame sources.

### Private Post-click Refresh

- Only the exact resolved original tool `click` is eligible; `right_click`, `double_click`, and
  other actions do not implicitly expand this contract.
- The click must succeed on the resolved official CUA client and carry finite positive integer
  `pid` and `window_id` values.
- The presenter must confirm that PiP is eligible and that the click still matches its active
  session, run, target, and non-dismissed state.
- The private call uses only `{ pid, window_id }`, starts asynchronously after click completion, and
  does not delay or change the click response.
- The private call bypasses Agent-facing permission and result publication only after confirming
  that the triggering click passed access checks and the current plugin policy explicitly allows
  `get_window_state`.
- The private result enters only the same bounded preview observer and image pipeline. Its text,
  accessibility tree, and other content are discarded.
- A private-call failure retains the last valid frame and never changes Agent execution.
- No private snapshot is scheduled while the preview is stopped, suspended, dismissed, stale, or
  missing a valid active target.

### First Frame and Refresh

- A snapshot call start claims Computer Use ownership immediately before MCP invocation, after
  permission checks and argument preparation.
- Claiming a new run or target hides and removes the prior presentation before any asynchronous
  result can arrive.
- The PiP does not appear until the first valid frame for that claim is decoded and transformed.
- A later valid snapshot for the same run and target replaces the visible frame.
- A failed snapshot keeps the last valid frame for the same active run and target.
- A failed or invalid result never replaces a valid frame with an error image or placeholder.
- Results from a superseded call, run, target, session, or epoch are discarded.

### Eligibility and Visibility

The Computer Use PiP may be visible only when all of these are true:

- its chat route and session are active in the host renderer;
- the session status is `working`;
- the host window exists, is shown, is not minimized, and is focused;
- Computer Use currently owns the shared PiP claim;
- a valid frame exists for the active run and target;
- the current run has not been dismissed.

Side-panel visibility is irrelevant to Computer Use PiP. It remains relevant to Browser PiP under
the existing Browser contract.

Temporary host blur, hide, minimize, route switch, or renderer suspension hides the surface without
discarding the valid current target frame. Session terminal state, teardown, new run, target change,
host destruction, or app shutdown removes the presentation.

### Dismissal

- **Close** records dismissal for the active session and run.
- Dismissal hides/removes the current shared presentation without changing the tool or target
  application.
- Later frames from the dismissed run remain suppressed.
- A later Agent run clears the suppression and may show a new preview after its first valid frame.
- Dismissal is shared at the one-PiP coordinator level so a Browser/Computer source transition
  within the same run cannot immediately reopen a surface the user just closed.

## Target Architecture

```text
Agent runtime
    |
    | ToolCallOptions.runId
    v
ToolService -> McpService -> ToolManager
                              |
                              | resolved trusted CUA client
                              | original tool + prepared args
                              v
                   ComputerUsePreviewObserver
                      | started | completed/failed
                      v
                 ComputerUsePreviewPresenter
                      |
                      | validate -> decode -> resize -> JPEG
                      v
              AgentPreviewCoordinator (one per process)
                 | claim/arbitrate/lifecycle
                 |
          +------+------------------+
          |                         |
          v                         v
  NativeKit overlay          native unavailable
  main-process image         no Computer Use PiP
  Computer toolbar: Close    CUA execution unchanged
```

### Shared Native Overlay Ownership

Extract the process-global concerns currently inside `AgentBrowserNativeOverlay` into one
`AgentPreviewCoordinator` (or equivalently focused shared overlay adapter), instantiated once in
`src/main/app/composition.ts`.

The shared owner is responsible for:

- one NativeKit `start()` / `stop()` lifecycle;
- on-demand capability detection and process-stable disablement;
- one attached host and one visible presentation;
- toolbar profile switching before a source is presented;
- display, host move/resize, focus, show/hide, minimize/restore, and close listeners;
- one eligible source claim and monotonic claim sequence per host/session;
- shared run-scoped dismissal;
- prepaint-before-show ordering;
- NativeKit latency instrumentation and failure disablement.

Source profiles remain explicit:

| Source | Toolbar | Native activation | Source action |
| --- | --- | --- | --- |
| Browser | **Open in panel**, **Close** | Open Browser panel | Browser presenter callback |
| Computer Use | **Close** | Ignore | Computer presenter dismissal |

Do not instantiate two adapters that independently call `overlay.start()`. Do not broaden Browser
routes, frame contracts, or page ownership into a generic public preview API.

### Source Arbitration

There is one visible PiP per DeepChat process.

- Claims from an inactive or background host/session never preempt the foreground active session.
- Within the foreground active host/session, the most recent explicit source claim wins.
- Browser tool activity is a Browser claim.
- An actual CUA `get_window_state` invocation start is a Computer Use claim.
- Frame arrival and periodic Browser capture are refreshes, not claims.
- A refresh may update only the source that still owns the claim.
- A source losing ownership retains only the state needed by its existing lifecycle; it must not
  remain visible.
- Reclaim requires later explicit tool activity.
- When focus or active session changes, the coordinator reevaluates the latest retained claim for
  that newly eligible host/session instead of assigning a new activity sequence.

This distinction prevents Browser's 4 FPS capture loop from continuously stealing the PiP back from
a newly active Computer Use target, and prevents a background Agent from hiding or leaking into the
foreground session.

### MCP Run Identity and Observer

Add `runId?: string` to the internal MCP call options and forward it through:

```text
ToolService.callTool
  -> McpServicePort.callTool
  -> McpService.callTool
  -> ToolManager.callTool
```

The value is execution metadata only. Never inject `runId` into the CUA tool arguments.

Inject a narrow `ComputerUsePreviewObserver` into `ToolManager`. It receives only resolved
execution facts:

```ts
type ComputerUsePreviewCall = {
  conversationId: string
  runId: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  source: {
    serverName: string
    ownerPluginId?: string
    sourceId?: string
  }
}

interface ComputerUsePreviewObserver {
  shouldCaptureAfterClick?(call: ComputerUsePreviewCall): boolean
  started(call: ComputerUsePreviewCall): void
  completed(call: ComputerUsePreviewCall, result: MCPToolResponse): void
  failed(call: ComputerUsePreviewCall, error: unknown): void
}
```

Invoke `started` immediately before the resolved MCP client call. Invoke exactly one terminal
callback after success or failure. The optional post-click predicate is synchronous, failure-safe,
and may authorize only a PiP-eligible current target. Agent-requested observer work must not alter
the MCP response, permission flow, abort semantics, tool latency, or error propagation. Private
post-click work is asynchronous and must not delay or mutate the original click result.

Calls without a conversation ID or run ID remain valid MCP calls but are not preview-eligible.

### Computer Use Presenter

Add a main-process `ComputerUsePreviewPresenter` that owns:

```ts
type ComputerUsePreviewTarget = {
  hostWindowId: number
  sessionId: string
  runId: string
  toolCallId: string
  pid: number
  windowId: number
  epoch: number
  dismissedRunId: string | null
}
```

The presenter:

- recognizes snapshot calls and target changes;
- advances `epoch` before each new run or target;
- resolves the host from the active renderer/session binding instead of trusting renderer-supplied
  window IDs;
- validates and decodes supported inline images in the main process;
- resizes and encodes one bounded JPEG;
- keeps at most one transform in flight per active target;
- drops queued intermediate work and retains only the latest pending result;
- revalidates session, run, target, tool call, claim, and epoch before presentation;
- sends a data URL directly to NativeKit when the native capability is available;
- owns stop, suspend, resume, dismiss, and shutdown cleanup.

### Renderer Coordination

Add a focused `AgentComputerUsePiP.vue` beside `AgentBrowserPiP.vue` in `ChatTabView.vue`.

On the native path it is a headless lifecycle controller:

- derive active session and `working` status from existing stores;
- observe host focus through the existing `WindowClient`;
- call typed mode routes only when derived state changes;
- render no image DOM and receive no frame bytes.

When NativeKit is unavailable, it receives `none`, subscribes to no frame bytes, and renders no PiP
DOM.

Keep the Computer Use component separate from `AgentBrowserPiP.vue`. Extract shared renderer logic
only if implementation reveals stable duplication; the source rules and controls are intentionally
different.

## Typed Contracts

Add focused Computer Use preview contracts rather than exposing generic MCP results.

### Routes

```ts
type ComputerUsePreviewMode = 'eligible' | 'suspended' | 'stopped'

type SetComputerUsePreviewModeInput = {
  sessionId: string
  mode: ComputerUsePreviewMode
}

type SetComputerUsePreviewModeOutput = {
  updated: boolean
  surface: 'native-overlay' | 'renderer-canvas' | 'none'
}

type DismissComputerUsePreviewInput = {
  sessionId: string
  runId: string
}

type DismissComputerUsePreviewOutput = {
  dismissed: boolean
}
```

- `computerUse.setPreviewMode`: validate the route sender against the active session binding.
- `computerUse.dismissPreview`: dismiss only an exact current session/run match.

`eligible` means the active renderer session is working. Native host focus listeners remain
authoritative for actual visibility. `suspended` retains the current valid frame while hiding it.
`stopped` removes presenter state for that session.

### Renderer Frame Event

```ts
type ComputerUsePreviewFrame = {
  sessionId: string
  runId: string
  sequence: number
  width: number
  height: number
  mimeType: 'image/jpeg'
  data: Uint8Array
  timestamp: number
}
```

The typed `computerUse.preview.frame` contract remains bounded, but native capability failure does
not select `renderer-canvas` or publish image bytes to the renderer.

## Image Pipeline

### Validation

- Accept only inline PNG and JPEG image blocks.
- Reject unsupported MIME types, malformed base64, empty data, and invalid dimensions.
- Cap encoded input at 16 MiB before decode.
- Cap decoded width and height at 8192 px.
- Never use image metadata, target window title, or application name as user-visible or logged
  content.

### Transform

- Preserve aspect ratio within 480 x 300.
- Never upscale the source.
- Encode JPEG at quality 72.
- Enforce a 512 KiB encoded output ceiling.
- Keep one transform in flight for the active target.
- If another valid result arrives during transform, retain only the latest pending result.
- Validate the active epoch after decode and again before presentation.

The NativeKit surface continues to render with a maximum edge of 360 DIP. The larger encoded frame
retains useful detail on scaled displays without increasing overlay geometry.

### Memory and Privacy

- Keep frames in memory only.
- Do not write snapshots to disk.
- Do not add snapshots to settings, telemetry, crash metadata, or logs.
- Do not log base64, pixel buffers, window titles, or full CUA arguments.
- Release superseded buffers and renderer resources promptly.
- Reuse the original MCP response for conversation rendering; PiP must not create a second cached
  artifact.
- Discard every non-image field from a private post-click response; do not publish, cache, persist,
  or return that response to the Agent.

## Platform Behavior

The feature follows the existing NativeKit support matrix:

| Runtime | Surface |
| --- | --- |
| macOS arm64/x64 | Native overlay |
| Windows x64 | Native overlay |
| Windows arm64 | No Computer Use PiP |
| Linux x64/arm64 under X11 or supported XWayland | Native overlay |
| Linux native Wayland | No Computer Use PiP |
| Missing/corrupt addon or native startup failure | No Computer Use PiP |

No platform capture permission is added because both Agent-requested and private snapshots use the
existing Computer Use tool. Existing CUA permission behavior is unchanged.

If toolbar configuration or host attachment fails after initialization, hide/remove the native
presentation, disable preview state, and continue the Agent without interruption. A frame-push
failure retains the previous presentation and retries without interrupting the Agent.

## Performance Budget

- Additional captures: at most one per eligible successful `click`; zero when PiP is not eligible.
- Additional idle polling: zero.
- Idle CPU when no result is being transformed: effectively zero.
- Maximum transforms in flight per active target: one.
- Pending-frame policy: latest wins; no unbounded queue.
- Valid result receipt to visible frame: p95 at or below 150 ms on the reference desktop.
- Synchronous NativeKit `pushImage()` warning threshold: 25 ms, preserving the Browser baseline.
- Encoded output: at most 512 KiB.
- Native path renderer image payloads: zero.

These are acceptance budgets, not claims that every CUA action produces a snapshot.

## Failure Behavior

| Failure | Behavior |
| --- | --- |
| Permission response instead of invocation | Do not claim or show Computer Use PiP |
| Missing run/session identity | Execute tool normally; skip preview |
| Invalid `pid` or `window_id` | Execute tool normally; skip preview |
| Failed `get_window_state` | Retain valid frame for same target; never show error payload |
| Failed private post-click snapshot | Retain valid frame; do not change or delay the click result |
| Unsupported or malformed image | Ignore frame and retain prior valid frame |
| Oversized image | Reject frame and record a rate-limited metadata-only warning |
| Stale/out-of-order result | Drop by claim, epoch, run, target, and tool-call validation |
| Target changes | Hide/remove old presentation; wait for first valid new-target frame |
| Native overlay unavailable | Show no Computer Use PiP; continue CUA normally |
| Host loses focus | Hide while retaining current valid frame |
| Session/run stops | Remove presentation and release frame state |
| Presenter shutdown | Unsubscribe listeners, remove image, detach host, stop shared owner once |

Preview failures never change the MCP tool result or Agent execution outcome.

## Acceptance Criteria

### User Behavior

- A successful current-run `get_window_state` image produces one read-only latest-snapshot PiP when
  the active DeepChat chat is foreground, working, and NativeKit is available.
- The PiP is never blank and appears only after its first valid frame.
- Later valid snapshots for the same target replace the visible image.
- An eligible successful `click` schedules a private PiP-only snapshot and may refresh the visible
  image without adding screenshot content to the Agent response.
- The Computer Use PiP contains exactly one **Close** button.
- Dragging is native on supported platforms; unavailable platforms show no Computer Use PiP.
- Close suppresses only the current run and never changes the Agent or target application.
- A later run may show a new PiP after its first valid snapshot.
- Host blur/hide/minimize and route/session switch hide the PiP without leaking another session's
  pixels.
- Terminal run/session state removes the PiP.

### Architecture and Safety

- Browser and Computer Use share one process-global NativeKit owner.
- Browser keeps **Open in panel** plus **Close** and all existing handoff behavior.
- Computer Use ignores NativeKit activation and exposes no open-panel action.
- Source ownership changes only on explicit tool activity; frame refresh does not steal ownership.
- `runId` reaches `ToolManager` as execution metadata and is not added to MCP arguments.
- CUA identity is determined from resolved plugin ownership metadata.
- No generic MCP pixel event is introduced.
- Native frames do not enter the renderer.
- No idle CUA polling or new capture subsystem is introduced; private capture is bounded to one
  asynchronous request per eligible successful `click`.
- Oversize, malformed, stale, and out-of-order images cannot replace a current frame.
- All image bytes stay memory-only and are absent from logs and telemetry.

### Verification

- Unit tests cover foreground-scoped claim arbitration, run-scoped dismissal, target changes, stale
  epochs, and lifecycle transitions.
- MCP integration tests cover run propagation, trusted CUA recognition, permission paths, valid
  result observation, post-click private capture isolation, failure observation, and unchanged tool
  responses.
- Image pipeline tests cover PNG/JPEG, malformed base64, unsupported MIME, dimension/input/output
  limits, aspect ratio, no upscale, and latest-wins scheduling.
- Renderer tests cover native headless mode, unavailable no-surface behavior, close, focus, unmount
  cleanup, and session switching.
- Browser regression tests cover toolbar profile switching, activation, dismissal, capture refresh,
  and panel handoff.
- Packaged QA covers one NativeKit runtime and one native-unavailable runtime.

## Rollout

Land behind an internal feature gate if cross-platform packaged QA cannot complete in the same
change. The gate must disable only the Computer Use preview observer/presenter; it must not alter
CUA tool execution or Browser PiP.

Do not call the feature complete until Browser regression coverage and at least one native plus one
native-unavailable packaged run pass. Update this status and the linked Browser NativeKit
architecture document after implementation.
