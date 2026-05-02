# Active Input Routing

## User Story

When a session is already working, users can correct the active task immediately or queue a
follow-up intentionally. Pressing Enter should feel like Codex CLI steer: it directs the current
work. Pressing Tab or the explicit queue action should feel like Claude Code queued messages: it
waits for the current work to settle, then runs in order.

## Acceptance Criteria

- Idle Enter sends a normal user message immediately and does not create a pending queue item.
- Running Enter steers the active turn instead of silently queueing a future turn.
- Running Tab queues the draft as the next user turn and keeps the queue editable and reorderable.
- Running queue items drain FIFO only after the active turn can safely accept another user turn.
- Steer does not answer tool permission or question prompts; those prompts keep their existing
  interaction UI.
- A stream interrupted by steer should not leave a pending assistant message stuck forever.
- Existing queue edit, move, delete, resume behavior remains available for explicit queue items.

## Non-Goals

- Add Claude Code `/btw` side questions in this increment.
- Change ACP provider session modes or provider process management.
- Build provider-native mid-token input injection. Providers that cannot accept that use an
  interrupt-and-continue flow.

## Compatibility

Stored pending queue rows remain valid. Stored steer rows are still consumable by the runtime so
old sessions do not lose pending instructions, but the new UI no longer makes steer look like an
editable future queue item.
