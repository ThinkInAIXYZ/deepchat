# Guard-Triggered Stops Need Actionable Terminal Projection

## GitHub

- Issue: https://github.com/ThinkInAIXYZ/deepchat/issues/2122
- Classification: complex reliability bug
- Priority: P2
- Status: implementing on `fix/issue-2122-guard-stop-terminal`

## Issue And Impact

Safety guards already stop an Agent correctly. The durable stop reason already exists on
`MessageMetadata.runStopReason` and `execution/run_terminal.stopReason`. Product surfaces still treat
the stop as an ordinary completion or an unexplained failure:

- `max_tool_calls` stamps `runOutcome = completed`, so the renderer and CLI look finished.
- `no_progress` and `max_turns` already stamp `error`, but the renderer shows generic
  "request failed" plus an English raw string, and CLI `runs.get` blanks assistant text when
  `message.status !== 'sent'`.
- Renderer never reads `runStopReason`. `PublicRunSnapshot` has no stop reason.

Users cannot tell a model-chosen finish from a budget stop, and automation cannot see a partial
result.

## Root Cause

The facts are already authoritative. The missing work is projection:

- `process.ts` keeps `max_tool_calls` as `completed` to avoid claimed-queue rollback, Session
  `error`, and skipped pending-input drain.
- `no_progress` / `max_turns` already fail, but `MessageBlockError` does not key off
  `runStopReason`.
- CLI snapshot and watch contracts expose only `status` / `phase`.

## Fix Design

Protective thresholds and journal outcomes stay unchanged.

1. Do not add a fifth `ExecutionRunOutcome`. `completed | paused | aborted | error` remains the
   durable set. `runStopReason` stays an open string.
2. Do not add a new `action_type`. Renderer banners project `runStopReason` from persisted message
   metadata. No second copy is written into transcript blocks.
3. Continue starts a new physical run through `sendMessage` with non-empty visible user text. It
   must not call `retryMessage` or mutate the historical `run_terminal`.
4. Public local-control V2 outputs stay shape-compatible. `PublicRunSnapshot` and
   `events.subscribe` do not gain fields. `LOCAL_CONTROL_SURFACE_VERSION` stays 2.

## Contract Surfaces

Renderer projection of `runStopReason` is the user-visible contract. CLI V2 run routes keep their
existing outputs so an older client can keep talking to a newer server.

## Compatibility And Safety Invariants

1. Guard thresholds stay at 128 tool calls, two identical batches for correction, and four for
   no-progress termination.
2. `max_tool_calls` remains `completed` in process, journal, and message status.
3. Historical `run_terminal` rows are never rewritten.
4. Continue creates a new `runId` and a visible user message.
5. Claimed queue input that hits the tool-call limit is still consumed, never rolled back.

## Tasks

- [x] Project `runStopReason` in the renderer with reason-specific copy and Continue.
- [x] Keep public CLI V2 run outputs unchanged.
- [x] Prevent Continue double-submit and hide Continue on historical guard banners.
