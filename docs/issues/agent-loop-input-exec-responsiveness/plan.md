# Agent Loop Input And Exec Responsiveness Plan

## Runtime Input Flow

- Keep `chat.steerActiveTurn` as the active-turn entry point.
- Remove hidden steer injection from provider request construction.
- Store active steer input as a priority pending row while the current loop turn continues, so steer
  never aborts the in-flight provider request.
- At the process loop boundary after tool calls have returned, yield before continuing to the next
  provider request when a pending steer exists; the outer runtime then drains steer through
  `processMessage()` as a normal user message.
- Drain pending steer rows before pending queue rows by claiming the row and passing its payload to
  `processMessage()` with visible user-message persistence.
- Keep steer rows locked and non-editable, but show not-yet-entered steer rows in the pending input
  rail.

## Exec Isolation

- Keep the existing background exec core manager as the utility host implementation.
- Replace the exported singleton with a main-process RPC proxy that starts an Electron
  `utilityProcess` from the existing main bundle using a dedicated host flag.
- Route `start`, `waitForCompletionOrYield`, `poll`, `log`, `write`, `kill`, `clear`, `remove`,
  `cleanupConversation`, and `shutdown` through JSON-serializable messages.
- Track started sessions in the proxy so an unexpected utility exit can return diagnostic error
  snapshots for affected sessions.

## Compatibility

- `PendingSessionInputMode` remains `queue | steer`.
- Existing `sessions.convertPendingInputToSteer` route remains available for stored and older UI
  flows.
- `AgentBashHandler` keeps its current public return shape for completed and yielded commands.

## Validation

- Update agent runtime/session integration tests for visible steer turns.
- Update pending input rail tests to assert pending steer rows render as locked items.
- Preserve existing background exec core tests and add coverage around the utility proxy behavior
  where practical.
