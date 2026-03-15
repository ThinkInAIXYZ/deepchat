# Agent Cleanup Checkpoint

## Summary

This workstream is paused after the main cleanup milestones were completed and dead code was
archived.

Done:

- shared helper ownership moved to `src/main/lib/agentRuntime`
- active renderer chat path moved off legacy message protocol
- renderer dead code archived in `archives/code/dead-renderer-batch-1/`
- renderer mock/orphan dead code archived in `archives/code/dead-code-batch-2/`
- new-session skill state moved to `new_sessions.active_skills`
- legacy `agentPresenter/**` removed from global presenter access
- provider-layer MCP global access removed

## Keep For Now

- `LegacyChatImportService`
- legacy import hook / status tracking
- old `conversations/messages` tables as import-only sources
- `scripts/agent-cleanup-guard.mjs` as anti-regression protection

## Resume Order Later

When cleanup resumes, use this order:

1. clear the remaining export-only / non-active-path type coupling
2. inventory and reduce adjacent provider globals
3. run a final retirement audit on old presenter runtime wiring
4. only then consider deleting old legacy folders or old import tables

## Default Rules

1. One cleanup slice per PR.
2. Do not mix event-contract changes with runtime decoupling.
3. Do not remove import-only compatibility during routine refactors.
4. Prefer archiving dead code before hard deletion.
