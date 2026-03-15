# Agent Cleanup Checkpoint Tasks

## Completed

- [x] Added cleanup docs and static guardrails
- [x] Moved shared runtime helpers out of legacy presenter folders
- [x] Moved active renderer chat path off `@shared/chat`
- [x] Archived dead renderer path code in `archives/code/dead-renderer-batch-1/`
- [x] Archived renderer mock/orphan dead code in `archives/code/dead-code-batch-2/`
- [x] Persisted new-session skills in `new_sessions.active_skills`
- [x] Retired old-session skill fallback to legacy conversation settings
- [x] Removed global `presenter.*` access from `agentPresenter/**`
- [x] Removed provider-layer `presenter.mcpPresenter` access
- [x] Reduced startup/runtime legacy wiring on the new primary path

## Kept Intentionally

- [x] `LegacyChatImportService`
- [x] legacy import hook / status tracking
- [x] old `conversations/messages` tables as import-only sources
- [x] `scripts/agent-cleanup-guard.mjs`

## Remaining Backlog

- [ ] `src/main/presenter/newAgentPresenter/index.ts` still has export-only `@shared/chat` coupling
- [ ] `src/renderer/settings/components/prompt/PromptEditorSheet.vue` still imports `MessageFile`
  from `@shared/chat` outside the active chat path
- [ ] adjacent provider globals remain for later review:
  - `presenter.devicePresenter` in OpenAI providers
  - `presenter.oauthPresenter` in Anthropic
- [ ] final retirement audit for old runtime folders and wiring

## Archive Batches

- [x] `archives/code/dead-renderer-batch-1/`
- [x] `archives/code/dead-code-batch-2/`
