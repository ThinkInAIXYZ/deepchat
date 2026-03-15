# Agent Cleanup

## Summary

This cleanup tracks the phased removal of legacy coupling around the new agent architecture.

Current primary flow:

- renderer new stores / `NewThreadPage` / `ChatPage`
- `newAgentPresenter`
- `deepchatAgentPresenter`

Legacy compatibility remains import-only for old session data. Old `conversations` / `messages`
tables are kept as migration sources during this cleanup and are not removed in this workstream.

As of March 15, 2026:

- renderer active chat path is clean and guarded
- renderer dead code has been archived under `archives/code/`
- the next cleanup focus is the main compatibility layer
- legacy `agentPresenter` runtime no longer reads `presenter.sessionManager` directly
- legacy `agentPresenter` runtime no longer reads `presenter.toolPresenter` directly
- legacy `agentPresenter/**` no longer reads global `presenter.*` directly; remaining global
  presenter access is outside that folder and stays out of scope for now
- `llmProviderPresenter/providers/**` still has a small provider-layer global presenter surface,
  with MCP tool conversion and ACP registry lookup now detached; remaining usage is limited to
  adjacent `devicePresenter` / `oauthPresenter` access
- `SkillPresenter` now reads session state through an injected new-session port; old-session
  `activeSkills` fallback semantics have been retired, and imported `legacy-session-*` skills are
  repaired back into `new_sessions.active_skills` on first access

Target end-state:

- legacy runtime logic is removed from the new primary flow
- only legacy data import compatibility remains
- old runtime folders/helpers stay only as long as they are required by import-only code paths

## Goals

1. Prevent new primary-flow code from adding fresh dependencies on legacy presenter modules.
2. Extract shared runtime helpers out of legacy presenter folders.
3. Move new UI chat rendering to `agent-interface` types instead of `@shared/chat`.
4. Persist new-session skill state in the new session domain.
5. Reduce runtime fallbacks to legacy chat-mode/session paths where the new architecture already
   owns the behavior.
6. Retire legacy runtime ownership once import-only compatibility is stable.

## Non-Goals

1. Removing legacy import support in this phase.
2. Dropping old database tables in this phase.
3. Rewriting `llmProviderPresenter` internal legacy loop as part of the first cleanup batch.
4. Keeping legacy runtime logic around permanently.

## Batch Boundaries

### Batch 0

- Add spec artifacts.
- Add static dependency guardrails.

### Batch 1

- Extract shared helpers from legacy presenter folders.
- Narrow new primary-flow type imports.

### Batch 2

- Switch new UI chat pages/components/stores to `agent-interface` message types.

### Batch 3

- Persist `activeSkills` in `new_sessions`.
- Remove new-session runtime fallback to legacy conversation settings and global chat mode.

### Batch 4

- Re-audit runtime references and retire legacy-only runtime wiring that is no longer needed.

## Main Compatibility Classification

### Active Compatibility Layer

- `SkillPresenter`
- `skillExecutionService`
- `mcpPresenter/toolManager`
- `Presenter` default legacy wiring
- `main/index` direct legacy session cleanup call
- `llmProviderPresenter/providers/**` provider-layer presenter globals
- `SkillPresenter` old-session conversation fallback has been retired; legacy `active_skills`
  remains import-only data

### Import-Only Compatibility To Keep

- `LegacyChatImportService`
- legacy import hook / status tracking
- old `conversations` / `messages` tables as import sources

### Deferred Until Runtime Cleanup Completes

- export-path type coupling in `newAgentPresenter`
- retirement/deletion of old `agentPresenter` / `sessionPresenter` folders
- provider-layer global presenter access outside `agentPresenter/**`, including
  `llmProviderPresenter/providers/**`
- one-time imported legacy-session skill repair via `legacy_import_status` marker

## Safety Rules

1. One cleanup batch per PR.
2. Do not combine runtime decoupling, UI protocol changes, and data migration in the same PR.
3. Keep behavior unchanged while moving helper ownership.
4. Keep `legacyImportHook` and `LegacyChatImportService` available until data compatibility is
   intentionally retired in a separate task.

## Event Contract Baseline

Cleanup must preserve the current main-to-renderer event contract until a dedicated event-migration
batch exists.

### Session Events

- `session:list-updated`
  - Sender: `newAgentPresenter`
  - Payload: none
  - Renderer effect: `useSessionStore.fetchSessions()`
- `session:activated`
  - Sender: `newAgentPresenter`
  - Payload: `{ webContentsId, sessionId }`
  - Renderer effect: activate the matching session only for the current `webContentsId`
- `session:deactivated`
  - Sender: `newAgentPresenter`
  - Payload: `{ webContentsId }`
  - Renderer effect: clear the active session only for the current `webContentsId`
- `session:status-changed`
  - Sender: `deepchatAgentPresenter`
  - Payload: `{ sessionId, status }`
  - Renderer effect: map runtime status to UI status (`generating -> working`, `idle -> none`)
- `session:compaction-updated`
  - Sender: `deepchatAgentPresenter`
  - Payload: `{ sessionId, status, cursorOrderSeq, summaryUpdatedAt }`
  - Note: emitted by main, but there is no direct renderer store listener in the current new UI

### Stream Events

- `stream:response`
  - Sender: `deepchatAgentPresenter/dispatch.ts` and `deepchatAgentPresenter/echo.ts`
  - Payload: `{ conversationId, eventId, messageId, blocks }`
  - Renderer effect: `useMessageStore` updates `streamingBlocks`, marks the session as streaming,
    and may hydrate/update the in-flight assistant message by `messageId`
- `stream:end`
  - Sender: `deepchatAgentPresenter/dispatch.ts` and `deepchatAgentPresenter/index.ts`
  - Payload: `{ conversationId, eventId, messageId }`
  - Renderer effect: `useMessageStore` clears local streaming state and reloads messages from DB
  - Important: this event currently means both "stream finished" and "message refresh needed"
- `stream:error`
  - Sender: `deepchatAgentPresenter/dispatch.ts`, `deepchatAgentPresenter/process.ts`, and
    `deepchatAgentPresenter/index.ts`
  - Payload: `{ conversationId, eventId, messageId, error }`
  - Renderer effect: clear local streaming state and reload messages from DB error state

### Hidden Coupling To Preserve For Now

1. `useMessageStore` treats `stream:end` as the trigger to reload persisted messages, not just as a
   terminal stream signal.
2. The renderer now uses `agent-interface` + local display message types on the active chat path,
   so stream payload identity must still keep matching persisted `conversationId` / `messageId`
   records.
3. Event payload identity currently relies on `conversationId` and `messageId` matching DB records.
4. The order "emit stream update -> persist/finalize -> emit end/error" must remain stable within a
   cleanup slice unless the renderer listener is migrated in the same dedicated batch.
