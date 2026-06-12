# Plan

## Approach

- Track sessions whose pending turn queue was paused by an explicit user stop.
- Set that pause in `cancelGeneration` when a queue drain is active or pending turn input exists.
- Prevent automatic queue drains for `enqueue` and `completed` while the pause is active.
- Clear the pause when the user explicitly calls `resumePendingQueue`, when the session is
  destroyed, and when all pending inputs are gone.

## Test Strategy

- Add a main-process `AgentRuntimePresenter` regression test that starts a queued pending item,
  makes `processStream` return `aborted`, and verifies the item is released but not immediately
  claimed again.
- Keep existing queue and cancellation tests passing.
