# Telegram Markdown Rendering Plan

## Approach

- Add a small Telegram outbound formatter in the main process.
- Use `telegram-markdown-formatter` to convert Markdown to the Telegram HTML subset.
- Preprocess common GFM pipe tables into fenced fixed-width text so they become Telegram `<pre>`
  blocks after conversion.
- Use formatted chunks only for assistant answer-style delivery segments and final fallbacks.
- Keep process/tool/status/control messages plain text.

## Runtime Flow

1. Normalize assistant answer text.
2. Convert pipe tables to fenced fixed-width text.
3. Convert Markdown to Telegram HTML.
4. Split HTML into Telegram-sized chunks.
5. Send or edit chunks with `parse_mode: "HTML"`.
6. If Telegram returns a parse-entity error, retry that chunk as plain text.

## Compatibility

- Stored delivery state continues to save original text so existing stream alignment semantics stay
  stable.
- Chunk comparison for formatted answer segments uses the rendered Telegram chunks.
- Existing remote settings, bindings, and IPC surfaces are unchanged.

## Test Strategy

- Unit-test Markdown conversion, table fallback, chunking, and fallback classification.
- Unit-test Telegram client `parse_mode` payloads.
- Update poller tests to cover formatted answer delivery and plain process delivery.
