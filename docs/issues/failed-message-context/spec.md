# Failed Message Context Preservation

## User Story

When an agent loop fails or is canceled, the next user turn should still know what happened. The failed assistant message, including any partial progress and the failure reason, must be included in the next request context so the model can recover instead of repeating work.

## Acceptance Criteria

- Assistant messages with status `error` are eligible for future agent context.
- User messages with status `error` and all `pending` messages remain excluded from normal next-turn context.
- Error blocks are converted into readable context text:
  - `common.error.userCanceledGeneration` becomes `User canceled generation`.
  - Unknown error text is preserved as-is.
- If the failed assistant message has partial content, that content is preserved and followed by a failure or cancellation summary.
- Settled tool calls with non-empty responses are still replayed; unfinished tool calls are not fabricated into tool results.
- Auto-compaction and resume context budgeting consider assistant error records consistently with next-turn context.

## Non-Goals

- No database schema changes.
- No IPC, renderer UI, or message storage format changes.
- No attempt to resume unfinished tool calls without stored tool responses.
