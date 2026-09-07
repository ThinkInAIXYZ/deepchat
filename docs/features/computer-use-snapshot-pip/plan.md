# Computer Use Snapshot Picture-in-Picture Implementation Plan

## Status

Implemented on branch `codex/computer-use-snapshot-pip` on 2026-07-28.

Phases 1-5 are implemented with focused automated coverage, and the complete renderer suite passes.
The complete main suite retains one isolated, unrelated provider-metadata expectation failure.
Performance measurement and packaged native and native-unavailable platform QA remain open; the exact
remaining work is recorded in `tasks.md`.

CUA runtime, plugin, policy, skill, and asset updates are explicitly out of scope. The plan consumes
successful Agent-requested snapshots plus one bounded private `get_window_state` result after an
eligible successful `click`.

## Delivery Strategy

Establish one process-global PiP owner before adding the Computer Use presenter. NativeKit toolbar
configuration is global, so implementing a second standalone overlay adapter first would create a
known Browser/Computer race.

Then carry existing Agent run identity through the MCP execution path and observe only resolved,
trusted CUA calls. Build the bounded snapshot transform after those identities are available.
Finish with arbitration, lifecycle hardening, and Browser regression verification.

```text
shared NativeKit owner
        |
        +--> existing Browser producer
        |
        +--> Computer Use observer -> presenter -> snapshot producer
                                            |
                                  native or no PiP surface
```

## Phase 1: Shared PiP Ownership

### 1. Extract the process-global overlay owner

Refactor `AgentBrowserNativeOverlay` so NativeKit lifecycle and host synchronization are owned by
one coordinator instantiated in `src/main/app/composition.ts`.

Keep the extraction narrow:

- one on-demand NativeKit import and process-stable capability result;
- one `overlay.start()` and `overlay.stop()` lifecycle;
- one host attachment and host/display listener set;
- one visible presentation;
- toolbar profiles for Browser and Computer Use;
- source-specific activation/control callbacks;
- common visibility, removal, prepaint, and latency behavior.

The Browser presenter remains authoritative for Browser page/run/capture state. Native
unavailability uses the existing Browser activation event to open the side panel.

### 2. Add explicit toolbar profiles

Configure:

- Browser: **Open in panel**, then **Close**; activation opens the Browser panel.
- Computer Use: **Close** only; activation is ignored.

Switch profiles before presenting a source. Hide/remove the previous presentation during a profile
change so controls can never act on the wrong target.

### 3. Add claim arbitration

Represent the latest retained claim per source and host/session with run, target identity, and a
monotonic activity sequence.

- Explicit Browser tool activity claims Browser.
- An actual resolved CUA `get_window_state` invocation claims Computer Use.
- Frame updates are refreshes and cannot claim.
- A background or inactive host/session claim cannot preempt the foreground active session.
- A producer may present only while its claim is the latest eligible sequence for the foreground
  active host/session.
- Focus/session changes reevaluate retained sequences without manufacturing new activity.
- Dismissal applies to the current shared session/run.

Add coordinator unit tests before wiring the Computer Use image path.

## Phase 2: MCP Execution Identity

### 4. Propagate `runId`

Extend MCP call options through:

1. `McpServicePort.callTool`.
2. `McpService.callTool`.
3. `ToolManager.callTool`.
4. Narrow test doubles and call sites that implement those contracts.

Update `ToolService` to forward `ToolCallOptions.runId` on the MCP branch alongside access and abort
metadata. Do not add it to `MCPToolCall`, serialize it to the MCP server, or place it in tool
arguments.

Add a focused regression test proving that an Agent run ID reaches `ToolManager` for MCP calls and
that the outgoing CUA arguments remain byte-for-byte equivalent.

### 5. Introduce a narrow Computer Use observer

Define an injected main-process observer port with `started`, `completed`, and `failed` callbacks.
Call it only after `ToolManager` has:

- resolved the real MCP client and original tool name;
- loaded and validated the server config;
- completed access and permission checks;
- repaired and prepared tool arguments;
- identified the plugin source through `ownerPluginId` or `sourceId`.

Emit `started` immediately before actual client invocation. Emit one terminal callback without
changing response mapping or error propagation.

Calls lacking run/session identity and non-CUA calls should produce no preview callbacks.

### 5a. Add a private post-click refresh

After a successful exact `click` on the resolved official CUA client:

- require valid current session/run plus positive integer `pid` and `window_id`;
- synchronously ask the presenter whether the same target is PiP-eligible and not dismissed;
- asynchronously call `get_window_state` on that already resolved client with only
  `{ pid, window_id }`;
- send the private result only through the preview observer;
- never publish or return the private result to the Agent or conversation;
- retain the original click response and latency behavior if capture fails.

Do not trigger on permission responses, failed clicks, stale targets, `right_click`,
`double_click`, inactive PiP, or arbitrary servers. Do not add timers, polling, or CUA runtime
changes.

## Phase 3: Computer Use Snapshot Presenter

### 6. Add presenter state and lifecycle

Create `ComputerUsePreviewPresenter` in `src/main/desktop/computerUse/` and instantiate it once from
the application composition root.

Track:

- host window and active chat session;
- run and tool call;
- `pid` and `windowId`;
- epoch and active coordinator claim;
- renderer preview mode;
- dismissed run;
- current valid encoded frame;
- transform in-flight and latest pending result.

On a new run or target, advance the epoch, hide/remove the old presentation, release the old frame,
and wait for the first valid new frame.

### 7. Implement snapshot recognition

On observer callbacks:

