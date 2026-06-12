# Data Locations

Use this reference when an importer must locate DeepChat data on disk or inside a backup.

## Primary Files

DeepChat stores the current main database at:

```text
<electron userData>/app_db/agent.db
<electron userData>/app_db/agent.db-wal
<electron userData>/app_db/agent.db-shm
```

The legacy database, when present, is:

```text
<electron userData>/app_db/chat.db
```

Database encryption metadata is outside SQLite:

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

DeepChat sync backups use `database/agent.db` as the primary database payload in current backup
versions. Some compatibility backups may also contain `database/chat.db` or old JSON settings. When
both `agent.db` and `chat.db` exist, prefer `agent.db`.

## Snapshot Rules

- If DeepChat is running, copy `agent.db`, `agent.db-wal`, and `agent.db-shm` together.
- If DeepChat is closed, `agent.db` alone is usually enough, but copying sidecars is still harmless.
- For high-integrity import, open a read-only source connection and run a SQLite backup into a temp
  file, then import from the temp file.
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
