# Agent Terminal Outcome Consistency

## Issue

Several native Agent termination paths persist or return a terminal outcome that does not match the
provider/runtime condition that ended the turn. A generic provider error event can be finalized as a
successful message, while `max_tokens`, the tool-call hard cap, and context-window failures lose
their specific stop reason or usage in `ProcessResult`.

## Impact

- Provider failures can appear as completed assistant messages and dispatch success-shaped hooks.
- Persisted `runOutcome` / `runStopReason` can disagree with the visible terminal block.
- Session-end hooks and deterministic evaluations lose the actual stop reason and cumulative usage.
- Operational telemetry cannot distinguish a complete answer from a truncated or bounded run.

## Root Cause

`processStream` handles only context-window errors before its common success finalizer. Other error
events fall through to `finalize()`. The common finalizer also stamps `complete` after loop exits
without preserving why the loop stopped, and the context-window return omits fields already present
in persisted metadata.

## Fix Plan

- Route every provider `error` stop through the error finalizer, retaining context-window handling.
- Preserve explicit `max_tokens` and `max_tool_calls` reasons instead of overwriting them with
  `complete`.
- Return usage, stop reason, and error message for context-window failures.
- Use the same canonical provider/tool/empty stop reason in persisted metadata, `ProcessResult`, and
  terminal hooks.
- Mark tool calls rejected by the 128-call budget as unexecuted errors before finalizing the message.
- Reject permission-approved deferred execution before invocation when persisted accounting has
  already reached the 128-call budget, without incrementing beyond the cap.
- Give `processStream` sole ownership of terminal persistence after streaming starts; lifecycle code
  owns only pre-stream cancellation/error settlement and includes run identity and zero-count
  accounting there.
- Add process-level and deterministic evaluation coverage for each terminal path.
- Keep existing visible error-block and open-plan terminal behavior compatible.

## Tasks

- [x] Normalize generic provider error outcomes.
- [x] Preserve max-token and tool-call-limit stop reasons.
- [x] Return complete context-window failure metadata.
- [x] Add focused process/evaluation regression scenarios.
- [x] Align metadata, process results, and terminal hook stop reasons.
- [x] Mark budget-skipped tool blocks and remove double stream-abort settlement.
- [x] Enforce the same tool-call budget on deferred permission execution.
- [x] Persist complete pre-stream error/abort run metadata.
- [ ] Run final repository quality gates.

## Validation

- A generic provider error returns and persists `error`, never `completed`.
- `max_tokens` and the 128-call guard retain distinct stop reasons.
- Context-window errors return the same usage and reason persisted in message metadata.
- Terminal hooks receive the normalized reason and usage.
- A tool call that exceeds the hard cap is never finalized as a successful execution.
- A granted deferred tool at the hard cap does not invoke the tool and keeps `toolCalls` at 128.
- Stream abort writes one terminal message; pre-stream abort remains lifecycle-owned.

## GitHub

No GitHub issue sync was requested.
