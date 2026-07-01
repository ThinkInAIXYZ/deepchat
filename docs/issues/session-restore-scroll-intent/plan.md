# Plan

## Approach

- Reuse the existing `onScroll` path in `ChatPage.vue`.
- Track the last bottom `scrollTop` written by session restore settling.
- During an active session restore settle, cancel the settle when a scroll-only path moves upward
  from that recorded bottom position.
- Switch to anchored-reading synchronously on scroll-away so row measurement callbacks cannot reuse
  stale `initial-bottom` state.
- Track short-lived upward wheel intent so slow upward scrolls inside the bottom threshold are not
  reclassified as auto-follow on the next metrics frame.
- Disable browser-native overflow anchoring on the chat scroll container and remove row-level
  `content-visibility` placeholders so Chromium does not visually reposition historical messages
  during slow manual scrolling.
- Render image blocks inside a fixed preview frame so image load/decode cannot change the message
  row height while the user is reading around the image.
- Measure each message row immediately after mount now that row-level `content-visibility` is gone;
  keep ResizeObserver for later real resizes instead of deferring first measurement until viewport
  intersection.
- Give the sticky composer layer an opaque background so message content no longer scrolls underneath
  the input blur region.
- Disable markstream viewport virtualization and its internal `content-visibility` intrinsic-size
  placeholder only for completed chat markdown so first-time scrollback does not resolve a 600px
  offscreen estimate into real content height under the visible message wrapper.
- Keep the existing gesture listeners as early cancellation for wheel, touch, pointer, mouse, and
  keyboard paths.

## Test Strategy

- Add one ChatPage regression test using the existing restore-settle harness.
- The test triggers only `scroll` after moving `scrollTop` away from bottom, then verifies later
  layout growth does not force the viewport back to bottom.
- Add a second regression check where a message `measure` event fires immediately after the
  scroll-only intent.
- Add a near-bottom slow upward wheel regression check.
- Add a MarkdownRenderer regression check that completed chat markdown disables markstream viewport
  virtualization and intrinsic placeholder behavior while streaming markdown keeps its existing path.

## Compatibility

- No persisted state changes.
- No IPC or main-process changes.
