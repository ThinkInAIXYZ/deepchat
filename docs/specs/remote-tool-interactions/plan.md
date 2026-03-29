# Remote Tool Interactions Plan

## Summary

Implement a structured remote interaction loop for Telegram and Feishu by extending the runner snapshot model, teaching the routers to pause around pending interactions, and adding channel-specific prompt rendering plus response parsing.

## Main Process Changes

- Extend `RemoteConversationSnapshot` and runner status with `pendingInteraction`.
- Parse assistant `tool_call_permission` and `question_request` action blocks into a shared `RemotePendingInteraction` model.
- Add `RemoteConversationRunner.getPendingInteraction()` and `respondToPendingInteraction()` so routers can resolve paused tool interactions without creating a new turn.
- Keep follow-up polling on the same assistant message after a tool interaction response, allowing chained interactions to surface one by one.

## Router Flow

- Check for a current pending interaction before routing mutable commands or plain text.
- Allow `/help`, `/status`, `/open`, and `/pending` while blocking `/new`, `/use`, `/model`, and unrelated plain-text turns.
- Add `/pending` to both channel command lists and make `/status` report the current waiting interaction summary.
- Parse remote replies into `ToolInteractionResponse`:
  - Telegram/Feishu permission: `ALLOW` / `DENY`
  - Telegram/Feishu question: option number or exact label
  - Custom/plain-text answers when `custom` is allowed or `multiple` is true

## Telegram Delivery

- Add callback token state for pending interactions in `RemoteBindingStore`.
- Render permission prompts with inline `Allow` / `Deny`.
- Render single-choice questions with inline option buttons plus `Other` when custom answers are allowed.
- On callback expiry, re-read the current pending interaction and refresh the prompt instead of hard-failing.
- After a callback resolves, edit the interaction message into a resolved state, then continue conversation polling if the agent resumes.

## Feishu Delivery

- Add card-style prompt builders for permission and question states.
- Extend `FeishuClient` and `FeishuRuntime` with outbound `sendCard` support.
- Prefer card delivery and fall back to plain text if card sending fails.
- Keep all responses text-based from the user side; do not add card-click callbacks.

## Data Model

- `RemotePendingInteraction`
  - `type`
  - `messageId`
  - `toolCallId`
  - `toolName`
  - `toolArgs`
  - optional permission metadata
  - optional question metadata
- `TelegramPendingInteractionState`
  - `endpointKey`
  - `messageId`
  - `toolCallId`
  - `createdAt`
- `FeishuOutboundAction`
  - `sendText`
  - `sendCard`

## Risks And Mitigations

- Stale callback tokens: rebind tokens to the current endpoint/message/tool call and refresh prompts when the interaction still exists.
- Session drift while waiting: block session-switching commands until the current interaction is resolved.
- Card delivery instability in Feishu: fall back to plain text and keep parsing on inbound text only.

## Test Strategy

- Runner tests for extracting pending interactions, responding to them, and continuing chained execution.
- Telegram router tests for button/text approval flows, `/pending`, and expired callback refresh.
- Telegram poller tests for sending prompt messages after a completed assistant response with `pendingInteraction`.
- Feishu router tests for permission/question text parsing and `/pending` card prompts.
- Feishu runtime tests for card delivery and card-to-text fallback.
- Binding-store tests for pending interaction token lifecycle.
