# SQLite Database Encryption Tasks

## SDD

- [x] Draft encryption spec, implementation plan, and task breakdown.

## Database Security Infrastructure

- [ ] Add database security metadata store outside SQLite.
- [ ] Add safeStorage wrapper with support detection, backend reporting, password wrap/unwrap, and
      normalized errors.
- [ ] Add database password validation using the project SQLite open helper.
- [ ] Replace SQL string password interpolation with the native `db.key(Buffer)` path or equivalent
      parameter-safe key application.
- [ ] Add tests for metadata defaults, safeStorage unavailable, safeStorage decrypt failure, and
      password validation.

## Startup And Splash Unlock

- [ ] Extend `SplashWindowManager` with an awaitable database unlock request API.
- [ ] Add typed splash IPC channels for unlock submit and cancel.
- [ ] Update `databaseInitHook` to resolve the SQLite password before creating `DatabaseInitializer`.
- [ ] Add splash renderer unlock and system-unlock-progress states.
- [ ] Add tests for successful system unlock, manual unlock, wrong password retry, and cancel before
      main window creation.

## Migration Engine

- [ ] Verify encrypted `VACUUM INTO` URI behavior against the project Electron/SQLite ABI.
- [ ] Add a migration lock shared by encryption changes, sync backup/import, DB repair, and reset
      flows.
- [ ] Implement plaintext-to-encrypted migration with temp DB validation and rollback.
- [ ] Implement encrypted password change with temp DB validation and rollback.
- [ ] Implement encrypted-to-plaintext disable flow with temp DB validation and rollback.
- [ ] Add sidecar cleanup for `agent.db-wal` and `agent.db-shm`.
- [ ] Add startup recovery for leftover temp/rollback migration files.
- [ ] Add tests for migration success, validation failure, replacement failure, rollback, and sidecar
      cleanup.

## Typed Routes And Settings UI

- [ ] Add shared route contracts for status, enable encryption, change password, and disable
      encryption.
- [ ] Add renderer API client methods for the new database security routes.
- [ ] Add Data settings encryption section with i18n text and password validation.
- [ ] Disable encryption actions while migration is running or when required password fields are
      invalid.
- [ ] Add settings activity records without storing raw passwords.
- [ ] Add renderer tests for enabled, disabled, safeStorage unavailable, validation, and migration
      progress states.

## Sensitive Config Into SQLite

- [ ] Add SQLite-backed generic `app_settings` storage for sensitive app config.
- [ ] Migrate `remoteControl` into SQLite and redact its legacy JSON copy.
- [ ] Migrate `mcprouterApiKey` into SQLite and redact its legacy JSON copy.
- [ ] Migrate `nowledgeMemConfig` into SQLite and redact its legacy JSON copy.
- [ ] Migrate `hooksNotifications` into SQLite and redact its legacy JSON copy.
- [ ] Migrate `knowledge-configs` into SQLite and clear the legacy ElectronStore file.
- [ ] Migrate `custom_prompts` and `system_prompts` into SQLite and clear legacy prompt files.
- [ ] Remove legacy provider/model/MCP sensitive leftovers from JSON once SQLite-backed config is
      verified.
- [ ] Update sync backup/import filtering and legacy backup import for migrated sensitive settings.
- [ ] Add tests for idempotent sensitive config migration and legacy JSON redaction.

## Verification

- [ ] Run focused main tests for encryption, migration, unlock, and sensitive config migration.
- [ ] Run focused renderer tests for Data settings and splash unlock UI.
- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
- [ ] Run `pnpm run typecheck`.
