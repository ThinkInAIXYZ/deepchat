# Data Locations

Use this reference when an importer must locate DeepChat data on disk or inside a backup.

## Primary Files

DeepChat stores product settings, metadata and SQLite projections at:

```text
<electron userData>/app_db/agent.db
<electron userData>/app_db/agent.db-wal
<electron userData>/app_db/agent.db-shm
```

The built-in agent uses `<electron userData>/dim/rust` for native session history, events and
attachments. The legacy database, when present, is:

```text
<electron userData>/app_db/chat.db
```

Legacy database encryption metadata is outside SQLite:

```text
<electron userData>/database-security.json
```

The file is an ElectronStore JSON file. The relevant shape is:

```json
{
  "metadata": {
    "version": 1,
    "enabled": true,
    "cipher": "sqlcipher",
    "passwordStorage": "safeStorage",
    "wrappedPassword": "base64-electron-safeStorage-blob",
    "safeStorageBackend": "basic_text",
    "lastMigrationAt": 1770000000000,
    "lastMigrationDirection": "enable"
  }
}
```

`passwordStorage` can be `safeStorage`, `manual`, or `none`. If `enabled` is false, open
`agent.db` as normal SQLite.

## Default UserData Paths

Electron derives the profile path from the packaged product name `DeepChat` unless the runtime
overrides `app.getPath('userData')`.

```text
macOS:   ~/Library/Application Support/DeepChat
Windows: %APPDATA%\DeepChat
Linux:   ~/.config/DeepChat
```

Treat these as defaults. Portable builds, development builds, tests, or user overrides can point
elsewhere.

## Sync Backup Layout

DeepChat sync backups contain `manifest.json` and `database/agent.db`, with a WAL sidecar when
needed. When a version 3 manifest declares `nativeProfile`, retain `dim/manifest.json` and the
matching payload under `dim/profile/` for native session restore. Some compatibility backups
contain `database/chat.db` or old JSON settings. Use `agent.db` for app data when both exist.

## Snapshot Rules

- For a running app, use its backup or the SQLite backup API from a read-only source connection
  when only the app database is needed.
- For a closed app, keep `agent.db` with any existing WAL and SHM sidecars.
- Do not delete `*.migration-tmp`, `*.migration-rollback`, `agent.db-wal`, or `agent.db-shm` from a
  user profile. DeepChat owns those lifecycle decisions.

## Related Files Still Outside Agent.db

Most sensitive configuration has moved into SQLite. Some lightweight or compatibility JSON files may
still exist in userData, including:

- `app-settings.json`
- `custom_prompts.json`
- `system_prompts.json`
- `mcp-settings.json`

Prefer SQLite tables for current provider, MCP, app setting, prompt, and knowledge config imports.
Use JSON files only as legacy fallback.
