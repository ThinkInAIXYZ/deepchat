# Agent Cleanup

## Summary

This cleanup paused at a stable checkpoint on March 15, 2026.

Current primary flow:

- renderer active chat pages/stores/components
- `newAgentPresenter`
- `deepchatAgentPresenter`

Current state:

- active renderer chat path no longer depends on `@shared/chat`
- dead renderer and mock code has been archived under `archives/code/`
- new-session skills live in `new_sessions.active_skills`
- imported `legacy-session-*` skills are repaired back into `new_sessions.active_skills` on first
  access
- legacy `agentPresenter/**` no longer reads global `presenter.*` directly
- provider-layer MCP conversion no longer reads `presenter.mcpPresenter`

## Compatibility Boundary

The supported compatibility boundary is now:

- keep `LegacyChatImportService`
- keep legacy import hook / status tracking
- keep old `conversations/messages` tables as import-only sources

The new primary flow should not regain runtime ownership from old `agentPresenter` /
`sessionPresenter` code.

## Guardrails

`scripts/agent-cleanup-guard.mjs` is still intentionally kept.

It now acts as a pure anti-regression guard with zero baseline:

1. new main-path modules must not import legacy `agentPresenter/sessionPresenter`
2. active renderer chat path must not reintroduce `@shared/chat`
3. legacy `agentPresenter/**` must not regain global `presenter.*` access
4. provider-layer code must not reintroduce `presenter.mcpPresenter`
5. `SkillPresenter` and MCP gating must not regain retired legacy fallbacks

This is low maintenance now because there is no allowlist left to manage.

## Remaining Work

The cleanup is intentionally paused here. Remaining backlog is small and can wait for future
feature work:

- export-only `@shared/chat` coupling in `newAgentPresenter`
- non-active renderer residual import in `PromptEditorSheet`
- adjacent provider globals such as `devicePresenter` / `oauthPresenter`
- final runtime retirement audit for old presenter folders
