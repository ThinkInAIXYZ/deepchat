# Agent Cleanup

## Summary

The cleanup reached final runtime retirement on March 23, 2026.

Current primary flow:

- renderer active chat pages/stores/components
- `newAgentPresenter`
- `deepchatAgentPresenter`
- `toolPresenter`
- `llmProviderPresenter`

Completed in this retirement slice:

- retired live legacy `AgentPresenter` runtime wiring
- removed public `agentPresenter` / `sessionPresenter` IPC exposure
- removed `ILlmProviderPresenter.startStreamCompletion()`
- migrated retained ACP helpers into `src/main/presenter/llmProviderPresenter/acp/`
- migrated retained agent tools into `src/main/presenter/toolPresenter/agentTools/`
- moved retained user message formatting helpers into `src/main/presenter/sessionPresenter/`
- removed retired source and tests from the active tree, with history preserved in docs

## Compatibility Boundary

The supported compatibility boundary is now:

- keep `LegacyChatImportService`
- keep legacy import hook / status tracking
- keep old `conversations/messages` tables as import-only or export-facing sources
- keep `SessionPresenter` as a main-internal compatibility/data facade only

The new primary flow must not regain runtime ownership from retired `AgentPresenter`.

## Guardrails

`scripts/agent-cleanup-guard.mjs` remains the anti-regression guard.

It now protects these invariants:

1. new main-path modules must not import retired legacy presenter runtime paths
2. active renderer chat path must not reintroduce `@shared/chat`
3. provider-layer code must not regain retired legacy fallbacks
4. `SkillPresenter` and MCP gating must not regain retired legacy global access
5. retired runtime code stays archived rather than silently re-entering the live tree

## Completed Milestones

- shared helper ownership moved to `src/main/lib/agentRuntime`
- active renderer chat path moved off legacy message protocol
- dead renderer and mock/orphan code removed from the active tree
- new-session skills persisted in `new_sessions.active_skills`
- legacy `agentPresenter/**` removed from global presenter access
- provider-layer MCP global access removed
- final legacy runtime retirement completed and documented

## Remaining Backlog

The remaining work is no longer runtime-retirement work. It is adjacent cleanup only:

- export-only `@shared/chat` coupling in `newAgentPresenter`
- non-active renderer residual import in `PromptEditorSheet`
- adjacent provider globals such as `devicePresenter` / `oauthPresenter`
- optional archival/normalization of older specs that still mention retired paths
