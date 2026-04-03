# Agent Cleanup Final Tasks

## Completed

- [x] Added cleanup docs and static guardrails
- [x] Moved shared runtime helpers out of legacy presenter folders
- [x] Moved active renderer chat path off `@shared/chat`
- [x] Removed dead renderer path code from the active tree
- [x] Removed renderer mock/orphan code from the active tree
- [x] Persisted new-session skills in `new_sessions.active_skills`
- [x] Retired old-session skill fallback to legacy conversation settings
- [x] Removed global `presenter.*` access from legacy runtime modules
- [x] Removed provider-layer `presenter.mcpPresenter` access
- [x] Removed live legacy `AgentPresenter` runtime wiring
- [x] Removed public `agentPresenter` / `sessionPresenter` IPC exposure
- [x] Removed `ILlmProviderPresenter.startStreamCompletion()`
- [x] Migrated retained ACP helpers to `src/main/presenter/llmProviderPresenter/acp/`
- [x] Migrated retained agent tools to `src/main/presenter/toolPresenter/agentTools/`
- [x] Migrated retained message formatting helper to `src/main/presenter/sessionPresenter/`
- [x] Removed retired source and tests from the active tree and preserved history in docs
- [x] Refreshed active architecture / flow / navigation docs

## Kept Intentionally

- [x] `LegacyChatImportService`
- [x] legacy import hook / status tracking
- [x] old `conversations/messages` tables
- [x] `SessionPresenter` as internal compatibility/data adapter
- [x] `scripts/agent-cleanup-guard.mjs`

## Remaining Backlog

- [ ] remove export-only `@shared/chat` coupling in `src/main/presenter/agentSessionPresenter/index.ts`
- [ ] remove non-active renderer residual import in `PromptEditorSheet`
- [ ] review adjacent provider globals such as `devicePresenter` / `oauthPresenter`
- [ ] normalize older historical specs that still mention retired legacy paths

## Historical Cleanup Batches

- [x] dead renderer batch
- [x] mock / orphan UI batch
- [x] legacy agent runtime batch
