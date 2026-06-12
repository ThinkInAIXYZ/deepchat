# Reasoning Heading Font Size

## User Need

Reasoning/thinking blocks should feel like compact diagnostic text. Markdown heading syntax inside a
thinking block must not enlarge the text, because model reasoning often uses `#`, `##`, or `###` as
internal outline markers rather than user-facing document headings.

## Acceptance Criteria

- `h1` through `h6` rendered inside a reasoning/thinking block use the same font size as the rest of
  the thinking text.
- The fix is scoped to `ThinkContent` and does not change normal assistant markdown heading styles.
- The thinking block continues to render markdown, lists, links, and code blocks.

## Non-goals

- Redesign the thinking block.
- Change how normal assistant message markdown headings are rendered.
- Disable markdown parsing inside reasoning content.
