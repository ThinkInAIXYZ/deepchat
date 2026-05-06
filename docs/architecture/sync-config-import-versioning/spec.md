# Sync Config Import Versioning

## User Story

DeepChat sync backups must preserve the SQLite-backed Provider, Model, MCP, and Agent-adjacent
configuration while still importing old backups that stored those settings in JSON files.

## Acceptance Criteria

- New backups use manifest version 2 and declare SQLite-backed config storage.
- New backups do not export migrated configuration in legacy JSON files.
- Old backups import legacy Provider, Model, MCP, and ACP residual settings into SQLite config
  tables.
- Increment imports preserve local config when IDs conflict.
- Overwrite imports replace config with backup data while preserving local sync settings.
- Backups with unsupported future versions fail before local data is changed.

## Non-Goals

- Do not change renderer routes or sync APIs.
- Do not add a separate config-v2 JSON export.
- Do not migrate prompts or knowledge configs into SQLite in this change.
