# Chat Scroll Windowing Plan

## Architecture Direction

Use CSS `content-visibility: auto` for browser-native render skipping, combined with a custom layout model for anchor positioning and future minimap support.

This approach was chosen over DOM-removal windowing because:
- All message DOM nodes remain present → stable anchors for minimap, search, trace jumps
- Browser handles render skipping natively → no rAF batching overhead, no streaming delays
- No spacer elements or virtual range calculations → simpler code, fewer bugs
- `contain-intrinsic-size` provides size hints → smooth scrollbar, no blank gaps

## Four Layers

```text
1. Message data layer
   Loaded message records and stable display-message conversion.

2. Layout model layer (useMessageWindow)
   Per-message estimated/measured height, logical top/bottom offsets.
   Used for anchor jumps, scroll-to-entry, and future minimap coordinates.

3. CSS render optimization layer (MessageListRow)
   content-visibility: auto + contain-intrinsic-size on each row.
   Browser skips painting off-screen heavy content (markdown, code, mermaid).

4. Scroll state layer (ChatPage)
   Initial bottom positioning, auto-follow, anchored-reading, and manual jump behavior.
```

## Scroll Modes

```ts
type ScrollMode =
  | 'initial-bottom'    // opening/switching session → always land at bottom
  | 'auto-follow'       // generation + autoScrollEnabled → follow bottom
  | 'anchored-reading'  // user scrolled away or autoScroll disabled → preserve position
  | 'manual-jump'       // search/trace/spotlight jump → scroll to target
```

### Transitions

- Session open → `initial-bottom` (always, regardless of `autoScrollEnabled`)
- `initial-bottom` + first message change → `auto-follow`
- `auto-follow` + user scrolls up → `anchored-reading`
- `anchored-reading` + user scrolls to bottom → `auto-follow` (if `autoScrollEnabled`)
- Any mode + search/trace jump → `manual-jump`
- `manual-jump` + scroll settles → `anchored-reading` or `auto-follow`

## CSS content-visibility Strategy

Each `MessageListRow` has:
```css
.message-list-row {
  content-visibility: auto;
  contain-intrinsic-size: auto 300px;
}
```

The browser uses `contain-intrinsic-size` as a placeholder height for off-screen rows. Once a row is rendered, the browser remembers its actual height. This means:
- Scrollbar thumb stays accurate
- No blank gaps during fast scrolling
- Heavy markdown/code/mermaid content is only painted when near the viewport

The streaming last row is forced visible:
```css
[data-generating='true'] .message-list-row:last-child {
  content-visibility: visible;
}
```

## Layout Model (useMessageWindow)

The composable maintains a pure data model for every loaded message:
- `entries`: per-message `{ id, orderSeq, estimatedHeight, measuredHeight, top, bottom }`
- `totalHeight`: sum of all message heights
- `getEntry(messageId)`: lookup for jump targets
- `setMeasuredHeight(messageId, height)`: update from ResizeObserver measurements

This model is used for:
- Anchor jumps (scroll to estimated position, then refine after render)
- Line-of-sight preservation (capture anchor before height changes, restore after)
- Future minimap (consume `entries` for position mapping)

## Single-Track Streaming

Streaming output is folded into the persisted message record in place rather than
rendered as a separate trailing row, so the generating message and the finished
message share the same id and DOM node:

- `displayMessages`: the single render track for both persisted and streaming messages
- Live streaming blocks are merged into their message record via
  `applyStreamingBlocksToMessage`, so updates mutate the existing record's content
- During streaming, the last row has `content-visibility: visible` forced for smooth painting
- A virtual streaming row is only appended when the record is not yet in the store
  (`hasInlineStreamingTarget` guard), preventing the same content rendering twice
  after a mid-stream `loadMessages`

When streaming completes:
1. `onStreamCompleted` swaps the record's content in place — no `clearStreamingState()` +
   `loadMessages()` remount, so the DOM node stays stable (no completion flash / blank gap)
2. Measurement updates (`setMeasuredHeight` / ResizeObserver) apply to the same stable
   DOM node rather than a swapped row

## Scroll-to-Bottom

Simple, state-machine-driven:
```ts
function scrollToBottom(force = false) {
  if (force) {
    markProgrammaticScroll(500)
    scrollMode = 'initial-bottom'
    shouldAutoFollow = true
  } else if (!autoScrollEnabled || !shouldAutoFollow) {
    return  // respect user's reading position
  }
  nextTick(() => scrollDomToBottom())
}
```

No rAF batching in scrollToBottom itself — the browser's native scroll coalescing handles this. The `nextTick` ensures DOM is updated before scrolling.

## Line-of-Sight Preservation

When heights change and we're not in auto-follow mode:
1. `captureViewportAnchor()` → `{ messageId, viewportOffset }`
2. Apply height changes
3. `scheduleViewportAnchorRestore(anchor)` → rAF → adjust `scrollTop` to keep anchor at same viewport position

## Long Chat First Load

Bottom-first phased loading (unchanged from existing behavior):
1. Load latest 40 messages → render → position at bottom
2. Make input interactive immediately
3. Older history loads on scroll-to-top (infinite scroll)

## Compatibility

### Search and trace jumps
Use layout model `getEntry(messageId)` to estimate position, scroll there, then refine after render.

### Future minimap
Consume `useMessageWindow.entries` for `messageId → top/bottom/height/status/role` mapping. No DOM queries needed.
