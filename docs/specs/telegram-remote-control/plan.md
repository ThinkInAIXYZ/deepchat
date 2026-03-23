# Implementation Plan

## Architecture

- Add `src/main/presenter/remoteControlPresenter/` as a main-process presenter that exposes a small shared contract to the renderer through the existing `presenter:call` IPC path.
- Keep Telegram transport in Electron main using native `fetch` and Bot API long polling.
- Reuse `newAgentPresenter.sendMessage()` and `DeepChatAgentPresenter` for message persistence, stream state, title generation, and stop behavior.
- Add detached session creation to `newAgentPresenter` so remote conversations do not require a renderer-bound window.

## Main-Process Modules

- `remoteBindingStore`
  - Stores `remoteControl.telegram` config in Electron Store.
  - Persists poll offset, allowlist, pair code, stream mode, and endpoint bindings.
  - Keeps active event IDs and `/sessions` snapshots in memory.
- `remoteAuthGuard`
  - Enforces private-chat-only usage.
  - Authenticates strictly by numeric `from.id`.
  - Supports one-time `/pair <code>` flow.
- `remoteConversationRunner`
  - Creates detached sessions when needed.
  - Reuses `newAgentPresenter.sendMessage()` for plain-text Telegram input.
  - Tracks the active assistant message/event for `/stop`.
  - Reuses existing chat-window activation logic for `/open`.
- `remoteCommandRouter`
  - Handles `/start`, `/help`, `/pair`, `/new`, `/sessions`, `/use`, `/stop`, `/open`, `/status`, and plain text.
- `telegramClient`
  - Calls `getMe`, `getUpdates`, `sendMessageDraft`, `sendMessage`, and `sendChatAction`.
- `telegramParser`
  - Parses private text updates and bot commands.
- `telegramOutbound`
  - Builds plain-text assistant output, detects “desktop confirmation required” states, and chunks output to 4096 characters.
- `telegramPoller`
  - Runs a single sequential long-poll loop.
  - Advances the stored offset only after a specific update is handled successfully.
  - Uses exponential backoff on failures.

## Shared / IPC Contract

- Add `src/shared/types/presenters/remote-control.presenter.d.ts`.
- Expose methods for reading/saving Telegram settings, reading runtime status, generating/clearing pair codes, clearing bindings, and testing Telegram hooks.

## Renderer Plan

- Add a new `Remote` settings route and `RemoteSettings.vue`.
- Move Telegram configuration out of `NotificationsHooksSettings.vue`.
- Keep `Hooks` for Discord, Confirmo, and command hooks only.
- Reuse existing i18n flow for all renderer-visible strings.

## Data Model

- SQLite
  - No schema change.
  - Sessions/messages continue to use existing new-agent tables.
- Electron Store
  - `hooksNotifications.telegram`
    - Shared Telegram bot token and hook notification target settings.
  - `remoteControl.telegram`
    - `enabled`
    - `allowlist`
    - `streamMode`
    - `pairing`
    - `pollOffset`
    - `bindings`

## Event / Request Flow

1. Renderer saves Remote settings through `remoteControlPresenter`.
2. Main presenter updates `hooksNotifications.telegram` and `remoteControl.telegram`, then rebuilds the Telegram runtime if required.
3. Telegram poller receives private updates through `getUpdates`.
4. Parser normalizes text/command payloads.
5. Router applies auth and command handling.
6. Plain text enters `newAgentPresenter.sendMessage()` using the bound or newly created detached session.
7. Poller watches assistant message state and sends draft/final Telegram output.
8. If the assistant pauses on a permission/question action, Telegram returns a desktop-confirmation notice instead of bypassing approval.

## Testing Strategy

- Unit tests for `remoteAuthGuard`.
- Unit tests for `remoteBindingStore`.
- Unit tests for `remoteCommandRouter`.
- Unit tests for `telegramOutbound` chunking/final-text behavior.
- Presenter-level tests for detached session creation.
- Presenter-level tests for stop-by-event behavior.

## Migration Note

- No SQLite migration is required.
- Existing Telegram hook settings remain compatible.
- New remote state is additive and can be removed cleanly by disabling remote control or clearing the config blob.
