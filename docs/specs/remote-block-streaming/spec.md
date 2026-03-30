# Remote Block Streaming

## Summary

Keep the shared remote block renderer, but move Telegram and Feishu to a dual-track remote delivery model:

- one temporary status message that only shows execution state
- one answer-text message that streams user-visible answer content

The status message is deleted when the turn finishes. The answer-text message remains as the remote transcript for that turn.

## User Stories

- As a Telegram remote user, I can see answer text appear progressively without also receiving reasoning/tool/search transcript spam.
- As a Feishu remote user, I get the same streaming answer experience with a separate execution-status indicator.
- As a remote user, I can still receive pending permission/question prompts as separate actionable messages while preserving any answer text that has already streamed.
- As a remote user, I keep the final answer in chat history while the temporary status message disappears after the turn ends.

## Acceptance Criteria

- Remote snapshot generation continues to expose `statusText`, `text`, and `finalText`, while keeping `draftText`, `renderBlocks`, and `fullText` for compatibility.
- During execution, `text` contains only streamable answer content from `content` blocks; `reasoning_content`, tool, search, and image transcript text never enters the answer stream.
- `statusText` still reflects the current phase, such as thinking, calling a tool, reviewing search results, writing, or waiting for user input.
- Telegram creates a temporary status message and a separate streamed answer message for a normal assistant turn.
- Feishu creates a temporary status message and a separate streamed answer message for a normal assistant turn.
- The status message is updated in place during execution and deleted when the turn completes, errors, times out, or produces no response.
- The answer-text message is updated in place while it fits within the platform limit. When it grows beyond the limit, earlier chunks remain fixed and only the newest tail chunk stays editable.
- Pending interactions set the status message to a waiting state, preserve already-streamed answer text, and continue to use the existing Telegram prompt / Feishu card flow.
- `/status` no longer exposes Telegram stream mode information.

## Constraints

- No extra model call is allowed to summarize tool output or synthesize status text.
- Desktop-local message rendering and persistence remain unchanged.
- No binary image upload support is added for remote channels.

## Compatibility

- Existing remote command routing and pending interaction behavior remain unchanged.
- Old code paths that still read `draftText`, `renderBlocks`, or `fullText` continue to have fallback values.
- Legacy `TelegramStreamMode` config remains readable for compatibility, but remote delivery no longer changes behavior based on it.
