# Chat Input Hero Transition

## Goal

When the user sends the first message from the new thread page, the `ChatInputBox` should animate into the chat page instead of disappearing and reappearing abruptly.

## User Need

- As a user, when I move from the centered composer on `NewThreadPage.vue` to the sticky composer on `ChatPage.vue`, I want the transition to feel continuous.

## Acceptance Criteria

- Submitting from `NewThreadPage.vue` prepares a one-shot hero transition for the current `ChatInputBox`.
- When `ChatPage.vue` mounts for that navigation, the hero transition animates from the previous composer bounds to the new composer bounds.
- If reduced motion is enabled, the transition is skipped.
- If session creation or route activation fails, any temporary hero overlay is cleaned up.
- The transition only applies to the new-thread to chat handoff and does not affect normal chat-to-chat session switching.

## Constraints

- Reuse the existing `ChatInputBox` DOM structure instead of introducing a separate fake design.
- Keep implementation renderer-local; no new IPC or persisted state.
- Avoid changing user-facing copy.

## Non-Goals

- Animating the entire page layout.
- Introducing a generic shared-element framework for unrelated components.
