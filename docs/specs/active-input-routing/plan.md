# Active Input Routing Plan

## Behavior Model

- `sendMessage`: normal turn submission. It starts immediately when the session is idle.
- `steerActiveTurn`: active-turn correction. If a generation is running, interrupt it cleanly and
  continue with the steering message in the same session. If the session is idle, fall back to
  normal turn submission.
- `queuePendingInput`: explicit future turn. It never claims active-turn semantics and remains
  editable until claimed.

## Event Flow

1. Renderer checks whether the session is generating.
2. Enter emits `submit`; ChatPage routes it to `steerActiveTurn` while generating and to
   `sendMessage` while idle.
3. Tab emits `queue-submit`; ChatPage routes it to `queuePendingInput`.
4. Runtime steer stores the steering payload as an interrupt continuation, aborts the active stream,
   marks the partial assistant message as sent, then starts a new user turn with the steering payload.
5. Queue draining remains FIFO and waits until the session is idle, errored-and-resumed, or completed
   without pending tool interactions.

## IPC Surface

- Add typed route `chat.steerActiveTurn`.
- Add renderer client method `steerActiveTurn`.
- Keep existing `sessions.queuePendingInput` for explicit queue.

## UI

- Input Enter remains the primary submit gesture.
- When generating, the toolbar send button tooltip/action label becomes Steer.
- Tab in the editor queues the draft while generating.
- Pending lane focuses on queued follow-ups; steer rows remain visible only for compatibility.

## Test Strategy

- Main presenter tests for idle send, explicit queue, and active steer interruption.
- Renderer tests for Enter versus Tab routing.
- Existing queue behavior should continue passing.
