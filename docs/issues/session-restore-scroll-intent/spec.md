# Session Restore Scroll Intent

## User Need

When a user switches to a historical chat session and scrolls upward to read earlier messages, the
chat view must not snap back to the bottom unless new generation or an explicit jump requires it.

## Goal

Respect scroll-only user intent during the bounded session restore bottom-settling window.

## Acceptance Criteria

- Switching to a historical session can still settle to the real bottom while late layout changes
  arrive.
- If the user scrolls away from the bottom during restore settling, the pending bottom settling is
  cancelled.
- Scroll-only input paths are covered, not only wheel, pointer, touch, mouse, or keyboard events.
- Slow upward wheel input near the bottom exits auto-follow even while still inside the bottom
  proximity threshold.
- Message height measurement after scroll-away does not re-enter bottom-follow mode.
- Message rows must not visually jump during manual reading because `content-visibility` rows resolve
  from intrinsic placeholder height to real height.
- Image blocks must reserve stable inline preview space before image decode/load completes.
- Message row height measurement must run after message load/render, not wait until the row approaches
  the viewport during manual scrolling.
- The sticky composer must mask scrolled message content behind it so translucent input chrome does
  not continuously resample and repaint moving message text.
- Completed chat markdown must not use markstream's `content-visibility: auto` intrinsic-size
  placeholder while the user is manually reading historical messages.
- Streaming auto-follow and explicit send-to-bottom behavior stay unchanged.

## Constraints

- Keep the fix in the renderer chat page scroll owner.
- Do not add a user-facing setting, new dependency, or broad scroll rewrite.
- No new user-facing strings.

## Non-goals

- Redesign message virtualization or message measurement.
- Change chat input layout.
