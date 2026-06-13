# Chat Scroll Windowing Specification

## User Need

DeepChat's chat page must remain fast and smooth for long conversations while preserving reliable message anchors for future features such as a chat minimap. The solution must not use a fully opaque virtual list model that makes anchor scrolling, search jumps, trace jumps, or minimap positioning depend on whether a message currently exists in the DOM.

## Goal

Design a chat-specific windowed rendering and scroll model that provides virtual-list-like performance without sacrificing stable message addressing, bottom-first chat behavior, user-controlled auto-scroll behavior, or smooth streaming output.

## Current Context

The current chat page renders through this path:

```text
ChatTabView
  -> ChatPage
    -> MessageList
      -> MessageListRow
        -> MessageItemUser / MessageItemAssistant
          -> MessageBlockContent
            -> MarkdownRenderer
```

Relevant current files:

- `src/renderer/src/views/ChatTabView.vue`
- `src/renderer/src/pages/ChatPage.vue`
- `src/renderer/src/components/chat/MessageList.vue`
- `src/renderer/src/components/chat/MessageListRow.vue`
- `src/renderer/src/composables/message/useMessageWindow.ts`
- `src/renderer/src/components/message/MessageItemAssistant.vue`
- `src/renderer/src/components/message/MessageBlockContent.vue`
- `src/renderer/src/components/markdown/MarkdownRenderer.vue`
- `src/renderer/src/stores/ui/message.ts`
- `src/renderer/src/stores/ui/stream.ts`
- `src/renderer/src/stores/uiSettingsStore.ts`

Important existing behavior and risks:

- `ChatPage` currently has a virtual-list path in `MessageList`, but virtualization is effectively disabled by `MESSAGE_VIRTUALIZATION_THRESHOLD = Number.POSITIVE_INFINITY`.
- Full DOM rendering causes long conversations, Markdown rendering, code blocks, Mermaid, artifact parsing, tool-call blocks, and layout reads/writes to accumulate cost.
- Streaming currently updates reactive stream state and also applies streaming blocks into the message cache, causing repeated conversion, parsing, markdown rendering, scroll updates, and layout work.
- The UI setting `autoScrollEnabled` exists in `useUiSettingsStore()` and must be respected by any new scroll model.

## Required Behavior

### 1. Bottom-first chat entry

When the user opens an existing chat session, the page should quickly show the latest part of the conversation and land at the bottom.

This initial bottom positioning is distinct from the auto-scroll setting:

- Opening a chat should default to the bottom so users can see the latest context.
- This behavior should not be disabled merely because `autoScrollEnabled` is false.

### 2. Respect auto-scroll setting during generation

The existing `autoScrollEnabled` setting controls generation-time following behavior.

When `autoScrollEnabled` is true:

- During generation/streaming, the chat view should follow the bottom.
- Streaming content growth should be coalesced into efficient bottom-follow updates.
- The user should see new output without manual scrolling.

When `autoScrollEnabled` is false:

- Streaming/generation must not pull the user to the bottom.
- The user's current reading position, or "line of sight", should remain stable.
- Streaming output may continue below the viewport, but the viewport should not jump.

### 3. Preserve line of sight

The scroll system must be able to identify and preserve the user's current viewport anchor when auto-follow is not active.

A viewport anchor should be based on stable message identity rather than raw DOM availability:

```ts
type ViewportAnchor = {
  messageId: string
  offsetWithinMessage: number
}
```

When message heights change because of streaming, Markdown hydration, artifact rendering, image load, code block rendering, or history insertion, the system should compensate scroll position to keep the anchor visually stable unless the active mode is bottom-follow.

### 4. Virtual-list-like performance without full virtual opacity

The implementation should avoid painting all heavy message DOM for long conversations, but should retain full logical addressability.

Use a chat-specific windowed rendering model based on CSS `content-visibility`
rather than spacer-based DOM windowing:

