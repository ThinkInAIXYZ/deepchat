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
- Keep the existing gesture listeners as early cancellation for wheel, touch, pointer, mouse, and
  keyboard paths.

## Test Strategy

- Add one ChatPage regression test using the existing restore-settle harness.
- The test triggers only `scroll` after moving `scrollTop` away from bottom, then verifies later
  layout growth does not force the viewport back to bottom.
- Add a second regression check where a message `measure` event fires immediately after the
  scroll-only intent.
- Add a near-bottom slow upward wheel regression check.

## Compatibility

- No persisted state changes.
- No IPC or main-process changes.
