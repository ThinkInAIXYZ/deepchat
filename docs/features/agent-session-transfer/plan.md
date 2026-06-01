# Implementation Plan - Agent Session Transfer

## Current Code Notes

- `DeepChatAgentsSettings.vue` deletes custom DeepChat agents through
  `configPresenter.deleteDeepChatAgent(form.id)` after `window.confirm`.
- `AcpSettings.vue` deletes manual ACP agents through `configPresenter.removeManualAcpAgent(agent.id)`
  after `window.confirm`.
- `AcpSettings.vue` uninstalls registry ACP agents through
  `configPresenter.uninstallAcpRegistryAgent(agent.id)` after a basic confirm dialog.
- `AgentRepository.deleteDeepChatAgent` currently reassigns all `new_sessions.agent_id` values from
  the deleted custom DeepChat agent to built-in `deepchat`.
- `AgentRepository.removeManualAcpAgent` deletes only the agent record.
- `NewSessionsTable` already supports list/page filtering by `agentId` and has a batch
  `reassignAgentId(fromAgentId, toAgentId)`, but it does not expose a precise single-session
  ownership update or impact counts.
- `AgentSessionPresenter` is the correct place to check runtime state, delete sessions with their
  child subagents, emit session-list updates, and coordinate ACP session cleanup.
- `AgentRuntimePresenter` caches session agent ids in memory, so ownership moves need a runtime hook,
  not just a database update.
- `ChatTopBar.vue` already has a right-side `...` dropdown for writable sessions. Its current order
  is pin/unpin, clear messages, separator, delete. The session move entry should be inserted between
  pin/unpin and clear messages.

## Architecture

### Shared Contracts

Add typed route contracts in `src/shared/contracts/routes/sessions.routes.ts`:

- `sessions.getAgentTransferImpact`
  - input: `{ agentId: string }`
  - output: `{ impact: AgentTransferImpact }`
- `sessions.moveAgentSessions`
  - input: `{ fromAgentId: string; toAgentId: string }`
  - output: `{ movedSessionIds: string[]; deletedSessionIds: string[] }`
- `sessions.deleteAgentSessions`
  - input: `{ agentId: string }`
  - output: `{ deletedSessionIds: string[] }`
- `sessions.moveSessionToAgent`
  - input: `{ sessionId: string; toAgentId: string }`
  - output: `{ session: SessionWithState }`

Proposed shared shape:

```ts
type AgentTransferImpact = {
  agentId: string
  totalSessions: number
  regularSessions: number
  subagentSessions: number
  emptyDrafts: number
  movableSessions: number
  blockedSessions: number
  samples: Array<{
    id: string
    title: string
    sessionKind: 'regular' | 'subagent'
    isDraft: boolean
    projectDir: string | null
    status: 'idle' | 'generating' | 'error'
    blockReason?: 'active' | 'pending-input'
  }>
}
```

Keep `config.listAgents` as the source for enabled target-agent options.

### Presenter Responsibilities

`AgentSessionPresenter`:

- `getAgentTransferImpact(agentId)`
  - List `new_sessions` with `{ agentId, includeSubagents: true }`.
  - Treat drafts with no message ids as empty drafts.
  - Use `getSessionState` and pending-input inspection to classify movable vs blocked.
  - Return a small sample list for the dialog, not the full history.
- `moveAgentSessions(fromAgentId, toAgentId, options)`
  - Validate both agents exist and are not the same.
  - Recompute impact server-side immediately before mutation.
  - Refuse the entire operation when any non-empty related session is blocked.
  - Delete empty drafts for the source agent.
  - Move each non-empty related session through the same internal helper used by
    `moveSessionToAgent`.
  - If a later mutation fails after earlier sessions moved or drafts were deleted, throw an error
    that includes partial-success counts so the UI can show a recoverable state instead of hiding the
    mixed result.
- `moveSessionToAgent(sessionId, toAgentId, options)`
  - Only allow regular sessions from the public chat-level route.
  - Refuse active/generating sessions.
  - Resolve target runtime defaults:
    - DeepChat target: target agent config merged with built-in DeepChat defaults, then app default
      model fallback.
    - ACP target: rejected. Conversation history must not move into ACP agents.
  - Update `new_sessions.agent_id` and any target-specific session fields in one logical operation.
  - Update the DeepChat runtime's session-agent cache and provider/model/generation settings.
  - Clear stale ACP binding for the previous ACP agent only after target context, `new_sessions`, and
    related session metadata updates have succeeded.
  - Emit `SESSION_EVENTS.LIST_UPDATED` / typed `sessions.updated`.