- require the trusted Computer Use plugin identity;
- require original tool name `get_window_state`;
- parse finite positive integer `pid` and `window_id`;
- claim the Computer Use source at invocation start;
- accept only a successful result containing a supported inline image;
- retain the prior valid same-target frame on failure;
- discard results whose session, run, target, tool call, claim, or epoch is stale.

Use shared utilities only where an existing utility already matches the raw inline MCP image
contract. Do not route through cached message-preview artifacts.

### 8. Build the bounded image pipeline

In main:

1. Select the first supported PNG/JPEG inline image block.
2. Validate base64 and a 16 MiB encoded-input ceiling.
3. Decode and validate dimensions no larger than 8192 x 8192.
4. Resize proportionally within 480 x 300 without upscaling.
5. Encode JPEG quality 72.
6. Reject output larger than 512 KiB.
7. Revalidate epoch and claim.
8. Present to NativeKit when available; otherwise expose no preview surface.

Keep one transform in flight and one replaceable latest pending result. Add rate-limited,
metadata-only warnings for validation and latency failures.

## Phase 4: Typed Desktop Contracts and Renderer Coordination

### 9. Add routes and events

Add Computer Use preview schemas beside the existing desktop/browser contract organization:

- `computerUse.setPreviewMode`;
- `computerUse.dismissPreview`;
- `computerUse.preview.frame`.

Expose them through the existing typed preload/client boundary. Validate route sender and session
binding in main. Keep the bounded frame event source-compatible, but do not publish it when native
capability is unavailable.

### 10. Add the renderer controller

Mount `AgentComputerUsePiP.vue` beside `AgentBrowserPiP.vue` in `ChatTabView.vue`.

Derive:

- active chat session;
- working versus terminal session state;
- current route;
- host focus.

Send `eligible`, `suspended`, or `stopped` only when the derived mode changes. On
`native-overlay` or `none`, render nothing and never subscribe to image payloads.

### 11. Handle native unavailability

When NativeKit is unavailable:

- return `none` for Computer Use preview mode;
- subscribe to no renderer frame bytes;
- render no Computer Use PiP DOM;
- leave CUA tool execution, results, and target input unchanged.

Do not add a generic Browser/Computer Vue component unless the completed implementation has
meaningful stable duplication.

## Phase 5: Lifecycle, Privacy, and Failure Hardening

### 12. Complete foreground lifecycle

Use existing window/session binding and host listeners to:

- hide on blur, hide, minimize, inactive route, or suspended mode;
- restore only when the same current claim remains eligible;
- remove on stopped session, terminal run, target change, host close, or shutdown;
- prevent one host/session from seeing another session's retained frame.

When the target application comes to the foreground, DeepChat loses focus and the preview hides.

### 13. Enforce run-scoped dismissal

Validate exact session and run on close. Suppress all later frames and source changes for that run
without canceling tools. Clear suppression only for a later run or terminal cleanup.

### 14. Enforce memory-only image handling

Audit logs, events, caches, and teardown:

- no base64 or pixel buffer logging;
- no disk writes or settings persistence;
- no generic MCP image broadcast;
- no renderer image payload on native path;
- prompt release of stale buffers, Canvas resources, and native presentations.

## Phase 6: Verification and Rollout

### 15. Add focused automated coverage

Add the smallest tests for:

- shared coordinator profile switching, claims, dismissal, and stale refresh rejection;
- Browser toolbar/activation/dismissal regression;
- MCP `runId` propagation and unchanged outgoing arguments;
- trusted source recognition and permission/non-invocation paths;
- successful, failed, aborted, and out-of-order observer callbacks;
- presenter run/target/epoch transitions;
- image validation, resize, output limit, and latest-wins behavior;
- native delivery versus unavailable no-surface behavior;
- renderer focus/session modes, close, unavailable no-DOM behavior, and cleanup.

### 16. Measure performance

Instrument metadata-only durations for result receipt, transform completion, and NativeKit push.
Verify:

- at most one added capture call per eligible successful `click` and none while PiP is ineligible;
- zero idle polling;
- one in-flight transform;
- p95 result-to-visible latency at or below 150 ms;
- no renderer image traffic on native surface;
- no unbounded buffer retention.

### 17. Run platform QA

Verify at least:

- one packaged native-overlay runtime;
- one packaged native-unavailable runtime;
- host focus/minimize/restore;
- target application foreground transition;
- Browser-to-Computer and Computer-to-Browser claims;
- native toolbar profile switching;
- Browser side-panel handoff and Computer Use no-surface behavior when NativeKit is unavailable;
- run close/restart and session switching;
- malformed and oversized image handling.

Keep the feature behind an internal gate until native and unavailable behavior pass if the platform
matrix cannot complete in the implementation change.

### 18. Close documentation

After implementation:

- update `spec.md` status and record material deviations;
- update the linked Browser NativeKit architecture with the final shared-owner contract;
- mark completed tasks in `tasks.md`;
- include the BEFORE/AFTER ASCII layout in the PR;
- record remaining packaged platform QA explicitly.

## Verification Commands

Run after implementation:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:main
pnpm run test:renderer
pnpm exec electron-vite build
```

Prefer narrower test file invocations during development. Run the complete affected main and
renderer suites before handoff because the change crosses MCP execution, desktop presentation, and
renderer lifecycle boundaries.

## Rollback

The Computer Use observer and presenter must be independently disableable. Disabling them restores
the previous behavior without changing CUA tool execution.

If the shared coordinator causes a Browser regression, revert the coordinator integration as one
unit and keep the run-propagation changes only if their focused tests pass and no public behavior
changes. Do not fall back to two independent NativeKit owners.
