# Remote Block Streaming Plan

## Summary

Reuse the shared remote block renderer to derive two remote outputs:

- `statusText` for the temporary status message
- `text` / `finalText` for the streamed answer message

Telegram and Feishu both switch from “status message becomes final answer” to “temporary status + persistent streamed answer”.

## Key Decisions

- Keep `RemoteConversationSnapshot` fields:
  - `statusText`
  - `text`
  - `finalText`
  - compatibility fields: `draftText`, `renderBlocks`, `fullText`
- Redefine remote runtime use of `text`:
  - answer-content only
  - may update throughout execution
- Continue to build `RemoteRenderableBlock` data for compatibility and local display, but stop using those blocks as the primary remote transport payload.
- Keep deterministic tool-result summarization and final fallback generation.

## Data Flow

- `DeepChat` stream accumulation still finalizes narrative/tool/search/error blocks as before.
- `RemoteConversationRunner` parses assistant blocks and builds:
  - `statusText`
  - `text` as answer-only streamed content
  - `finalText`
  - compatibility fields (`draftText`, `renderBlocks`, `fullText`)
- Telegram runtime:
  - creates one temporary status message
  - creates one streamed answer message when answer content first appears
  - edits the status message as `statusText` changes
  - edits the streamed answer message as `text` grows
  - deletes the status message after syncing the streamed answer to `finalText`
- Feishu runtime:
  - mirrors the same two-message lifecycle with text updates and message deletion
- Pending interactions:
  - set the status message to waiting
  - keep any already-streamed answer content visible
  - continue using the existing prompt/card delivery

## Risks And Mitigations

- Long answers can exceed platform message limits mid-stream
  - Mitigation: split answer text into chunks, keep earlier chunks fixed, and continue editing only the newest tail chunk
- A resumed pending interaction could accidentally create duplicate temporary status messages
  - Mitigation: keep endpoint-scoped in-memory delivery state with `sourceMessageId`, `statusMessageId`, and `contentMessageIds`
- Status-message deletion may fail due to platform constraints
  - Mitigation: treat deletion as best-effort and always clear local transient state

## Test Strategy

- Block renderer unit tests for answer-only `text`, status extraction, and final fallback behavior
- Runner tests for `text` / `statusText` / `finalText` generation across reasoning, writing, and waiting states
- Telegram runtime tests for:
  - separate status and answer messages
  - temporary status deletion
  - streamed answer updates
  - long-answer editable tail behavior
  - pending prompt handling
- Feishu runtime tests for the same lifecycle plus card fallback behavior
