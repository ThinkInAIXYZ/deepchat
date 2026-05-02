# Remote Process Log

## Summary

Replace the temporary remote status message with an ordered, persistent remote transcript for Telegram and Feishu. Each normal assistant turn keeps:

- one ordered message sequence derived from assistant blocks
- persistent process-log segments for tool-call progress
- answer segments that stay in the same order as the desktop transcript

Process segments survive after the turn completes and are not erased. New answer and process phases may create new remote messages instead of rewriting the earliest message in the turn.

## Acceptance Criteria

- `RemoteConversationSnapshot` exposes `deliverySegments`, ordered exactly as remote delivery should appear.
- `deliverySegments` contain only `process`, `answer`, and `terminal` segments.
- Process segments contain one line per completed tool-call argument payload using the format `EMOJI raw_tool_name: "preview"`.
- Remote trace preview reuses the desktop tool-summary extraction rule: parse JSON when possible, summarize the first meaningful value, flatten to one line, then truncate for remote delivery.
- Failed tool calls append an extra `❌ raw_tool_name: "error preview"` line inside the same process segment.
- Consecutive tool calls merge into one process segment until an answer block appears.
- Consecutive answer blocks merge into one answer segment, even if ignored remote-only block types appear between them.
- Telegram and Feishu stop depending on separate trace/content tracks for normal turns and instead sync ordered delivery segments by key.
- New later segments append after earlier ones; completion must not compact all answer text back into the first answer message.
- Tool-only turns keep only the process segment and do not append the generic no-response fallback when the process log already explains the turn.
- Timeout or terminal failure text appends as a trailing terminal segment only when existing answer/process segments do not already express that final state.

## Non-Goals

- Showing reasoning content in remote transcripts.
- Showing tool result bodies, search result bodies, or image payloads in the process log.
- Adding a user-facing settings toggle for remote transcript mode in this increment.
