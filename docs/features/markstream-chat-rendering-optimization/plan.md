# MarkStream Chat Rendering Optimization Plan

## Chosen combined approach

The best risk-adjusted plan is a hybrid: optimize MarkStream inside each Markdown message, add compatibility guardrails around chat search, and fix stale measurement cleanup. Avoid outer list virtualization for now because `MessageList` also owns tool/action/artifact rows, DOM search, screenshot capture, spotlight jump, and scroll anchoring.

## Current path

`ChatPage` builds display messages, `MessageList` renders rows, assistant rows render `MessageBlockContent`, and text parts render `MarkdownRenderer`, which wraps `markstream-vue`'s `NodeRenderer`.

## Implementation approach

1. Add explicit render-state props to `MarkdownRenderer`:
   - `streaming?: boolean` for DeepChat's live block state;
   - `final?: boolean` for MarkStream's parser/render completion state;
   - `virtualizeNodes?: boolean` for callers that need all DOM nodes mounted.
2. Compute MarkStream options in `MarkdownRenderer`:
   - `mode="chat"` for chat Markdown;
   - `final` defaults to `!streaming`;
   - `smoothStreaming` resolves to `'auto'` while streaming, otherwise `false`;
   - `typewriter` and `codeBlockStream` only while streaming;
   - `fade=false` for stability;
   - `batchRendering`, `deferNodesUntilVisible`, `viewportPriority` enabled;
   - node virtualization enabled only for non-streaming content and when `virtualizeNodes` is true.
3. Update `MessageBlockContent` to derive a single streaming flag from block status and part loading state, pass it to `MarkdownRenderer`, and disable node virtualization for search-result messages or when the parent list disables it.
4. Propagate `disableMarkdownVirtualization` from `ChatPage` through `MessageList` and `MessageListRow` to assistant Markdown while inline chat search is open.
5. Clear `useMessageWindow` measured heights on session switch so row estimates do not carry over.
6. Update focused tests/mocks to assert the new props without requiring real MarkStream rendering.

## Affected interfaces

- `MarkdownRenderer.vue` gains optional `streaming`, `final`, and `virtualizeNodes` props.
- `MessageBlockContent.vue` gains optional `disableMarkdownVirtualization` prop.
- `MessageItemAssistant.vue`, `MessageListRow.vue`, and `MessageList.vue` gain optional pass-through `disableMarkdownVirtualization` prop.
- Existing callers that do not pass these props continue to render as completed/static Markdown.

## Compatibility

- Artifact and workspace Markdown renderers keep default non-streaming behavior.
- Existing `smoothStreaming` prop remains accepted for compatibility but is resolved together with `streaming`.
- Custom component registration remains scoped by message/thread/link context.
- Chat search disables per-message Markdown node virtualization while active so DOM highlights can see all nodes.

## Test strategy

- Run focused renderer/list tests for:
  - `test/renderer/components/MarkdownRenderer.test.ts`
  - `test/renderer/components/message/MessageBlockContent.test.ts`
  - `test/renderer/components/MessageList.test.ts`
  - `test/renderer/components/ChatPage.test.ts`
- Run project-required checks after code changes:
  - `pnpm run format`
  - `pnpm run i18n`
  - `pnpm run lint`
  - `pnpm run typecheck:web`
