# ACP Session Sync

## Background

DeepChat stores its own local session rows and already persists an ACP mapping in
`acp_sessions`. Today that mapping is only useful after DeepChat itself created the ACP
session. Sessions that already exist inside the ACP agent are invisible to DeepChat, and
runtime cleanup can clear the saved ACP `sessionId`, preventing future `session/load`
reuse.

The ACP protocol now has the pieces DeepChat needs:

- [`session/list`](https://agentclientprotocol.com/protocol/session-list) discovers agent-owned
  sessions and returns `sessionId`, `cwd`, `title`, `updatedAt`, and pagination.
- [`session/load`](https://agentclientprotocol.com/protocol/session-setup) restores an existing
  session and replays its history via `session/update`.
- `session/resume` reconnects to an existing session without replaying history when the agent
  advertises `sessionCapabilities.resume`.

Zed's current ACP implementation keeps a local `ThreadId` separate from the ACP `SessionId`,
stores the mapping in thread metadata, lists external sessions for import, and registers the
local thread before `session/load` completes so history replay notifications have a target.

Local validation with `acpx --agent "dim acp"` against `dimcode 0.0.76-beta.0` confirmed that
DimCode advertises `loadSession: true` plus `sessionCapabilities.list/resume/close`, returns
sessions through `session/list`, and accepts both `session/load` and `session/resume` for the
same ACP `sessionId`.

## Goal

Keep DeepChat's local ACP sessions and the underlying ACP agent's sessions aligned enough that
users can discover, open, and continue agent-owned sessions from DeepChat without creating
duplicate conversations or losing the ACP session identity.

## User Stories

1. As a user who has existing sessions in an ACP agent, I can refresh/sync that agent in
   DeepChat and see matching sessions in DeepChat's session list for the relevant workdir.
2. As a user who opens a synced ACP session, DeepChat loads or resumes the original ACP
   `sessionId` instead of creating a new agent-side conversation.
3. As a user switching between DeepChat and another ACP client, title and updated-time changes
   from the agent stay reflected in DeepChat when the agent sends `session_info_update`.
4. As a user restarting DeepChat, local runtime cleanup does not erase the saved ACP `sessionId`;
   the next open can reuse the agent-side session.
5. As a user opening a synced session with `session/load`, DeepChat imports the replayed history
   into local messages without showing replayed history as the current prompt response.
6. As a user whose local DeepChat ACP session outlives the agent-side session, I keep my local
   history and can continue from it, even if DeepChat must create a fresh ACP session upstream.

## Acceptance Criteria

- DeepChat can call ACP `session/list` only after initialization confirms
  `agentCapabilities.sessionCapabilities.list`.
- DeepChat paginates `session/list` until `nextCursor` is absent or unchanged.
- Sync is scoped by ACP agent id and optionally by absolute workdir (`cwd` filter). A missing
  remote session in a filtered result never deletes a local DeepChat session.
- A DeepChat-only ACP session is treated as local user history, not garbage. It remains visible
  in DeepChat unless the user deletes or hides the local session.
- Local removal and remote deletion are separate actions. DeepChat must not call an ACP remote
  delete operation unless the agent explicitly advertises that capability.
- When a synced remote-backed ACP session is removed only from DeepChat, DeepChat records a local
  hide/tombstone entry keyed by agent id and ACP `sessionId` so the next `session/list` sync does
  not silently re-import it.
- ACP-backed local removal keeps a minimal hidden conversation/mapping record and purges local
  copied chat artifacts, including messages, assistant blocks, search documents, offload files,
  runtime/session caches, and permission state where applicable. The remote ACP session remains
  untouched.
- If the agent does not support remote session deletion, the UI must hide or disable "delete from
  agent" actions and present the operation as local-only removal/hiding.
- If the agent supports remote session deletion in the future, DeepChat may expose an explicit
  confirmed "delete from agent" action, but local removal remains available and must not be
  confused with runtime close.
- If an unfiltered `session/list` does not include a known ACP `sessionId`, DeepChat may mark the
  remote linkage as `not_listed`/unknown in metadata, but it must not delete local messages or
  clear the active mapping solely from list absence.
- For each remote ACP session, DeepChat creates or updates:
  - one local `new_sessions` row whose `id` remains a DeepChat conversation id,
  - one `deepchat_sessions` row with `provider_id = 'acp'` and `model_id = agentId`,
  - one `acp_sessions` row mapping the local conversation id to the remote ACP `sessionId`.
- The ACP `sessionId` is never used as the local DeepChat session id.
- Re-sync is idempotent: an existing `(agentId, acpSessionId)` updates metadata instead of
  creating another local session.
- Local session list ordering uses the remote `updatedAt` when it is valid; invalid or missing
  timestamps fall back to the sync time without breaking pagination.
- Runtime release, app quit, workdir change cleanup, and provider refresh do not clear a
  persisted ACP `sessionId`. Local ACP removal may hide the conversation and purge local copied
  chat data, but it preserves enough ACP identity to suppress automatic re-import.
- Opening a local ACP session with a persisted ACP `sessionId` attempts:
  1. `session/load` when `loadSession` is supported,
  2. `session/resume` when load is not supported and resume is supported,
  3. `session/new` only when neither reuse method is available or the persisted id is rejected.
- If `session/load` or `session/resume` confirms the persisted ACP `sessionId` no longer exists,
  DeepChat marks the linkage stale, preserves the old ACP id in metadata, keeps all local
  messages, and creates a new ACP session only when the user continues the conversation.
- When a stale DeepChat-only session creates a fresh ACP session, DeepChat updates the current
  `acp_sessions.session_id` to the new remote id and retains the previous missing id in metadata
  for diagnostics.
- During `session/load`, history replay notifications are persisted as historical messages and
  are not pushed into the active prompt stream.
- `session_info_update` with a valid title and/or `updatedAt` updates local session metadata,
  refreshes search documents, and emits the existing session-list update event.
- Existing locally-created ACP sessions keep working, including fallback to `session/new` when
  an older agent does not support load/list/resume.

## Non-Goals

- Unconditional remote agent history deletion from DeepChat. This feature syncs and reuses
  sessions; remote delete is only a future optional workflow for agents that advertise support.
- Full bidirectional message editing sync. DeepChat imports/reuses history and receives live
  updates, but editing local historical messages does not rewrite the ACP agent's storage.
- Syncing every ACP agent at startup. The first implementation should be scoped and demand-driven
  to avoid surprising session-list churn.
- Using unstable ACP fields as hard requirements. Optional message IDs and metadata improve
  idempotency but must have safe fallbacks.
- Treating ACP as authoritative over local DeepChat history. Agent-side absence does not imply
  local deletion.
- Changing non-ACP DeepChat session behavior.

## Constraints

- Follow DeepChat's SDD flow and existing Presenter pattern.
- Prefer typed routes/events for new renderer-main API; do not add new `useLegacyPresenter()`
  call sites.
- Preserve current ACP workdir requirements: an ACP session needs an absolute project/workdir.
- Keep `new_sessions.id` stable and local. Treat ACP `sessionId` as external identity stored in
  `acp_sessions`.
- Do not assume ACP `sessionId` is globally unique across all agents; lookup should be scoped by
  agent id where possible.
- History replay import must use structured message storage paths so user-message hot tables,
  assistant blocks, search documents, usage stats, and tape facts stay consistent.

## Research Notes

- DeepChat current mapping:
  - `new_sessions.id` is the local conversation id.
  - `acp_sessions` stores `conversation_id`, `agent_id`, `session_id`, `workdir`, and `status`.
  - `AcpSessionManager.initializeSession` only checks the local persisted ACP `sessionId`; it
    never discovers agent-side sessions.
  - `AcpContentMapper` currently ignores `session_info_update` and `user_message_chunk`.
- Zed reference:
  - `crates/acp_thread/src/connection.rs` defines session list/load/resume abstractions.
  - `crates/agent_servers/src/acp.rs` maps `session/list`, `session/load`, and `session/resume`.
  - `AcpConnection::open_or_create_session` de-duplicates active and pending loads by ACP
    `SessionId` and registers the session before the load RPC returns.
  - `ThreadMetadata` stores local `ThreadId` plus optional ACP `session_id`; external sessions
    are imported by creating a new local thread id while preserving the ACP id.
