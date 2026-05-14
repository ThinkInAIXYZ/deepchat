# Guided Onboarding First Chat Confirm

## Problem

During the guided `first-chat` step, clicking the confirm action can appear to do nothing because the handler only focuses the raw contenteditable element instead of invoking the chat input's editor-aware focus path.

## User Story

As a user on the final onboarding step, I want the confirm action to move focus into the real chat editor so I can immediately start typing my first message.

## Acceptance Criteria

- When the guided `first-chat` overlay is visible, clicking the primary confirm action focuses the real chat input editor.
- The guide remains active until the first successful message send completes the onboarding step.
- A focused renderer test covers the confirm action calling the chat input focus path.

## Non-goals

- No change to onboarding completion semantics for the first-chat step.
- No change to chat send behavior.
- No change to the final guide copy.
