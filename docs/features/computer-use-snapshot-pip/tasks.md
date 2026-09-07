# Computer Use Snapshot Picture-in-Picture Tasks

## Status

Implementation, focused automated verification, and the complete renderer suite are complete.
The complete main suite retains one unrelated provider-metadata expectation failure. Performance
measurement and packaged platform QA are still open.

## Task List

- [x] T01 - Propagate Agent run identity through MCP execution
  - Add `runId` to internal `McpServicePort`, `McpService`, and `ToolManager` call options.
  - Forward `ToolCallOptions.runId` from the MCP branch in `ToolService`.
  - Keep the value out of `MCPToolCall` serialization and CUA arguments.
  - Add focused propagation and unchanged-arguments tests.

- [x] T02 - Extract the shared process-global PiP coordinator
  - Move NativeKit lifecycle, capability detection, host/display synchronization, and presentation
    ownership out of the Browser-only adapter.
  - Instantiate one coordinator in the application composition root.
  - Preserve the current Browser native and Canvas behavior.
  - Keep one visible PiP invariant.

- [x] T03 - Add source profiles and arbitration
  - Keep Browser **Open in panel** plus **Close** controls.
  - Add a Computer Use profile with **Close** only and ignored activation.
  - Make Browser tool activity and CUA snapshot-call starts claim their source.
  - Prevent frame refreshes from stealing ownership.
  - Prevent background host/session claims from preempting the foreground session.
  - Add shared run-scoped dismissal.

- [x] T04 - Add the narrow Computer Use MCP observer
  - Inject `started`, `completed`, and `failed` callbacks into `ToolManager`.
  - Use resolved `ownerPluginId`/`sourceId`, original tool name, and prepared arguments.
  - Observe only actual invocations after permission resolution.
  - Preserve tool response, abort, progress, and error semantics.

- [x] T05 - Implement Computer Use target and run state
  - Add `ComputerUsePreviewPresenter`.
  - Track host, session, run, tool call, `pid`, `windowId`, epoch, claim, and dismissal.
  - Remove the prior presentation on a new run or target.
  - Reject stale and out-of-order terminal results.

- [x] T06 - Implement the bounded snapshot pipeline
  - Accept successful `get_window_state` PNG/JPEG inline images only.
  - Validate base64, input size, decoded dimensions, and output size.
  - Resize within 480 x 300 without upscaling and encode JPEG quality 72.
  - Keep one transform in flight and one latest pending result.
  - Keep frames memory-only and logs pixel-free.

- [x] T07 - Add typed Computer Use preview contracts
  - Add `computerUse.setPreviewMode`.
  - Add `computerUse.dismissPreview`.
  - Add Canvas-only `computerUse.preview.frame`.
  - Expose routes/events through the typed preload client.
  - Validate route sender and active session in main.

- [x] T08 - Add renderer lifecycle coordination
  - Mount `AgentComputerUsePiP.vue` beside the Browser PiP controller.
  - Derive active session, working state, route, and focus from existing stores/clients.
  - Send `eligible`, `suspended`, and `stopped` transitions.
  - Keep native mode headless and free of image events.

- [x] T09 - Add the Canvas fallback UI
  - Render the latest valid snapshot with one **Close** button.
  - Make non-control points draggable without forwarding target input.
  - Retain old pixels until a new frame is fully decoded.
  - Reject stale frame sequences and release renderer resources on teardown.
  - Reuse `common.close` without adding new copy.

- [x] T09a - Disable fallback UI when NativeKit is unavailable
  - Load NativeKit only when a concrete Computer Use target exists.
  - Return `none` after a process-stable native load failure.
  - Subscribe to no renderer frames and render no Computer Use PiP.
  - Preserve CUA tool execution and results.

- [x] T10 - Complete lifecycle and privacy cleanup
  - Hide on host blur/hide/minimize and inactive route/session.
  - Remove on terminal run/session, target change, host close, and shutdown.
  - Ensure another host/session can never see retained pixels.
  - Ensure no disk, settings, telemetry, crash metadata, or generic MCP event stores frame bytes.

