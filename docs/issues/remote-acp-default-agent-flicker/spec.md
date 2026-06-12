# Remote ACP Default Agent Flicker

## User Need
Users who pick an ACP agent in `Settings → Remote → <channel> → Default Agent` must see their selection persist instead of silently flicking back to a non-ACP agent.

## Goal
Stop `RemoteControlPresenter.sanitizeDefaultAgentId` from returning an alias-flattened id that the renderer cannot map back to a real `availableAgents` entry.

## Acceptance Criteria
- Selecting any ACP agent (registry-sourced or manually created) in any of the five remote channel settings (Telegram, Feishu, QQ Bot, Discord, Weixin iLink) keeps the selection after `syncXxxFields(saved)` runs.
- The persisted `defaultAgentId` always matches an `agent.id` returned by `agentSessionPresenter.getAgents()` (i.e. the SQLite-stored id), never a virtual alias-only id.
- Legacy bindings whose persisted `defaultAgentId` uses an alias-table key (e.g. `claude-code-acp` from older builds) get reconciled to the matching modern agent on first save/load instead of orphaning the Select control.
- Renderer falls back to a stable id when the binding refers to an agent that no longer exists, without producing a bare-id "ghost" option.

## Constraints
- No SQLite schema or stored-id migration. Keep `AgentRepository.syncRegistryAgents` / `createManualAcpAgent` insertion ids as-is.
- No IPC contract changes. `saveXxxSettings` input/output shapes stay the same.
- Reuse the existing `resolveAcpAgentAlias` helper rather than introducing parallel mapping logic. The helper itself can move to `src/shared/` but its semantics must not change.

## Non-Goals
- Adding inline "ACP requires a project directory" UX hint to the agent picker (separate follow-up).
- Reworking `agentSessionPresenter.getAgentType` alias handling — that layer is already correct and should not change.
- Migrating historical agent ids stored in chat sessions or LLM provider configs.
