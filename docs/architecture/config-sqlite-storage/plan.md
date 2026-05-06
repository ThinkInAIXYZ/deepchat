# Config SQLite Storage Plan

## Architecture

- Add SQLite tables using direct business names: `providers`, `provider_models`, `model_status`,
  `model_configs`, `mcp_servers`, `mcp_settings`, `agent_mcp_selections`, and `agent_settings`.
- Keep the existing `agents` table and `AgentRepository` flow. Only residual ACP settings move out
  of the old `acp_agents` store.
- Add DB-backed store adapters that mimic the small ElectronStore surface used by existing helpers.
  This lets `ProviderHelper`, `ProviderModelHelper`, `ModelStatusHelper`, `ModelConfigHelper`,
  `McpConfHelper`, and `AcpConfHelper` keep most existing behavior.
- Attach SQLite-backed config after database and agent repository initialization. Until then,
  ConfigPresenter uses JSON for startup-critical settings.

## Migration

- Read legacy provider/model/MCP/ACP data from current ElectronStore-backed helpers before switching
  helpers to DB-backed stores.
- Import legacy data into the new tables inside an idempotent migration guarded by
  `config_migrations`.
- Preserve legacy JSON files after successful import.

## Compatibility

- Keep existing route contracts and presenter method signatures unchanged.
- Return `LLM_PROVIDER[]`, `MODEL_META[]`, `MCPServerConfig`, and model config exports in their
  current shapes.
- Keep old backup import support for legacy archives that still contain `mcp-settings.json`.

## Backup

- Continue backing up `agent.db`.
- Back up app settings as lightweight JSON with migrated provider/model keys filtered out.
- Continue backing up prompts and system prompts until their second-phase migration.
