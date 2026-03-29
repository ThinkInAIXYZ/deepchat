# Remote Tool Interactions

## Summary

Extend remote control so Telegram and Feishu can surface structured pending tool interactions instead of collapsing them into a generic desktop-only notice. Remote users must be able to resolve permission requests and `user ask` style questions from the chat channel itself, while the desktop app keeps the existing agent execution and permission backends.

## User Stories

- As a Telegram remote user, I can approve or deny a tool permission request directly from inline buttons.
- As a Telegram remote user, I can answer a pending question by tapping an option or replying with text when custom input is allowed.
- As a Feishu remote user, I can see a clear card-style prompt for a pending permission or question and reply with a supported text answer.
- As a desktop user, I do not lose remote session continuity when a tool interaction pauses the assistant.
- As a paired remote user, I can ask the bot to re-show the current pending interaction without opening the desktop app.

## Acceptance Criteria

- `RemoteConversationSnapshot` includes `pendingInteraction` with structured `permission` or `question` data when the latest assistant message is waiting on user action.
- Remote delivery no longer relies on the generic "Desktop confirmation is required" path as the primary behavior.
- Telegram pending permission prompts render inline `Allow` and `Deny` buttons and also accept `ALLOW` / `DENY` text replies.
- Telegram single-choice question prompts render inline option buttons and an `Other` button when custom answers are allowed.
- Telegram multi-answer questions do not render fake multi-select buttons and instruct the user to reply with plain text.
- Expired Telegram interaction callback tokens refresh the prompt when the underlying pending interaction still exists.
- Feishu pending prompts render as interactive-card style outbound messages when possible and fall back to plain text when card delivery fails.
- Feishu accepts `ALLOW` / `DENY`, option numbers, exact option labels, and custom text according to the pending question shape.
- `/pending` re-sends the current prompt for both Telegram and Feishu.
- While a pending interaction exists, `/new`, `/use`, `/model`, and plain new-turn messages are blocked from creating unrelated session state changes.
- `/help`, `/status`, `/open`, and `/pending` remain available while a pending interaction exists.
- Existing remote pairing, binding, `/open`, `/status`, and normal non-interaction conversations continue to work.

## Constraints

- Keep all logic in Electron main; do not add a new renderer IPC surface for this feature.
- Telegram continues to use callback-query buttons; Feishu does not introduce a public HTTP callback service for card clicks.
- Remote bot copy remains English in this increment.
- Each endpoint only resolves the first pending interaction for its bound session at a time.

## Non-Goals

- Feishu clickable approval callbacks.
- Locale negotiation for remote bot messages.
- Arbitrary rich remote workflows beyond permission requests and question requests.

## Compatibility

- Existing Telegram and Feishu bindings remain valid.
- Existing remote sessions continue to use `RemoteConversationRunner` and detached session creation.
- Structured pending interaction handling is additive and only changes how remote channels render and answer paused assistant states.
