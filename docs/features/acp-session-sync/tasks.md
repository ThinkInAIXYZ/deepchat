# ACP Session Sync Tasks

## Phase 1: Capability And Catalog Sync

- [ ] Add ACP session capability parsing for `sessionCapabilities.list`, `resume`, and `close`.
- [ ] Add `AcpProvider` / `LLMProviderPresenter` API to list remote ACP sessions with cursor
      pagination and optional `cwd` filtering.
- [ ] Add debug inspector actions for `listSessions` and `resumeSession`.
- [ ] Add SQLite/persistence helpers to find ACP mappings by `(agentId, acpSessionId)`.
- [ ] Add a local hidden/tombstone persistence model for remote-backed ACP sessions that keeps a
      minimal hidden conversation plus ACP mapping after users remove them from DeepChat.
- [ ] Decide and implement safe uniqueness for ACP session ids, scoped by agent id where possible.
- [ ] Add `AgentSessionPresenter.syncAcpAgentSessions` to upsert `new_sessions`,
      `deepchat_sessions`, and `acp_sessions`.
- [ ] Track remote observation metadata without deleting local sessions when `session/list`
      omits a known ACP `sessionId`.
- [ ] Make `session/list` import skip locally hidden/tombstoned ACP session ids unless the user
      explicitly requests re-import.
- [ ] Add typed route/client surface for triggering ACP session sync from renderer code.
- [ ] Emit existing session-list update events after sync.

## Phase 2: Stable Reuse Semantics

- [ ] Split ACP runtime release from ACP mapping deletion.
- [ ] Update app quit, provider refresh, workdir-change cleanup, and process release paths to
      preserve persisted ACP `sessionId`.
- [ ] Make ACP-backed local removal purge copied chat data while preserving the hidden
      conversation/mapping tombstone; do not call remote delete in this feature.
- [ ] Ensure ACP-backed local removal clears messages, assistant blocks, search documents, offload
      files, runtime caches, and permission/tool approval state for the conversation.
- [ ] Hide or disable any "delete from agent" UI affordance when the ACP agent does not advertise
      remote delete support.
- [ ] Add resume fallback in `AcpSessionManager.initializeSession` when load is unsupported.
- [ ] Mark mappings stale when `session/load` or `session/resume` confirms the remote session is
      missing, while preserving local messages.
- [ ] Rebind a stale local ACP session to a fresh ACP `session/new` only when the user continues
      the conversation.
- [ ] De-duplicate pending and active sessions by ACP `sessionId` when opening a known remote
      session.
- [ ] Register load replay handling before `session/load` can emit history notifications.

## Phase 3: Metadata And History Replay

- [ ] Surface `session_info_update` from ACP notifications.
- [ ] Update local session title and `updatedAt` from valid `session_info_update` payloads.
- [ ] Add `AcpSessionReplayImporter` for `session/load` history replay.
- [ ] Persist replayed user messages, assistant blocks, plans, and tool-call updates through
      structured message storage.
- [ ] Store ACP provenance for imported messages.
- [ ] Make replay idempotent when ACP message ids are present.
- [ ] Add safe fallback behavior when ACP message ids are absent.

## Phase 4: UI Integration

- [ ] Add a renderer entry point to refresh/sync ACP sessions for the selected ACP agent and
      workdir.
- [ ] Show synced ACP sessions in the existing session list using local DeepChat session ids.
- [ ] Preserve current draft creation flow when no remote session is selected.
- [ ] Show a quiet warning/status when a local ACP session had to continue with a new remote ACP
      session because the old agent-side session was missing.
- [ ] Add loading/error/empty states for unsupported `session/list` and sync failures.

## Phase 5: Verification

- [ ] Add unit tests for capability parsing and unsupported-agent behavior.
- [ ] Add unit tests for `session/list` pagination.
- [ ] Add unit tests for idempotent local import and metadata updates.
- [ ] Add unit tests proving runtime release preserves persisted ACP `sessionId`.
- [ ] Add unit tests for load/resume/new selection.
- [ ] Add unit tests for DeepChat-only sessions: list absence does not delete them, confirmed load
      miss marks stale, and next send rebinds to a new ACP session.
- [ ] Add unit tests that a local-only removal tombstone prevents automatic re-import.
- [ ] Add unit tests proving unsupported ACP remote delete is not exposed or called.
- [ ] Add unit tests for replay importer message grouping and idempotency.
- [ ] Add renderer/store tests for session-list refresh after sync.
- [ ] Manually validate against DimCode using `acpx --agent "dim acp"`.
- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
