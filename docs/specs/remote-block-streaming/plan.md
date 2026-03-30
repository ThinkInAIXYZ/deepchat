# Remote Block Streaming Plan

## Summary

Implement a shared remote block renderer and make both Telegram and Feishu runtimes consume `renderBlocks` incrementally. The renderer becomes the source of truth for remote transcript formatting, while `draftText` handles only the currently unfinished reasoning/content block.

## Key Decisions

- Add `RemoteRenderableBlock` with stable `key`, `kind`, `text`, `truncated`, and `sourceMessageId`.
- Extend `RemoteConversationSnapshot` with:
  - `draftText`
  - `renderBlocks`
  - `fullText`
  - keep `text` as fallback for compatibility
- Render kinds:
  - `reasoning`
  - `toolCall`
  - `toolResult`
  - `search`
  - `imageNotice`
  - `answer`
  - `error`
- Use append-only completed blocks for incremental delivery; runtimes track only `lastDeliveredBlockCount`.
- Summarize tool results deterministically with counts + preview, not raw unbounded output and not LLM summarization.

## Data Flow

- `DeepChat` stream accumulation finalizes narrative blocks earlier when block type changes.
- `RemoteConversationRunner` parses assistant blocks, loads search results when needed, and builds:
  - `draftText`
  - `renderBlocks`
  - `fullText`
- Telegram runtime:
  - updates draft from `draftText`
  - sends newly completed `renderBlocks` as normal messages
- Feishu runtime:
  - sends newly completed `renderBlocks` immediately
  - remains append-only, no message editing
- Pending interactions still short-circuit to the existing prompt/card delivery after completed blocks are sent.

## Risks And Mitigations

- Narrative blocks staying `pending` too long would block incremental delivery
  - Mitigation: finalize trailing `content` / `reasoning_content` on block-type transitions and before search/action/error insertions
- Search blocks missing result details
  - Mitigation: load persisted search results by `messageId + searchId`, with URL-only fallback
- Long block payloads becoming unreadable
  - Mitigation: keep block boundaries, chunk by platform limit, and add continuation labels for later chunks

## Test Strategy

- Block renderer unit tests for reasoning/tool/search/image/full-text behavior
- Accumulator tests for early block finalization
- Runner tests for snapshot fields and render block output
- Telegram runtime tests for draft + incremental block delivery
- Feishu runtime tests for incremental block delivery before completion