- `deleteAgentSessions(agentId)`
  - Recompute impact.
  - Refuse active sessions.
  - Delete related sessions with existing `deleteSessionInternal`, which already handles child
    sessions, message cleanup, permissions, skills, search documents, and ACP cleanup.

`AgentRuntimePresenter`:

- Add an optional implementation method such as `setSessionAgentContext(sessionId, context)` to
  `IAgentImplementation`.
- The DeepChat implementation updates `sessionAgentIds`, provider/model, generation settings,
  disabled tool cache, project dir cache, and invalidates system prompt/tool profile caches without
  deleting messages.
- It must reject generating sessions.

`NewSessionsTable` / `NewSessionManager`:

- Add a precise `updateAgentId(sessionId, agentId)` helper.
- Keep `reassignAgentId` as a low-level fallback only; the transfer path should move session by
  session so runtime state and ACP cleanup stay correct.
- Consider `countByAgent(agentId, includeSubagents)` for fast summary, but correctness can start with
  `list({ agentId, includeSubagents: true })`.

`AgentRepository` / `ConfigPresenter`:

- Change custom DeepChat deletion so it no longer silently reassigns sessions to built-in DeepChat.
  The UI should call the session move/delete route first, then delete the agent.
- Manual ACP deletion can keep removing only the agent record, because the UI/session route will have
  already moved or deleted related sessions.
- Registry ACP uninstall must use the same session transfer/delete flow as manual ACP deletion.
- Keep a defensive fallback in the delete methods: if sessions still exist for the source agent,
  return `false` or throw a clear error instead of silently orphaning or reassigning them.

### Renderer

Create a reusable transfer dialog surface, likely `AgentTransferDialog.vue` plus a thin
delete-agent wrapper. It should support both one-shot agent deletion migration and single-session
movement.

For delete-agent usage, mount it from:

- `DeepChatAgentsSettings.vue`
- `AcpSettings.vue` manual custom-agent section
- `AcpSettings.vue` installed registry-agent section

For chat-level usage, mount it from `ChatTopBar.vue` and open it from the right-side `...` menu item
placed between pin/unpin and clear messages:

```text
DropdownMenuContent
  Pin / Unpin
  Move conversation
  Clear messages
  separator
  Delete
```

The delete-agent dialog fetches:

- impact via `SessionClient.getAgentTransferImpact(agentId)`
- target options via `ConfigClient.listAgents()`, filtered to enabled DeepChat agents except source

It submits:

- move path: `SessionClient.moveAgentSessions(...)`, then existing agent deletion
- delete path: `SessionClient.deleteAgentSessions(agentId)`, then existing agent deletion

The chat-level dialog fetches the same target options and submits:

- move path: `SessionClient.moveSessionToAgent(sessionId, targetAgentId)`

Dialog layout requirements:

- Use a viewport-aware max height, for example
  `max-h-[min(720px,calc(100vh-2rem))]` on desktop and `max-h-[calc(100vh-1rem)]` on narrow
  screens.
- Keep the header and footer outside the scrolling region so the title and actions remain visible.
- Put impact summaries, affected chat samples, explanatory copy, and the target picker in an
  internal `overflow-y-auto` body.
- Prefer a single-column mobile layout; only use side-by-side summary/details areas on wider screens.
- Ensure long agent names, session titles, and project paths truncate or wrap without widening the
  dialog.
- Use a loading state inside the body, not a full-window blocker.

Chat-level move behavior:

- Show only for active regular sessions.
- Disable while the session status is generating.
- Use `SessionClient.moveSessionToAgent(sessionId, targetAgentId)`.
- Update `useSessionStore` with the returned session and let existing selected-agent sync run.

## Event Flow

Delete with move:

```text
Settings delete button
  -> SessionClient.getAgentTransferImpact(agentId)
  -> AgentDeleteImpactDialog opens
  -> user chooses target agent
  -> SessionClient.moveAgentSessions(fromAgentId, toAgentId)
  -> AgentSessionPresenter moves sessions and emits sessions.updated
  -> ConfigPresenter deletes source agent and emits config.agents.changed
  -> settings reloads agents, session store refreshes affected sessions
```

Registry ACP uninstall with move follows the same flow, except the final step calls
`ConfigPresenter.uninstallAcpRegistryAgent(agentId)` instead of deleting an agent row.

Delete with related chats removed:

