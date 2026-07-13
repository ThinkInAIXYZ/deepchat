# Native Agent Evaluation Baseline

## Problem

The native Agent has broad unit coverage, but changes to the loop cannot currently be judged against
one deterministic behavior baseline. Existing tests prove individual branches while providing no
shared scenario contract or aggregate measures for task completion, tool use, pause, cancellation,
and bounded-loop failure.

## Goal

Add an offline Vitest evaluation harness around the production `processStream` loop. It must use
scripted provider events and fake tools, require no credentials or network, and fail CI when a stable
behavior contract regresses.

## Acceptance Criteria

- A dedicated `test:agent:eval` command runs only native-Agent evaluation scenarios.
- Scenarios cover direct completion, one and multiple tool rounds, tool failure, permission pause,
  cancellation, pending-input yield, bounded provider/tool rounds, no-progress termination, empty
  output, generic provider errors, and context errors.
- Every scenario reports a normalized outcome and measures provider rounds, tool calls, elapsed time,
  and token usage when supplied by the scripted provider.
- Every scenario asserts the persisted run ID, outcome, stop reason, provider/tool counts, and all
  supplied usage/cache-token fields rather than trusting harness-side counters alone.
- Aggregate assertions cover success/outcome expectations and prevent extra provider or tool calls.
- The harness never writes repository artifacts and is deterministic under fake timers.
- Production Agent behavior is exercised through `processStream`; the harness does not duplicate the
  loop implementation.

## Constraints

- No real provider calls, model snapshots, database migration, or renderer dependency.
- Content quality and semantic task success remain future real-model evaluation work.
- The harness validates the existing optional message-metadata accounting contract; it does not add
  a renderer API or upload telemetry.

## Non-Goals

- Comparing model vendors or prompts using live credentials.
- Adding a renderer dashboard or uploading traces.
- Treating wall-clock performance from mocked tests as a production latency benchmark.
