# Telegram Markdown Rendering

## User Story

As a Telegram remote-control user, I want assistant replies to render common Markdown
formatting in Telegram so that remote answers are easier to read.

## Acceptance Criteria

- Telegram assistant answer and final-answer text renders common Markdown via Telegram
  `parse_mode: "HTML"`.
- Bold, italic, inline code, fenced code blocks, links, blockquotes, headings, and lists render
  as Telegram-supported message formatting or readable text.
- Common GFM pipe tables are converted to aligned fixed-width text and sent as preformatted
  Telegram HTML.
- Process logs, command replies, status messages, pending-interaction prompts, and failure notices
  keep their existing plain-text behavior.
- If Telegram rejects formatted text because entities cannot be parsed, DeepChat retries the same
  chunk as plain text.

## Non-Goals

- Mermaid is not rendered as an image in this increment; it remains readable text/code.
- Complex HTML is not rendered as browser HTML. Unsupported tags are preserved as safe text or
  reduced to Telegram-supported formatting.
- No user-facing setting is added.

## Constraints

- Telegram message text remains limited to 4096 characters after entity parsing.
- The change must stay in the Telegram remote-control outbound path and avoid renderer Markdown
  dependencies.
