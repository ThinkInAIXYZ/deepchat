# Legacy AgentPresenter Retirement

## Summary

Retire the live legacy `AgentPresenter -> SessionManager -> streaming/permission/loop` runtime
chain and make the current `newAgentPresenter + deepchatAgentPresenter` path the only active chat
execution flow.

## Scope

In scope:

- remove live runtime wiring to legacy `AgentPresenter`
- remove public `agentPresenter` / `sessionPresenter` presenter exposure
- remove legacy `startStreamCompletion()` provider bridge
- migrate still-needed ACP helpers into `llmProviderPresenter/acp/`
- migrate still-needed agent tools into `toolPresenter/agentTools/`
- migrate retained message-formatting helpers into `sessionPresenter/`
- retire source and tests from the active tree and preserve history in docs
- document the retirement in active docs and specs

Out of scope:

- deleting legacy import support
- deleting old `conversations/messages` tables
- removing all historical specs that mention retired paths

## Compatibility Boundary

The boundary kept after retirement:

- `LegacyChatImportService`
- legacy import hook / status tracking
- old `conversations/messages` tables as import-only or export-facing sources
- `SessionPresenter` as a main-internal compatibility/data adapter

## Historical Preservation Policy

Retired live code must leave the active tree.

Historical structure is preserved in `docs/archives/` and related cleanup specs. Files still used by
active runtime are migrated into live modules instead of being kept as dormant source snapshots.

## Acceptance

The retirement is done when:

1. live `src/main` / `src/shared` / `src/renderer` code no longer imports legacy runtime folders
2. renderer no longer has public `agentPresenter` / `sessionPresenter` dependency
3. `ILlmProviderPresenter.startStreamCompletion()` is removed
4. migrated ACP / agent tool helpers compile and tests pass from their new locations
5. retired source/tests no longer exist in the active tree, and their historical shape is preserved in docs
6. active docs describe the current architecture and link historical docs as archive material
