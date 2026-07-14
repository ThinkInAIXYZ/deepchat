# Subagent Run Guardrails - Spec

> Status: **implemented; final validation pending**

## Problem

Native subagent runs currently have no lifetime limit. `timeoutMs` only limits how long an
`operation=wait` call blocks, so background children can remain active indefinitely and a parent
session can start an unbounded number of concurrent runs. Child handoffs also treat
`expectedOutput` as a replacement for the default guidance, which makes aggregation quality
inconsistent.

## Requirements

1. Every run has a deadline independent of `operation=wait`, configured by optional
   `runTimeoutMs`. The default is 300000 ms (five minutes); accepted values are 1000-1800000 ms.
2. At the deadline, all unfinished tasks become cancelled, created child sessions receive
   cancellation, the run resolves even if child execution is still blocked, and the serialized run
   records the cancellation reason.
3. A parent session may have at most three nonterminal runs. Terminal runs retained for inspection
   do not count toward the limit.
4. Every child handoff requires `Result`, `Evidence`, `Changed Files`, `Validation`, and
   `Unresolved` markdown sections. Empty sections use `None`.
5. Caller-provided `expectedOutput` text is preserved as additional output guidance rather than
   replacing the standard contract.

## Acceptance Criteria

- Foreground and background runs enforce the same deadline.
- `list`, `info`, `log`, `wait`, and `kill` keep their existing meanings and run ownership checks.
- Serialized run data includes the configured timeout, absolute deadline, and cancellation reason.
- Manual cancellation, recursion prevention, and completed/error tape merge/discard behavior stay
  compatible.
- A cancelled child tape is not discarded until the child cancellation request settles; the run
  deadline itself still resolves without waiting for a blocked cancellation request.
- Focused fake-timer, capacity, serialization, and handoff tests pass.

## Non-goals

- Persisting run state across app restarts.
- Changing subagent recursion rules, task count limits, or slot selection.
- Adding per-child budgets or changing renderer IPC contracts.

## Open Questions

None.