```text
Settings delete button
  -> impact dialog
  -> user chooses "Delete chats with this Agent"
  -> SessionClient.deleteAgentSessions(agentId)
  -> ConfigPresenter deletes source agent
  -> session store receives deleted session IDs and list updates
```

Single session move:

```text
ChatTopBar right-side ... menu
  -> user selects target agent
  -> SessionClient.moveSessionToAgent(sessionId, targetAgentId)
  -> AgentSessionPresenter updates session ownership/runtime context
  -> sessions.updated(reason: updated)
  -> Session store upserts returned session and selected agent syncs to target
```

## Data Rules

- Preserve:
  - `new_sessions.id`, title, pin state, project dir, parent relation
  - deepchat messages, assistant blocks, files, traces, tape entries
  - search documents and usage stats
  - session summary/compaction state where still meaningful
- Reset or recompute:
  - target agent id
  - provider/model for future turns
  - DeepChat generation defaults for target DeepChat agents
  - disabled tools from the target DeepChat agent
  - ACP external session id and bound process state
- Delete:
  - empty drafts during delete-agent flow
  - related sessions only when the user explicitly picks the destructive option

## ACP Transfer Handling

- ACP agents are allowed as sources only. A manual ACP agent's idle chats can move to an enabled
  DeepChat agent before the ACP agent is deleted.
- ACP agents are never valid transfer targets. This blocks both DeepChat-to-ACP and ACP-to-ACP moves,
  reducing the risk of future conflicts with ACP's external session bindings.
- When moving an ACP-backed chat to DeepChat, clear the stale ACP provider binding after applying the
  target DeepChat runtime context and updating session ownership/metadata.
- Because ACP is not a target, the first increment does not need a workdir picker in the transfer
  dialog.

## Compatibility

- Existing sessions assigned to removed manual ACP agents are not fixed automatically by this feature
  unless the source agent still exists at deletion time. A later repair utility can scan orphaned
  `new_sessions.agent_id` values.
- Existing custom DeepChat deletion behavior changes from implicit fallback to explicit user choice.
  This is intentional and should be called out in release notes.
- No schema migration is required for the first increment if `new_sessions.agent_id` is updated via a
  new helper.

## Test Strategy

Main tests:

- `agentRepository.test.ts`
  - Custom DeepChat delete refuses when sessions remain, or no longer silently reassigns.
  - Manual ACP delete remains safe after sessions are moved/deleted.
  - Registry ACP uninstall refuses to clear installation state while sessions remain.
- `agentSessionPresenter.test.ts`
  - Impact summary counts regular/subagent/draft/blocked sessions.
  - Batch move DeepChat -> DeepChat applies target ownership and model defaults.
  - Batch move ACP -> DeepChat clears ACP binding and keeps messages.
  - ACP binding cleanup happens after target context and session ownership updates.
  - Batch move failures report partial move/delete counts.
  - Moving to an ACP target is rejected for both DeepChat and ACP sources.
  - Active/generating sessions block move and delete.
  - `deleteAgentSessions` deletes related sessions through existing recursive cleanup.
- `agentRuntimePresenter.test.ts`
  - Session agent context update refreshes cached agent id and invalidates prompt/tool caches.
  - Generating sessions reject context transfer.

Renderer tests:

- `DeepChatAgentsSettings.test.ts`
  - Delete opens impact dialog.
  - Move path calls session move before agent delete.
  - Delete path calls session delete before agent delete.
- `AcpSettings` test coverage for manual ACP delete impact dialog.
- `ChatTopBar` tests:
  - `Move conversation` appears between pin/unpin and clear messages.
  - Selecting it opens the transfer dialog.
  - The entry is disabled or unavailable for read-only/subagent/active sessions.
- Dialog responsiveness tests should assert the shell has a viewport max height and the detail body
  owns the scroll region.
- Store/client tests for single-session move and disabled active state.

Quality gates after implementation:

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- Targeted Vitest suites for touched main and renderer modules

## Risks

- Runtime cache drift is the main risk. Mitigation: transfer through AgentSessionPresenter and add a
  runtime-level context update method.
- ACP sessions may have provider-specific expectations about session continuity. Mitigation: allow
  ACP only as a source, clear stale ACP bindings when moving to DeepChat, and reject ACP targets.
- Batch deletion is destructive. Mitigation: in-app dialog, explicit destructive option, and tests that
  verify move is the default/safe path.
- Applying target DeepChat defaults can surprise users who expected current model settings to remain.
  Mitigation: dialog copy states that future replies use the target agent; future enhancement can add
  "keep current model/settings".
