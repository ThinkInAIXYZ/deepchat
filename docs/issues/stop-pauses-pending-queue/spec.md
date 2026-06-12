# Stop Pauses Pending Queue

## User Need

When a user stops an active generation, DeepChat must stop the current turn and must not immediately
continue queued pending inputs. The pending queue should remain visible so the user can resume it
explicitly.

## Problem

If the active turn was launched from the pending queue, stopping the stream aborts that turn and
releases the claimed queue item back to `pending`. `drainPendingQueueIfPossible` then sees the
session is idle and still has pending input, so it automatically drains the same item again.

## Acceptance Criteria

- Stopping an active queued turn releases the queued input back to the waiting lane but does not
  auto-start it again.
- Stopping a normal active turn while queued items exist pauses automatic queue draining.
- Clicking resume queue clears the pause and allows pending items to drain.
- Destroying or emptying a session clears any stale pause state.

## Non-goals

- Remove the pending queue feature.
- Change rate-limit provider queues.
- Change normal stream cancellation behavior when no pending inputs are involved.
