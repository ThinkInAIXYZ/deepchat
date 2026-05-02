# Remote Tool Interactions Plan

## Summary

Implement a structured remote interaction loop for Telegram and Feishu so remote endpoints can resolve paused permission and question interactions without falling back to a generic desktop-only notice. The feature stays inside Electron main and reuses the existing `RemoteConversationRunner`, `RemoteCommandRouter`, `FeishuCommandRouter`, and `agentSessionPresenter.respondToolInteraction(...)` flow.

## Goals

- Expose `RemoteConversationSnapshot.pendingInteraction` as the canonical paused-interaction state for remote delivery.
- Preserve the current detached-session and bound-endpoint model without adding renderer IPC.
- Let Telegram resolve interactions with inline buttons plus text fallback.
- Let Feishu render interaction cards and fall back to complete plain-text prompts when card delivery fails.
- Keep command/session state safe while an interaction is unresolved.

## Readiness

- No open clarification items remain.
- The feature is ready for implementation and regression verification.

## Rollout Steps

1. Extend remote snapshot and runner contracts to surface `pendingInteraction`.
2. Parse assistant `tool_call_permission` and `question_request` blocks into a shared `RemotePendingInteraction` model.
3. Gate remote command routing around pending interactions and add `/pending`.
4. Add Telegram-specific rendering, callback token state, callback refresh, and text fallback.
5. Add Feishu-specific card rendering, text fallback, and inbound text parsing.
6. Add regression coverage for runner extraction, callback refresh, prompt resend, and channel-specific prompt delivery.
7. Update spec artifacts so acceptance, rollout, and compatibility are reviewable without tracing code.

## Dependencies

- `RemoteConversationSnapshot.pendingInteraction` in `RemoteConversationRunner`
- `agentSessionPresenter.respondToolInteraction(...)`
- Existing Telegram outbound edit/send flows in `TelegramPoller`
- Existing Feishu outbound text flow extended with card sending in `FeishuRuntime`
- In-memory callback/token state in `RemoteBindingStore`

## Data And API Changes

- `RemoteConversationSnapshot`
  - Add `pendingInteraction: RemotePendingInteraction | null`
  - Preserve `text` and `completed` semantics so remote delivery can send visible text plus a follow-up interaction prompt
- `RemoteRunnerStatus`
  - Add `pendingInteraction`
  - Suppress `isGenerating` while the assistant is explicitly waiting on user action
- `RemotePendingInteraction`
  - Include `messageId`, `toolCallId`, `toolName`, `toolArgs`
  - Include permission metadata for `tool_call_permission`
  - Include question metadata for `question_request`
- `RemoteCommandRouteResult` / `FeishuCommandRouteResult`
  - Allow outbound interaction prompt actions in addition to normal replies/conversation execution

## Telegram Rendering Behavior

- Permission interactions render a dedicated prompt with inline `Allow` / `Deny` buttons.
- Single-choice questions render inline option buttons and `Other` when custom text is allowed.
- `question.multiple === true` does not render fake multi-select buttons and instead instructs the user to reply in plain text.
- Text fallback accepts:
  - `ALLOW` / `DENY` for permissions
  - Exact numeric replies for question options
  - Exact option labels for question options
  - Custom text when allowed
- Expired callback tokens do not hard-fail if the interaction still exists; the router re-reads the current pending interaction and refreshes the prompt.
- After a button press, Telegram edits the original prompt into a resolved state immediately, then continues any deferred execution in the background.

## Feishu Rendering Behavior

- Pending interactions render as interactive-card style outbound messages when the card API succeeds.
- Card fallback uses the full plain-text prompt, not only a short reply hint, so the user still sees permission/question details.
- Feishu remains text-response only on the inbound side:
  - `ALLOW` / `DENY` for permissions
  - Exact numeric replies for question options
  - Exact option labels for question options
  - Custom text when allowed
- `question.multiple === true` always uses plain-text answers.

## Command Gating While Waiting

- Blocked commands while a pending interaction exists:
  - `/new`
  - `/use`
  - `/model`
  - Unrelated plain-text new-turn input
- Allowed commands while a pending interaction exists:
  - `/help`
  - `/status`
  - `/open`
  - `/pending`
- `/pending` re-sends the current prompt for the endpoint-bound session.

## Migration And Compatibility

- `RemoteConversationSnapshot.pendingInteraction` is additive and does not require a persisted config migration.
- Existing Telegram and Feishu bindings remain valid.
- Existing remote sessions continue to use detached session creation and the same runner/session binding path.
- Telegram keeps inline-button interaction handling; Feishu does not introduce public callback endpoints.
- The former generic "Desktop confirmation is required" message becomes a fallback path only, not the primary remote behavior.

## Risks And Mitigations

- Stale callback tokens
  - Mitigation: rebind tokens to `endpointKey + messageId + toolCallId` and refresh prompts when the current interaction still matches.
- Session drift while waiting
  - Mitigation: block `/new`, `/use`, `/model`, and unrelated plain-text turns until the interaction is resolved.
- Feishu card delivery failures
  - Mitigation: fall back to the full plain-text prompt and keep inbound parsing text-only.
- Telegram callback latency
  - Mitigation: edit the prompt immediately and run continuation work off the poll loop.

## Test Strategy

- Runner tests
  - Extract `pendingInteraction` from assistant action blocks
  - Resume after tool interaction response
  - Handle chained interactions on the same assistant message
- Telegram tests
  - Button callbacks and text fallback
  - Expired callback token refresh
  - `/pending` prompt resend
  - Prompt edit timing and non-blocking deferred continuation
- Feishu tests
  - Card prompt generation
  - Plain-text fallback content
  - Text parsing for permission/question answers
  - Pending command gating and `/pending`
