# Chat Scroll Windowing Tasks

## Documentation and Review

- [x] Capture product requirements for long-chat performance, initial bottom positioning, auto-scroll setting behavior, line-of-sight preservation, streaming smoothness, and future minimap compatibility.
- [x] Draft architecture plan for CSS content-visibility based rendering with layout model for anchors.
- [x] Review requirements with product/maintainer before implementation.
- [x] Resolve any review feedback and update `spec.md` / `plan.md`.

## Layout Model Foundation

- [x] Design `MessageLayoutEntry` and layout state ownership.
- [x] Implement `useMessageWindow` composable for estimated/measured heights and offset lookup.
- [x] Add batched height measurement updates via `setMeasuredHeight`.
- [x] Add viewport anchor capture and restore helpers.
- [x] Add unit tests for layout entries, height updates, and anchor preservation.

## CSS Render Optimization

- [x] Replace DOM-removal windowing with CSS `content-visibility: auto` on `MessageListRow`.
- [x] Remove `DynamicScroller` and spacer-based windowing from `MessageList`.
- [x] Remove `contain: layout style` from `MessageListRow` (caused jank in markdown tables/code blocks).
- [x] Force `content-visibility: visible` on last row during generation for streaming smoothness.

## Scroll Behavior

- [x] Implement scroll modes: `initial-bottom`, `auto-follow`, `anchored-reading`, `manual-jump`.
- [x] Ensure opening a chat positions at bottom regardless of `autoScrollEnabled`.
- [x] Ensure generation follows bottom when `autoScrollEnabled` is true.
- [x] Ensure generation does not force bottom when `autoScrollEnabled` is false.
- [x] Preserve line of sight during height changes when not auto-following.
- [x] Preserve viewport when older messages are prepended.
- [x] Restore session-restore settle behavior from remote (multi-frame bottom scroll with user-intent cancellation).

## Streaming Performance

- [x] Single-track streaming: fold streaming blocks into the persisted message record
      (same id/DOM node) instead of a separate trailing row, removing the completion flash.
- [x] Remove rAF-batched windowing overhead that delayed streaming display.
- [x] Keep MarkdownRenderer debounce for long streaming content (32ms fast / 96ms slow),
      guarded by a shared revision so a stale path can't replay older content.

## Jump and Anchor Compatibility

- [x] Search/trace jump to unrendered message works via layout model `getEntry`.
- [x] Post-render refinement and highlight for manually jumped targets.
- [x] Layout model exposes `entries` for future minimap consumption.

## Long Chat Loading

- [x] Keep latest-page/bottom-first restore behavior (40 messages).
- [x] Infinite scroll to load older messages on scroll-to-top.
- [x] Viewport position preserved when older messages are prepended.

## Validation

- [ ] Manual: open long chat and confirm it lands at bottom quickly.
- [ ] Manual: generate with auto-scroll enabled and confirm smooth bottom-follow.
- [ ] Manual: generate with auto-scroll disabled and confirm viewport does not jump.
- [ ] Manual: scroll away from bottom during generation and confirm line of sight stability.
- [ ] Manual: scroll through markdown tables and code blocks — confirm no jank.
- [ ] Manual: load older messages at top and confirm scroll position is preserved.
- [ ] Manual: search/trace jump to off-window message and confirm target appears/highlights.
