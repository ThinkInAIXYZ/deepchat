# SQLite Database Encryption Plan

## Architecture

- Add a main-process database security layer responsible for encryption metadata, safeStorage
  wrapping, unlock, password validation, migration orchestration, and status reporting.
- Store non-secret encryption metadata outside SQLite in a small ElectronStore file, for example
  `database-security.json`.
- Keep `ConfigPresenter` startup behavior unchanged until SQLite is attached. After attach, route
  sensitive config keys through SQLite-backed storage.
- Extend `ConfigTables` with generic app configuration storage for sensitive settings that do not
  need dedicated relational tables.
- Keep splash as the only startup unlock UI. The main window is created only after DB unlock and DB
  initialization succeed.
- Expose settings operations through typed route contracts and `SettingsClient` or a dedicated
  `DatabaseSecurityClient`.

## Data Model

Unencrypted metadata store:

```ts
type DatabaseSecurityMetadata = {
  version: 1
  enabled: boolean
  cipher: 'sqlcipher'
  passwordStorage: 'safeStorage' | 'manual' | 'none'
  wrappedPassword?: string
  safeStorageBackend?: string
  lastMigrationAt?: number
  lastMigrationDirection?: 'enable' | 'change-password' | 'disable'
}
```

SQLite additions:

- `app_settings`: `key TEXT PRIMARY KEY`, `value_json TEXT NOT NULL`, `sensitive INTEGER NOT NULL`,
  `updated_at INTEGER NOT NULL`.
- Store migrated values under existing logical keys: `remoteControl`, `mcprouterApiKey`,
  `nowledgeMemConfig`, `hooksNotifications`, `knowledgeConfigs`, `customPrompts`, and
  `systemPrompts`.
- Keep existing provider/model/MCP/agent SQLite tables unchanged.

Password handling:

- The user-provided SQLite password is the database password for v1.
- If `safeStorage.isEncryptionAvailable()` is true, store only `safeStorage.encryptString(password)`
  as base64 in metadata. This uses the OS credential store, such as macOS Keychain, Windows
  Credential Vault, or a Linux secret store, through Electron.
- If safeStorage is unavailable, do not persist the password; metadata records `passwordStorage:
  'manual'`.
- If a manual unlock succeeds later on a system where safeStorage is available, re-wrap the password
  for future launches. This covers restored/imported data where the encrypted database exists but
  the local OS credential store does not have a usable wrapped password.

## Startup Unlock Flow

1. `configInitHook` creates `ConfigPresenter` and applies startup settings as today.
2. `databaseInitHook` creates or retrieves the database security service before `DatabaseInitializer`.
3. If metadata says encryption is disabled, initialize SQLite without a password.
4. If encryption is enabled and a wrapped password exists, try `safeStorage.decryptString()`.
5. Validate the decrypted password by opening the database with the normal SQLite open helper and a
   lightweight schema query.
6. If validation fails, if the local OS credential store entry is missing, or if safeStorage is
   unavailable, ask `SplashWindowManager` to enter unlock mode and await a password submission.
7. On wrong password, return an unlock error to splash and keep waiting.
8. On cancel, quit startup before main window creation.
9. On success, pass the password into `DatabaseInitializer({ password })`.

Splash unlock UI:

```text
+----------------------------------------+
| DeepChat                               |
| Local database is encrypted            |
|                                        |
| SQLite password                        |
| [ ******************************** ]    |
|                                        |
| Wrong password. Try again.             |
|                                        |
| [ Unlock ]                  [ Quit ]   |
|                                        |
| System unlock is unavailable on this   |
| device, so manual unlock is required.  |
+----------------------------------------+
```

System unlock progress state:

```text
+----------------------------------------+
| DeepChat                               |
| Unlocking local database               |
|                                        |
| Use the system unlock prompt if one    |
| appears.                               |
|                                        |
| Opening local database...              |
+----------------------------------------+
```

## SQLite Open And Validation

- Keep `cipher='sqlcipher'` and `legacy=4` configured before applying the key so newly encrypted
  databases use SQLCipher 4 compatibility mode and can be opened by tools such as DB Browser for
  SQLite with SQLCipher 4 defaults.
- Replace SQL string key interpolation with the native `db.key(Buffer.from(password, 'utf8'))` API
  or an equivalent parameter-safe binding path.
- Validate encrypted opens with a read against `sqlite_master`, then use the existing transaction
  validation in `DatabaseInitializer`.
- Ensure migration and unlock errors are normalized before reaching logs or renderer state.

## Migration Flow

Primary migration primitive:

- Use one source connection plus an attached temporary target database, then copy normal schema
  tables and rows into the target.
- `better-sqlite3-multiple-ciphers` backup cannot copy between incompatible encrypted/plaintext
  database states, and the current binding does not treat `VACUUM INTO` filenames as SQLite URI
  parameters. The attach/copy path is therefore the project-compatible migration primitive.