```text
complete loaded message data
  -> stable layout model for every loaded message
  -> all rows kept mounted (no DOM add/remove on scroll)
  -> each row uses `content-visibility: auto` + `contain-intrinsic-size`
     so the browser skips painting off-screen rows
  -> the generating row is forced `content-visibility: visible`
```

Rows outside the viewport stay mounted but unpainted (the browser uses the
intrinsic-size placeholder), while each loaded message still has:

- stable `messageId`
- ordering information
- estimated height
- measured height when available (committed only once the row has been painted)
- logical top/bottom offsets

### 5. Future minimap compatibility

This change must not block a future minimap.

The future minimap should be able to rely on a logical layout model, not on querying every message DOM node. Therefore:

- Do not make a third-party virtual scroller the sole source of truth for item heights or positions.
- Do not require all message DOM nodes to exist for anchor scrolling.
- Keep message positions addressable by `messageId`.
- Search, trace jumps, and future minimap jumps should operate through a message layout model.

### 6. Smooth and continuous scrolling

Scrolling should feel continuous for both normal and long conversations.

Requirements:

- Normal scrolling should not stutter from excessive Markdown mount/unmount work.
- Large or fast scrolls should not show large blank gaps caused by under-rendered virtual ranges.
- Overscan should adapt to scroll velocity and generation state.
- Heavy content hydration may be delayed while fast scrolling, then completed after scroll settles.

### 7. Long chat first load must be fast

Long conversations should not require full history or full DOM hydration before the chat becomes usable.

Preferred behavior:

1. Load and render the latest page/window first.
2. Position at the bottom.
3. Make input and latest messages interactive quickly.
4. Defer older history loading, metadata preparation, measurement refinement, and optional pre-hydration.

### 8. Streaming must stay smooth

Generation smoothness is a first-class requirement.

Streaming updates should not force the entire message list to recompute or remount. The currently streaming assistant message should be treated as a live row or live layer that is isolated from stable historical rows as much as possible.

The scroll/layout system should batch work during streaming:

- Coalesce `scrollToBottom` operations with `requestAnimationFrame` or equivalent batching.
- Batch height measurement commits.
- Avoid synchronous full-list layout recalculation on every token/chunk.
- Apply dynamic throttling/debouncing to Markdown rendering for long streaming content.

## Acceptance Criteria

1. Opening a long chat renders quickly and lands at the latest/bottom content.
2. Long chats avoid full heavy DOM rendering for all loaded messages.
3. `autoScrollEnabled = true` causes generation to follow the bottom.
4. `autoScrollEnabled = false` prevents generation from forcing the viewport to the bottom.
5. With auto-scroll disabled, the user's current reading position remains stable while generation continues.
6. Fast scrolling through long chats does not show large blank areas.
7. Streaming output remains smooth and is not blocked by full-list recomputation or excessive layout work.
8. Search, trace jumps, and future minimap jumps can target messages by `messageId` even if the target is outside the current render window.
9. Loading older messages at the top preserves viewport position.
10. The design leaves a reusable message layout model for future minimap work.

## Non-Goals

- Implementing the minimap itself.
- Replacing all chat message rendering components.
- Changing LLM/provider streaming semantics.
- Removing the existing `autoScrollEnabled` setting.
- Requiring full conversation history to load before the chat becomes usable.
- Relying solely on a third-party virtual scroller as the long-term architecture.

## Constraints

- Use Vue 3 Composition API patterns already present in the renderer.
- Keep changes localized to chat rendering, message layout, and scroll behavior where possible.
- Do not weaken existing message actions, trace behavior, search behavior, or read-only session behavior.
- Do not introduce user-facing strings without i18n keys.
- Avoid synchronous expensive work during streaming.
- Keep future minimap support data-driven rather than DOM-driven.

## Review Notes

The preferred architecture is a dedicated chat windowing model instead of enabling a fully opaque virtual list. Existing `vue-virtual-scroller` usage may still be referenced or used temporarily if it can satisfy the anchor and line-of-sight requirements, but the layout model should remain owned by DeepChat so minimap and jump behavior have stable coordinates.
