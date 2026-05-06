# Sync Config Import Versioning Plan

## Architecture

- Add a small sync config import service that parses legacy JSON config files and writes them to
  `ConfigTables`.
- Keep `agent.db` as the source of truth for v2 config backups.
- Use the backup manifest for version routing: missing/v1 is legacy, v2 is current, future versions
  are rejected.

## Import Behavior

- For v2 backups, import SQLite tables using the existing database import flow.
- For legacy backups, import conversations as before, then import old config files into SQLite.
- Increment mode only fills missing config rows. Overwrite mode replaces the corresponding config
  tables from backup data.
- Imported legacy config marks the config migration as applied so startup does not re-import stale
  JSON over the restored SQLite tables.

## Export Behavior

- Write `manifest.version = 2`, `configStorage = sqlite`, and `configSchemaVersion = 1`.
- Export `agent.db`, lightweight app settings, custom prompts, and system prompts.
- Do not export `mcp-settings.json` or migrated app-settings keys.
