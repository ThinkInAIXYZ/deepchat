# MarkStream Chat Rendering Optimization Plan

## Chosen approach

Use MarkStream's own chat-mode and performance presets inside each Markdown message, while keeping DeepChat's existing outer message windowing and row behavior. This gives the main performance gain where Markdown is expensive without breaking chat-level features that depend on the current DOM/scroll model.

## Current path

`ChatPage` builds display messages, `MessageList` renders rows, assistant rows render `MessageBlockContent`, and text parts render `MarkdownRenderer`, which wraps `markstream-vue`'s `NodeRenderer` with DeepChat custom components.

## Rendering strategy

### Streaming / live content

- Keep `mode="chat"` stable.
- Pass `final=false` while the block or part is still loading.
- Use `smooth-streaming="auto"` unless the caller disables smooth streaming.
- Enable `typewriter` and `code-block-stream` for the generating message.
- Use incremental rendering by setting live node limit to `0` while streaming.
- Tune MarkStream batch props for small frame-friendly chunks:
  - small initial/render batch sizes;
  - short render delay;
  - low per-frame budget;
  - idle timeout for catch-up.
- Keep `fade=false` to avoid repeated opacity animation during streaming updates.

### Completed / static content

- Pass `final=true` after generation completes.
- Disable smooth-streaming/typewriter/code-block-stream.
- Use MarkStream node virtualization and viewport priority for completed long Markdown:
  - `node-virtual="auto"` when allowed;
  - `max-live-nodes` and `live-node-buffer` bounded;
  - deferred offscreen nodes;
  - viewport-priority rendering.
- Keep the custom code block, Mermaid, reference, and link mappings registered through scoped `custom-id`.

### Compatibility guardrails

- Inline chat search disables Markdown node virtualization for all rendered messages while search is open.
- Search-result messages always disable Markdown node virtualization.
- Streaming content disables Markdown node virtualization even if the caller allows virtualization.
- Message capture keeps using the complete display message list through `allMessagesForCapture`.
- Session switch clears message-window measurements before loading the new session.

## Affected interfaces

- `MarkdownRenderer.vue`
  - `streaming?: boolean`
  - `final?: boolean`
  - `virtualizeNodes?: boolean`
  - internal MarkStream tuning constants for streaming and completed content.
- `MessageBlockContent.vue`
  - derives streaming/final state from block status and processed part loading;
  - passes virtualization guard to MarkdownRenderer.
- `MessageItemAssistant.vue`, `MessageListRow.vue`, `MessageList.vue`
  - pass through `disableMarkdownVirtualization`.
- `ChatPage.vue`
  - disables Markdown virtualization while inline chat search is open;
  - clears row measurements during session switch.

## Test strategy

Focused tests should assert both behavior and configuration:

- `MarkdownRenderer.test.ts`
  - static completed defaults;
  - streaming configuration;
  - smooth streaming opt-out;
  - node virtualization opt-out;
  - custom preview/reference behavior remains wired.
- `MessageBlockContent.test.ts`
  - pending/loading parts pass streaming/final state;
  - completed parts pass final/static state;
  - search-result and parent disable flags disable node virtualization.
- `MessageList.test.ts`
  - disable flag propagates through list rows.
- `ChatPage.test.ts`
  - chat search disables markdown virtualization;
  - session switch clears measurements.

Project checks before handoff:

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck:web`
- focused renderer/list/page Vitest command.

## Self-review loop

After implementation:

1. Inspect `git diff` for accidental unrelated changes.
2. Re-read the render path and verify streaming/static/search/capture/jump invariants.
3. Run focused tests and project checks.
4. Fix any issues and repeat diff/test review until clean.
5. Push the branch and update the PR body with concrete behavior and validation.
