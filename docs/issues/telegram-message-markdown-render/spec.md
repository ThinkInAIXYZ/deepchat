# Telegram Message Markdown Render

## User Story

When DeepChat's Telegram remote control bot delivers AI replies, command output, and other generated text, users should see properly rendered formatting (bold, italic, inline code, fenced code blocks, links, lists, blockquotes) instead of raw Markdown symbols (`**bold**`, `# heading`, ` ``` `).

## Acceptance Criteria

- `telegramClient.sendMessage` and `telegramClient.editMessageText` call the Telegram Bot API with `parse_mode: 'HTML'` when the outbound text contains formatted content.
- AI answer / process delivery segments routed through `TelegramPoller.syncDeliverySegment` and outbound actions dispatched via `dispatchOutboundActions` go through a Markdown → Telegram-HTML converter that handles bold, italic, strikethrough, inline code, fenced code blocks, headings, links, ordered/unordered lists, blockquotes, and horizontal rules.
- Common GFM pipe tables render as fixed-width preformatted text because Telegram does not support native table entities.
- Plain text (system replies, error messages, command echoes) is HTML-escaped and accepted by Telegram without parse-mode errors.
- Chunked streaming (4096 char limit) keeps each chunk independently renderable — partial Markdown left at a chunk boundary (e.g. an unclosed code fence) renders as text or a safely balanced block instead of breaking the Telegram parse.
- If Telegram rejects converted HTML with an entity-parse error, DeepChat retries the same outbound chunk as plain text.
- Existing Telegram client tests pass; a new test covers the converter and parse-mode wiring.

## Constraints

- Keep behavior parity with the existing Feishu pattern: a dedicated `telegramMarkdown.ts` module living next to `telegramClient.ts`, surfaced through a single conversion entry point.
- No new runtime dependency; the conversion is implemented locally to keep the bundle lean and stay within Telegram's HTML subset.
- Do not change `chunkTelegramText` semantics or the streaming delivery state shape.

## Non-Goals

- No switch to Telegram MarkdownV2.
- No changes to attachment handling, photo captions beyond passing `parse_mode` when a caption is sent.
- No richer Telegram-only features (custom emojis, spoilers, MessageEntities).
