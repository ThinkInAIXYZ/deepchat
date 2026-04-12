# Implementation Plan

## Architecture

- Add `src/main/presenter/remoteControlPresenter/` as a main-process presenter that exposes a small shared contract to the renderer through the existing `presenter:call` IPC path.
- Keep Telegram transport in Electron main using native `fetch` and Bot API long polling.
- Reuse `agentSessionPresenter.sendMessage()` and `AgentRuntimePresenter` for message persistence, stream state, title generation, and stop behavior.
- Add detached session creation to `agentSessionPresenter` so remote conversations do not require a renderer-bound window.

## Main-Process Modules

- `remoteBindingStore`
  - Stores `remoteControl.telegram` config in Electron Store.
  - Persists poll offset, allowlist, default agent id, pair code, legacy stream-mode compatibility data, and endpoint bindings.
  - Keeps active event IDs, `/sessions` snapshots, and `/model` inline-menu state in memory.
- `remoteAuthGuard`
  - Enforces private-chat-only usage.
  - Authenticates strictly by numeric `from.id`.
  - Supports one-time `/pair <code>` flow.
- `remoteConversationRunner`
  - Creates detached sessions when needed.
  - Resolves a valid enabled DeepChat default agent before creating unbound Telegram sessions.
  - Lists recent sessions by the currently bound session's agent when a valid binding exists; otherwise falls back to the default DeepChat agent.
  - Exposes current-session lookup and bound-session model switching through `agentSessionPresenter.setSessionModel()`.
  - Reuses `agentSessionPresenter.sendMessage()` for plain-text Telegram input.
  - Tracks the active assistant message/event for `/stop`.
  - Exposes `statusText`, streamed answer `text`, and `finalText` for remote delivery while preserving compatibility snapshot fields.
- `remoteCommandRouter`
  - Handles `/start`, `/help`, `/pair`, `/new`, `/sessions`, `/use`, `/stop`, `/status`, `/model`, plain text, and `/model` callback actions.
- `telegramClient`
  - Calls `getMe`, `getUpdates`, `sendMessage`, `sendChatAction`, `setMyCommands`, `setMessageReaction`, `editMessageText`, `editMessageReplyMarkup`, and `answerCallbackQuery`.
  - Returns the bot-side `message_id` from `sendMessage()` so the runtime can track temporary status and streamed-answer messages.
  - Deletes temporary status messages when a turn completes.
- `telegramParser`
  - Parses private text updates, bot commands, and callback queries into one internal event shape.
- `telegramOutbound`
  - Builds plain-text assistant output, detects “desktop confirmation required” states, and chunks output to 4096 characters.
- `telegramPoller`
  - Runs a single sequential long-poll loop.
  - Advances the stored offset only after a specific update is handled successfully.
  - Uses exponential backoff on failures.
  - Only adds reactions for plain-text conversation messages and clears them after the conversation completes or fails.
  - Maintains one temporary status message plus one streamed answer message per assistant turn.

## Shared / IPC Contract

- Add `src/shared/types/presenters/remote-control.presenter.d.ts`.
- Expose methods for reading/saving Telegram settings, reading runtime status, listing/removing bindings, reading pairing snapshot, generating/clearing pair codes, and clearing bindings.

## Renderer Plan

- Add a new `Remote` settings route and `RemoteSettings.vue`.
- Move Telegram configuration out of `NotificationsHooksSettings.vue`.
- Keep `Hooks` as command hooks only.
- Simplify the first-layer Telegram remote UI to allowed user IDs, default agent selection, pairing, and binding management.
- Show pairing and binding management inside dialogs; hide remote/hook detail forms when their toggle is off.
- Reuse existing i18n flow for all renderer-visible strings.

## Data Model

- SQLite
  - No schema change.
  - Sessions/messages continue to use existing new-agent tables.
- Electron Store
  - `remoteControl.telegram`
    - `botToken`
    - `enabled`
    - `allowlist`
    - `defaultAgentId`
    - `streamMode` (legacy compatibility only; runtime ignores it)
    - `pairing`
    - `pollOffset`
    - `bindings`

## Event / Request Flow

1. Renderer saves Remote settings through `remoteControlPresenter`.
2. Main presenter updates `remoteControl.telegram`, then rebuilds the Telegram runtime if required.
3. Telegram poller receives private updates through `getUpdates`.
4. Parser normalizes message and callback payloads.
5. Router applies auth, command handling, and `/model` inline-menu transitions.
6. Plain text enters `agentSessionPresenter.sendMessage()` using the bound or newly created detached session.
7. `/model` callback actions edit a single bot menu message in place and answer the callback query.
8. Poller watches assistant message state, edits a temporary status message as status changes, streams answer text into a separate message, and deletes the status message after final sync.
9. If the assistant pauses on a permission/question action, Telegram returns a desktop-confirmation notice instead of bypassing approval.

## Testing Strategy

- Unit tests for `remoteAuthGuard`.
- Unit tests for `remoteBindingStore`.
- Unit tests for `remoteCommandRouter`.
- Unit tests for `remoteConversationRunner`.
- Unit tests for `telegramParser`.
- Unit tests for `telegramClient` request payloads.
- Unit tests for `telegramOutbound` chunking/final-text behavior.
- Unit tests for Telegram command registration, callback handling, and message reaction lifecycle behavior.
- Unit tests for temporary-status deletion, streamed-answer updates, pending interaction prompting, and long-answer continuation behavior.
- Presenter-level tests for detached session creation.
- Presenter-level tests for stop-by-event behavior.

## Migration Note

- No SQLite migration is required.
- New remote state is additive and can be removed cleanly by disabling remote control or clearing the config blob.
