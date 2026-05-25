# Telegram Message Markdown Render Plan

## Approach

- Add `src/main/presenter/remoteControlPresenter/telegram/telegramMarkdown.ts` exposing `convertMarkdownToTelegramHtml(text: string): string`, mirroring the Feishu-side `feishuMarkdown.ts` module location and shape.
- The converter:
  - Escapes `&`, `<`, `>` first to make raw text safe for `parse_mode: 'HTML'`.
  - Converts common GFM pipe tables into fenced fixed-width text before code-block extraction.
  - Handles fenced code blocks (` ``` `) by emitting `<pre><code class="language-...">...</code></pre>` and protecting the body from further Markdown processing.
  - Handles inline code (` `…` `), bold (`**`/`__`), italic (`*`/`_`), strikethrough (`~~`), links, headings (`#…######`), unordered/ordered lists, and blockquotes (`>`).
  - Auto-closes a dangling fenced block when called on a chunk that ends mid-block, so each chunk produces valid HTML for Telegram.
- Extend `TelegramClient.sendMessage`, `editMessageText`, and `sendPhoto` with an optional `parseMode` ('HTML' | 'MarkdownV2'). Default remains undefined for backward compatibility.
- In `TelegramPoller`:
  - Convert chunk text via `convertMarkdownToTelegramHtml` before `sendMessage`/`editMessageText` calls in `syncDeliverySegment`, `sendChunkedMessage`, `dispatchOutboundActions`, and `editMessageText`. Pass `parseMode: 'HTML'`.
  - Apply conversion to the interaction prompt text as well so callback prompts render formatting consistently.
  - Retry the original plain-text chunk when Telegram returns a 400 entity-parse error for converted HTML.

## Validation

- Run `pnpm test test/main/presenter/remoteControlPresenter/telegramClient.test.ts` (extended) and a new `telegramMarkdown.test.ts` covering core conversion rules, table fallback, and chunk-boundary behavior.
- Run `pnpm run typecheck:node` to confirm no signature break in callers (Poller, Adapter).
