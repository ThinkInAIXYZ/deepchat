# Markdown Message Rendering

## Problem

`MessageList.vue` manually extracts text with `getAssistantText()` and renders it in a plain `<div>` with `whitespace-pre-wrap`. The existing codebase has a full rendering pipeline that handles markdown, code blocks, tool calls, thinking blocks, permissions, images, and more.

## Solution

Replace the plain-text rendering with existing message components:

- `MessageItemAssistant.vue` — renders all assistant block types (content/markdown, reasoning, tool_call, permission, image, audio, error, plan, question)
- `MessageItemUser.vue` — renders user content with file attachments, edit support, structured content rendering

## Component Props

- `MessageItemAssistant`: `:message="(msg as AssistantMessage)"`, `:is-capturing-image="false"`
- `MessageItemUser`: `:message="(msg as UserMessage)"`

Both work with `useChatStore` internally for `getActiveThreadId()`, variant maps, etc. Since `ChatPage` already activates the session in `chatStore`, these should work.

## Type References

From `@shared/chat`:
- `Message` — union type with `role: 'user' | 'assistant'`
- `UserMessage` — Message with `role: 'user'`, `content: UserMessageContent`
- `AssistantMessage` — Message with `role: 'assistant'`, `content: AssistantMessageBlock[]`

## Rendering Capabilities Unlocked

- Markdown formatting (headers, lists, bold, italic, links)
- Syntax-highlighted code blocks
- Thinking/reasoning blocks (collapsible)
- Tool call blocks with results
- Permission request blocks
- Image and audio blocks
- Error blocks
- Variant navigation
- Message toolbar (copy, retry, delete)

## Files Modified

- `src/renderer/src/components/chat/MessageList.vue` — rewrite to use existing message components
