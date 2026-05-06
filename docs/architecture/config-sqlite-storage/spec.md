# Config SQLite Storage

## User Story

DeepChat configuration has outgrown JSON storage. Provider, model, MCP, and agent-adjacent
configuration should move to SQLite so frequent updates and larger collections remain structured,
queryable, and backed up with the main application database.

## Acceptance Criteria

- Provider and model configuration reads/writes keep the existing presenter and route behavior.
- MCP server configuration keeps the existing presenter and route behavior.
- Existing `agents` table remains unchanged in name and remains the source for AgentRepository data.
- Lightweight startup settings remain in JSON so logging, proxy, language, theme, sync path, and
  similar environment settings can be read before SQLite-backed config is attached.
- Legacy JSON/electron-store data is imported into SQLite exactly once and importing is idempotent.
- Sync backups include SQLite-backed configuration through `agent.db`; JSON backups exclude migrated
  provider/model keys.

## Non-Goals

- Do not change renderer route contracts or legacy presenter method names.
- Do not rename existing SQLite tables.
- Do not migrate prompts, system prompts, knowledge configs, or Nowledge-mem settings in this
  increment.
- Do not introduce secret encryption changes for API keys in this increment.

## Constraints

- The current startup sequence reads logging and proxy settings before the database is attached.
- The existing `ConfigPresenter` must continue to work as a compatibility facade.
- Old JSON files are retained after migration for rollback safety.