- [x] T11 - Add main-process regression coverage
  - Test shared coordinator startup/shutdown, toolbar switching, arbitration, and dismissal.
  - Test Browser activation, close, capture refresh, and panel handoff after extraction.
  - Test CUA recognition, permission paths, run identity, target changes, and stale results.
  - Test valid, malformed, unsupported, oversized, failed, and aborted image results.
  - Test native/fallback routing and latest-wins scheduling.
  - Coordinator, Browser extraction, trust/permission/run propagation, native/fallback,
    PNG/JPEG, malformed/unsupported/oversized/dimension validation, failed/aborted calls, target
    epochs, dismissal, and latest-wins are covered.

- [x] T12 - Add renderer regression coverage
  - Test native headless mode and absence of frame subscriptions.
  - Test Canvas first frame, frame retention, sequence rejection, drag, and close.
  - Test focus, minimize, session switch, terminal state, and unmount cleanup.
  - Verify Computer Use exposes no expand/open-panel behavior.
  - Native headless mode, first Canvas frame, frame retention, target epoch/sequence rejection,
    close-only controls, focus suspend/resume, terminal cleanup, drag, session switch, unmount, and
    Browser supersession are covered.

- [x] T13 - Add PiP-only post-click refresh
  - After an eligible successful exact CUA `click`, asynchronously invoke one private
    `get_window_state({ pid, window_id })`.
  - Gate the call on trusted plugin ownership, valid session/run/target identity, active PiP, and
    non-dismissed presenter state.
  - Route the private result only through the preview observer; never publish, cache, or return it
    to the Agent.
  - Preserve click response, latency, permission, abort, and failure behavior.
  - Cover successful isolation plus failed, untrusted, invalid-target, and inactive-preview paths.

- [ ] T14 - Verify performance budgets
  - Confirm at most one private capture per eligible successful `click` and zero idle polling.
  - Confirm one transform in flight with no unbounded queue.
  - Measure p95 valid-result-to-visible latency against the 150 ms budget.
  - Keep NativeKit slow-push warning behavior at 25 ms.
  - Confirm native mode sends zero image bytes to the renderer.

- [ ] T15 - Run packaged platform QA
  - Verify one NativeKit native-overlay runtime.
  - Verify one native-unavailable runtime.
  - Verify Browser opens its existing side panel and Computer Use shows no PiP.
  - Exercise host focus/minimize/restore and target-app foreground behavior.
  - Exercise Browser/Computer source transitions and toolbar profile changes.
  - Exercise close, later run, route/session switch, and app shutdown.

- [ ] T16 - Run repository verification
  - Run `pnpm run format`.
  - Run `pnpm run i18n`.
  - Run `pnpm run lint`.
  - Run `pnpm run typecheck`.
  - Run focused main and renderer tests, then the complete affected suites.
  - Partial: format, i18n, lint, typecheck, focused suites, and all 1,625 renderer tests pass. The
    main suite passes 5,383 tests and fails only
    `ModelConfigHelper > Configuration Priority > uses provider metadata until a user config
    overrides it`; the unchanged provider test also fails in isolation.

- [ ] T17 - Close implementation documentation
  - Update the proposal status and record deviations.
  - Update the Browser NativeKit architecture with the implemented shared-owner contract.
  - Mark only verified tasks complete.
  - Include BEFORE/AFTER ASCII layouts and platform QA status in the PR.
  - Partial: implementation status, deviations, linked Browser architecture, verified tasks, ASCII
    layouts, and open QA are recorded. PR handoff remains open.

## Implementation Order

1. T01-T03 establish identity and safe process-global ownership.
2. T04-T06 connect trusted CUA results to a bounded main-process snapshot pipeline.
3. T07-T09 add typed renderer coordination and fallback UI.
4. T10-T12 harden lifecycle, privacy, and regressions.
5. T13 adds event-driven post-click refresh.
6. T14-T17 measure, validate, and close documentation.

## Done Definition

- A current successful CUA `get_window_state` image can show one latest-snapshot PiP, and an
  eligible successful `click` can schedule one private PiP-only refresh without idle polling.
- Browser and Computer Use safely share one NativeKit owner and retain source-specific controls.
- Computer Use PiP has only **Close**, is read-only, and never affects the Agent or target
  application.
- Run, target, session, host, and epoch validation prevent stale pixel disclosure.
- Native delivery avoids renderer image traffic; unsupported runtimes expose no Computer Use PiP.
- Image work is memory-only, bounded, latest-wins, and covered by focused tests.
- Browser PiP behavior remains regression-tested.
- Required checks and at least one native plus one native-unavailable packaged QA run pass.
