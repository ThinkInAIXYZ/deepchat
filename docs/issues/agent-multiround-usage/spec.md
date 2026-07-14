# Agent Multi-Round Usage Accounting

## Issue

`processStream` can make multiple provider requests while an Agent executes tools. Every provider
round emits its own usage event, but `accumulator.ts` currently overwrites message metadata with the
latest event. The persisted message and usage dashboard therefore undercount multi-round Agent turns.

## Impact

- Token and cost statistics can represent only the last provider round.
- Performance investigations cannot tell how many provider rounds or tool calls produced a message.
- Deterministic Agent evaluations cannot compare orchestration efficiency using persisted metadata.

## Root Cause

Usage fields live only on `StreamState.metadata`. A usage event replaces those fields, and the loop
does not maintain a per-round snapshot plus run aggregate.

## Fix Plan

- Track the latest usage event separately as `StreamState.roundUsage`.
- At the end of each provider stream, add the round snapshot to run totals exactly once and clear it.
- Persist opaque run identity, terminal outcome/stop reason, cumulative usage, provider-round count,
  and executed-tool-call count in message metadata.
- Commit an observed usage event before handling an exception so partial provider responses are not
  lost; never infer usage when the provider emitted none.
- Persist accounting when a turn pauses or aborts, then seed a resumed stream from the persisted
  totals so one assistant message remains cumulative across user interactions.
- Count a permission-approved deferred tool before resuming the provider stream.
- Refuse a permission-approved deferred tool before invocation when its next count would exceed the
  global 128-call budget.
- Replace paused metadata with the actual terminal outcome when resume ends before `processStream`.

## Compatibility

No schema or IPC change is required because message metadata is stored as JSON. Existing consumers
ignore the new optional fields. Single-round values remain unchanged.

## Tasks

- [x] Extend stream/message metadata types.
- [x] Accumulate usage once per provider round.
- [x] Add single-round, multi-round, missing-usage, and failure-path tests.
- [x] Persist run identity and normalized terminal outcome metadata.
- [x] Keep tool counts and terminal metadata correct across every interaction-resume exit.
- [x] Keep deferred permission execution at or below the global tool-call cap.
- [ ] Run final unified tests, typecheck, format, i18n, lint, and build.

## Validation

- Two provider rounds reporting 10 and 20 total tokens persist 30 total tokens.
- Multiple usage events in one round use the latest cumulative event rather than summing snapshots.
- Provider/tool counts match executed orchestration work.
- Usage emitted before an `AbortError` remains persisted.
- A permission pause persists its partial totals and the resumed run adds to them once.
- A granted deferred tool increments the persisted cumulative tool count exactly once.
- A deferred tool rejected at the global cap does not execute or increment the persisted count.
- Resume cancellation and pre-stream failures no longer leave `runOutcome: paused` metadata.
