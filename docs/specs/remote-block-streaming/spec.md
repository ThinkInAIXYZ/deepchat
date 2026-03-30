# Remote Block Streaming

## Summary

Upgrade Telegram and Feishu remote delivery from a single plain-text summary into a shared block-based transcript. Remote users should see completed assistant blocks as they become available, including reasoning, tool calls, tool results, search summaries, errors, and final answers.

## User Stories

- As a Telegram remote user, I can see completed reasoning/tool/result/answer blocks instead of only the final summary text.
- As a Feishu remote user, I can receive remote conversation output before the full run completes.
- As a remote user, I can still receive pending permission/question prompts after any completed blocks have already been delivered.
- As a remote user, I can read a complete final transcript from the sequence of block messages without depending on one duplicated final summary.

## Acceptance Criteria

- Remote snapshot generation exposes completed renderable blocks, current draft text, and a full-text fallback.
- Telegram draft mode keeps updating the current unfinished reasoning/content block while completed blocks are sent as normal messages.
- Telegram final mode and Feishu both deliver completed blocks incrementally during polling.
- Tool calls are delivered after arguments are complete, and tool results are delivered after the tool response is persisted.
- Tool results are summarized with metadata and preview text instead of dumping unbounded raw output.
- Search blocks render stored search results with titles and links when available.
- Image blocks render as text notices rather than binary payloads.
- Pending remote interactions still use the existing Telegram prompt / Feishu card flow and are not merged into the normal transcript.
- Existing remote fallback cases still work when no assistant blocks are available.

## Constraints

- No extra model call is allowed to summarize tool output.
- No binary image upload support is added for remote channels.
- Feishu remains append-only; no message edit requirement is introduced.

## Compatibility

- Existing remote command routing and pending interaction behavior remain unchanged.
- Old code paths that still read `snapshot.text` continue to have a fallback value.
