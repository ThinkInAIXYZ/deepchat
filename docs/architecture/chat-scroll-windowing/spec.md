# Chat Scroll Windowing Specification

> The retained bounded-layout contract in this document remains valid. Scroll ownership, isolated
> page geometry, first-load staging, and session-switch performance are now specified by
> `docs/architecture/chat-scroll-ownership/`.

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

- `ChatPage` owns a bounded message window. Histories above the windowing threshold render only the
  active range plus overscan, while `MessageList` uses before/after spacers from
  `useMessageWindow` to preserve the full logical scroll extent.
- Full DOM rendering causes long conversations, Markdown rendering, code blocks, Mermaid, artifact parsing, tool-call blocks, and layout reads/writes to accumulate cost.
- Streaming currently updates reactive stream state and also applies streaming blocks into the message cache, causing repeated conversion, parsing, markdown rendering, scroll updates, and layout work.
- The UI setting `autoScrollEnabled` exists in `useUiSettingsStore()` and must be respected by any new scroll model.
- The spacer model is only reliable when estimated heights, measured heights, visual row spacing,
  and container-coordinate conversion use the same layout units.

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

Use a chat-specific bounded window backed by DeepChat's own layout model:

```text
complete loaded message data
  -> stable layout model for every loaded message
  -> viewport + overscan selects a bounded rendered range
  -> before/after spacers preserve the full logical extent
  -> rendered rows refine estimates through measured heights
  -> search/jump/minimap consumers address every loaded row by messageId
```

Rows outside the active window are represented by spacers rather than mounted heavy DOM. Each
loaded message still has:

- stable `messageId`
- ordering information
- estimated height
- measured height when available (committed only once the row has been painted)
- logical top/bottom offsets

The layout contract is explicit:

- a row's logical footprint includes all visual spacing owned by that row;
- estimates and DOM measurements use the same footprint;
- spacer heights are derived only from logical entry boundaries;
- entry positions are relative to a stable message-window origin and must be converted before they
  are requested from the isolated message viewport controller;
- programmatic jumps carry a typed reason, session epoch, request ID, and expected target; matching
  scroll events are attributed without elapsed-time windows;
- batched measurements preserve a logical message anchor in the same frame as the height-map
  commit, before the revised spacers can be painted, but only when bounded windowing is active;
- short fully rendered conversations update measurement caches without measurement-driven
  `scrollTop` writes, and scroll-state classes do not change page-wide visual effect tokens;
- session restore uses one controller-owned bottom transaction plus coalesced geometry notices;
  any user gesture cancels active and pending restore work without a repeated frame loop;
- history loading chrome does not participate in message flow, and top pagination requires both a
  full initial history window and pre-existing upward user intent.

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
11. Short conversations cannot trigger older-history pagination from incidental layout scrolls.
12. Short fully rendered conversations do not move because a row measurement settles after scroll.
13. User scrolling always wins over restore, follow, resize, and measurement requests.

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
- Keep explicit chat search and message jumps immediate/default rather than smooth, matching the
  desktop native-feel regression contract.

## Review Notes

The preferred architecture is the bounded renderer window introduced by the long-chat reliability
work, backed by a DeepChat-owned layout model. A third-party virtual scroller must not become the
sole owner of positions. Search, spotlight, history anchoring, capture, and future minimap behavior
continue to consume stable message identities and logical coordinates from DeepChat.
