# Provider Round Stop Contract — Spec

## Status

Implemented and validated.

## Problem

Before this contract was introduced, provider terminal reasons crossed multiple lossy translation
layers before the runtime settled a turn:

1. AI SDK or ACP emits its protocol-specific reason.
2. A provider adapter maps it to `StopStreamEvent.stop_reason`.
3. `accumulator.ts` maps the already-typed reason again.
4. terminal settlement maps or overwrites the accumulated reason.

Those layers hid invalid or bounded outcomes:

- AI SDK `content-filter`, `other`, and unknown values become `complete`;
- AI SDK `abort` stream parts are ignored;
- `stop_sequence` exists only as an intermediate value and becomes `complete` later;
- ACP `max_turn_requests` becomes `stop_sequence`, then `complete`;
- ACP compatibility settlement overwrites `max_tokens` with `complete`;
- `StreamState` starts at `complete`, so a stream without a terminal event can succeed;
- `StreamState.stopReason` contains an `abort` value that is never assigned.

## Goal

Translate each external protocol exactly once at its provider boundary, carry one closed provider
round reason through the accumulator, and preserve the resulting terminal reason through runtime and
ACP compatibility settlement.

## Protocol Mappings

AI SDK reasons are converted once at the stream adapter boundary:

| AI SDK input | Internal result |
| --- | --- |
| `stop` | `complete` |
| `length` | `max_tokens` |
| `tool-calls` | `tool_use` |
| `content-filter` | error event + `error` stop |
| `error` | error event + `error` stop |
| `other` | error event + `error` stop |
| abort stream part | error event + `error` stop |

A parsed legacy tool call may replace only a normal `stop` with `tool_use`; it cannot override a
bounded or failed finish. A matching local abort signal remains the sole owner of `user_stop`.

ACP reasons are converted once at the ACP content boundary:

| ACP input | Internal result |
| --- | --- |
| `end_turn` | `complete` |
| `max_tokens` | `max_tokens` |
| `max_turn_requests` | `max_turn_requests` |
| `refusal` | error event + `error` stop |
| `cancelled` | error event + `error` stop |

An unsupported runtime stop reason produces an error event and `error` stop. The exhaustive switch
still fails compilation when the SDK adds a declared reason that has not been mapped.

## Acceptance Criteria

- `StopStreamEvent.stop_reason` uses one exported closed type.
- The internal provider round reasons are `complete`, `tool_use`, `max_tokens`,
  `max_turn_requests`, and `error`.
- `stop_sequence` is removed from the internal event contract.
- `mapStopReason` is deleted and the accumulator assigns the typed reason directly.
- `StreamState.stopReason` starts as `null` and is reset before every provider round.
- A provider stream that ends without a terminal event settles as `provider_error`.
- AI SDK finish and abort parts are handled explicitly without a default-success branch.
- AI SDK `content-filter`, `error`, `other`, and an abort without a matching local abort signal
  settle as provider errors with a useful message.
- A local abort signal remains the sole source of the `user_stop` run outcome.
- ACP `max_turn_requests` and `max_tokens` survive compatibility projection settlement.
- ACP `refusal` and protocol-level `cancelled` settle as provider errors. They do not claim a local
  user stop without a matching local abort signal.
- Closed protocol enums use exhaustive switches without `default` branches.
- Focused tests cover every AI SDK finish reason, AI SDK abort, every ACP stop reason, accumulator
  assignment, missing terminal events, and ACP settlement preservation.

## Constraints

- Do not change renderer code or route payloads.
- Do not introduce a terminal-state framework, class hierarchy, adapter registry, or dependency.
- Keep provider-round reasons separate from run-level reasons such as `user_stop`,
  `max_tool_calls`, `context_window`, and `provider_error`.
- Preserve existing tool-loop behavior for `tool_use` and token-limit behavior for `max_tokens`.
- Keep raw ACP turn persistence unchanged; it already stores the protocol reason.

## Non-goals

- Unifying all `ProcessResult.stopReason` strings in this iteration.
- Removing the ACP provider compatibility path.
- Refactoring provider request tracing, usage accounting, or tool execution.
- Changing user-visible error presentation beyond exposing previously swallowed provider failures.

## Open Questions

None.
