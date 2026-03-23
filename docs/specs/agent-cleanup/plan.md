# Agent Cleanup Final Plan State

## Summary

The cleanup is no longer paused. The runtime retirement slice completed on March 23, 2026.

## Completed Order

1. moved shared runtime helpers out of legacy presenter folders
2. moved active renderer chat path off legacy message protocol
3. archived dead renderer path code
4. persisted new-session skills in `new_sessions.active_skills`
5. removed legacy global presenter access
6. retired legacy `AgentPresenter` runtime and public exposure
7. migrated retained ACP/agent-tool helpers into current live modules
8. archived retired source/tests and refreshed active docs

## Keep For Now

- `LegacyChatImportService`
- legacy import hook / status tracking
- old `conversations/messages` tables as import-only or export-facing sources
- `SessionPresenter` as internal compatibility/data adapter
- `scripts/agent-cleanup-guard.mjs`

## Follow-up Order

When cleanup resumes, use this order:

1. clear remaining export-only / non-active-path type coupling
2. inventory and reduce adjacent provider globals
3. normalize older specs/docs that still mention retired paths where useful
4. only then consider deeper removal of legacy import-era tables

## Default Rules

1. Do not reintroduce retired runtime entrypoints.
2. Prefer archiving dead code before hard deletion.
3. Keep import-only compatibility separate from active runtime design.
4. Update docs/specs in the same slice when retiring architecture.
