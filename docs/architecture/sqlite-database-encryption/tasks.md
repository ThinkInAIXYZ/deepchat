# SQLite Database Encryption Tasks

## SDD

- [x] Draft encryption spec, implementation plan, and task breakdown.

## Database Security Infrastructure

- [x] Add database security metadata store outside SQLite.
- [x] Add safeStorage wrapper with support detection, backend reporting, password wrap/unwrap, and
      normalized errors.
- [x] Add database password validation using the project SQLite open helper.
- [x] Replace SQL string password interpolation with the native `db.key(Buffer)` path or equivalent
      parameter-safe key application.
- [x] Configure SQLCipher 4 compatibility mode before keying encrypted database connections.
- [x] Add tests for metadata defaults, safeStorage unavailable, safeStorage decrypt failure, and
      password validation.

## Startup And Splash Unlock

- [x] Extend `SplashWindowManager` with an awaitable database unlock request API.
- [x] Add typed splash IPC channels for unlock submit and cancel.
- [x] Update `databaseInitHook` to resolve the SQLite password before creating `DatabaseInitializer`.
- [x] Add splash renderer unlock and system-unlock-progress states.
- [ ] Add tests for successful system unlock, manual unlock, wrong password retry, and cancel before
      main window creation.

## Migration Engine

- [x] Verify backup-plus-temp-`db.rekey(Buffer)` behavior against the project Electron/SQLite ABI
      and replace it with attach/copy migration after incompatibility was confirmed.
- [ ] Add a migration lock shared by encryption changes, sync backup/import, DB repair, and reset
      flows.
- [x] Implement plaintext-to-encrypted migration with temp DB validation and rollback.
- [x] Implement encrypted password change with temp DB validation and rollback.
- [x] Implement encrypted-to-plaintext disable flow with temp DB validation and rollback.
- [x] Add sidecar cleanup for `agent.db-wal` and `agent.db-shm`.
- [x] Add startup recovery for leftover temp/rollback migration files.
- [ ] Add tests for migration success, validation failure, replacement failure, rollback, and sidecar
      cleanup.

## Typed Routes And Settings UI

- [x] Add shared route contracts for status, enable encryption, change password, and disable
      encryption.
- [x] Add renderer API client methods for the new database security routes.
- [x] Add Data settings encryption section with i18n text and password validation.
- [x] Explain OS credential-store unlock behavior and when manual password input is required.
- [x] Disable encryption actions while migration is running or when required password fields are
      invalid.
- [x] Add settings activity records without storing raw passwords.
- [ ] Add renderer tests for enabled, disabled, safeStorage unavailable, validation, and migration
      progress states.

## Sensitive Config Into SQLite

- [x] Add SQLite-backed generic `app_settings` storage for sensitive app config.
- [x] Migrate `remoteControl` into SQLite and redact its legacy JSON copy.
- [x] Migrate `mcprouterApiKey` into SQLite and redact its legacy JSON copy.
- [x] Migrate `nowledgeMemConfig` into SQLite and redact its legacy JSON copy.
- [x] Migrate `hooksNotifications` into SQLite and redact its legacy JSON copy.
- [x] Migrate `knowledge-configs` into SQLite and clear the legacy ElectronStore file.
- [x] Migrate `custom_prompts` and `system_prompts` into SQLite and clear legacy prompt files.
- [x] Remove legacy provider/model/MCP sensitive leftovers from JSON once SQLite-backed config is
      verified.
- [x] Update sync backup/import filtering and legacy backup import for migrated sensitive settings.
- [ ] Add tests for idempotent sensitive config migration and legacy JSON redaction.

## Verification

- [x] Run focused main tests for encryption, migration, unlock, and sensitive config migration.
- [x] Run focused renderer tests for Data settings encryption controls.
- [ ] Run focused renderer tests for splash unlock UI.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
