# Failed Message Context Preservation Plan

## Approach

- Add a shared runtime predicate for context-eligible records: include `sent` records and `assistant:error` records, exclude `pending` and `user:error`.
- Update `recordToChatMessages` to append a readable assistant summary for error blocks while preserving existing content, reasoning, and settled tool call replay behavior.
- Use the same eligibility predicate in new-turn history collection, resume context, and compaction inputs.

## Data Flow

- Failed generation already persists an assistant `error` record with terminal error blocks.
- On the next turn, `buildContext` selects eligible records and converts the failed assistant record into provider-facing assistant text.
- Compaction receives the same eligible assistant error records so summarized history matches provider context.

## Compatibility

- Stored records are unchanged.
- Existing sent history behavior and provider tool-message ordering remain unchanged.
- Pending interactions keep their existing resume path and are not included in normal next-turn context.
