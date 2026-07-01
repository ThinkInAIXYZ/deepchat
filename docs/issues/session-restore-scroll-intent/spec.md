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
- Message height measurement after scroll-away does not re-enter bottom-follow mode.
- Streaming auto-follow and explicit send-to-bottom behavior stay unchanged.

## Constraints

- Keep the fix in the renderer chat page scroll owner.
- Do not add a user-facing setting, new dependency, or broad scroll rewrite.
- No new user-facing strings.

## Non-goals

- Redesign message virtualization or message measurement.
- Change chat input layout.