- Apply target passwords through `ATTACH DATABASE ? AS migration_target KEY ?` binding parameters
  after configuring SQLCipher 4 compatibility mode, not by interpolating a password into SQL text.
  For encrypted-to-plaintext disable, attach the target with an explicit empty key.
- Do not run native rekey against the active `agent.db`.

Runtime migration sequence:

1. Acquire a process-wide migration lock so settings, sync backup/import, and reset flows cannot run
   concurrently.
2. Close the active `SQLitePresenter` connection.
3. Open the source DB with the current password if encrypted.
4. Run WAL checkpoint and switch the source connection to a non-WAL journal mode for the export.
5. Create a temp destination DB in the same `app_db` directory by attaching it to the source
   connection.
6. Copy normal tables and row data into the attached target. Skip FTS virtual/shadow tables; the
   existing table initialization rebuilds those derived search indexes after reopen.
7. Open the temp DB through the normal SQLite helper using the target password.
8. Run `PRAGMA quick_check`, schema version checks, and key table row count checks.
9. Rename the active database to a short-lived rollback file, move the temp DB to `agent.db`, and
   remove sidecar files.
10. Reopen `SQLitePresenter` with the target password and reattach SQLite-backed config stores.
11. Update metadata only after reopen succeeds.
12. Delete the rollback file after successful reopen; on failure, restore it and reopen the original
    DB.

Status results returned to settings:

```ts
type DatabaseSecurityStatus = {
  enabled: boolean
  cipher: 'sqlcipher'
  safeStorageAvailable: boolean
  safeStorageBackend?: string
  passwordStorage: 'safeStorage' | 'manual' | 'none'
  manualUnlockRequired: boolean
  migrationInProgress: boolean
  lastMigrationAt?: number
}
```

## Settings UI

Add the section to the current Data settings page near privacy/data management controls.

```text
+------------------------------------------------------------------+
| SQLite database encryption                              Enabled  |
| Protects local chat history, provider keys, MCP config, prompts, |
| and other sensitive settings stored in agent.db.                 |
|                                                                  |
| Cipher                 SQLCipher                                |
| System unlock          Available via OS secure storage           |
| Startup unlock         System unlock                             |
| Last migration         2026-05-22 14:30                          |
|                                                                  |
| Current password       [ ************************ ]               |
| New password           [ ************************ ]               |
| Confirm password       [ ************************ ]               |
|                                                                  |
| [ Change password ]    [ Disable encryption ]                    |
+------------------------------------------------------------------+
```

Disabled state:

```text
+------------------------------------------------------------------+
| SQLite database encryption                              Disabled |
|                                                                  |
| System unlock          Unavailable                              |
| Startup unlock         Manual password required after enabling   |
|                                                                  |
| New password           [ ************************ ]               |
| Confirm password       [ ************************ ]               |
|                                                                  |
| [ Enable encryption ]                                            |
|                                                                  |
| This system cannot use Electron safeStorage. DeepChat can still  |
| encrypt the database, but you must enter the password on every   |
| startup.                                                         |
+------------------------------------------------------------------+
```

## Sensitive Config Migration

- Add DB-backed read/write adapters for sensitive app settings keys after SQLite attach.
- Migrate legacy values into `app_settings` once, guarded by a `config_migrations` marker such as
  `sensitive-config-sqlite-v1`.
- After successful migration and verification, remove migrated sensitive keys from `app-settings`
  JSON and replace prompt/knowledge JSON stores with empty defaults or remove the files.
- Keep non-sensitive startup settings in JSON.
- Update sync backup filtering so migrated sensitive settings are not copied into JSON backup paths.
- Import legacy backups by reading old JSON values and writing them into SQLite when config storage
  migration is active.

## Failure Modes

- SafeStorage unavailable: allow encryption, set metadata to manual mode, show manual prompt on
  startup.
- SafeStorage decrypt fails: show manual splash unlock; if manual unlock succeeds and safeStorage is
  available, re-wrap the password.
- Wrong password: keep splash open and do not initialize SQLite presenters.
- Migration fails before replacement: delete temp DB and reopen original DB.
- Migration fails after replacement: restore rollback DB and old metadata.
- App exits during migration: next startup detects temp/rollback files, restores the last complete
  database, and asks the user to retry migration.

## Testing

- Main tests cover safeStorage support states, password wrapping, unlock success/failure/cancel,
  migration success/rollback, WAL cleanup, and metadata updates.
- Main integration tests use temp databases for plaintext-to-encrypted, encrypted password change,
  encrypted-to-plaintext, and legacy sensitive config migration.
- Renderer tests cover Data settings states, validation errors, action disabling during migration,
  and splash unlock states.
- Manual QA covers macOS system unlock, Linux/manual unlock fallback, wrong password retry, cancel
  behavior, sync backup/import, and reset flows.

## Quality Gates

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- Focused Vitest suites for main encryption/migration and renderer settings/splash behavior.
