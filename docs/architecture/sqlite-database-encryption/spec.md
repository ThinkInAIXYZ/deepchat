# SQLite Database Encryption

## User Story

DeepChat users can store provider credentials, remote-control tokens, prompts, knowledge
configuration, and conversation history locally. Users need an optional database encryption mode so
the main SQLite database is encrypted at rest, can be unlocked during startup, and can be migrated
safely when the SQLite password changes.

## Goals

- Let users enable, change, and disable SQLite database encryption from the data settings screen.
- Require an unlock step before any SQLite-backed presenter opens an encrypted `agent.db`.
- Use Electron `safeStorage` to store the SQLite password when available.
- Fall back to manual unlock on every startup when `safeStorage` is unavailable or cannot decrypt.
- Migrate the existing database by writing a new database file, verifying it, and replacing the old
  file only after successful validation.
- Move remaining sensitive JSON/ElectronStore configuration into SQLite so encryption covers it.

## Acceptance Criteria

- A new data settings section shows database encryption state, selected cipher, safeStorage support,
  last migration time, and whether manual startup unlock is required.
- Enabling encryption requires a non-empty SQLite password and confirmation. On success, `agent.db`
  is replaced by an encrypted database and opens only with that password.
- Changing the password requires the current password, writes a new encrypted database using the new
  password, verifies the result, then replaces the active database.
- Disabling encryption requires the current password, writes a verified plaintext database, then
  replaces the active encrypted database.
- A failed migration leaves the original database and sidecar files usable.
- Successful migration removes temporary files and old `agent.db` sidecar files (`-wal`, `-shm`).
- Startup does not initialize SQLite-backed presenters until the encrypted database is unlocked.
- When `safeStorage` decrypts the stored password successfully, startup proceeds without showing a
  manual password prompt.
- When `safeStorage` is unavailable or decryption fails, the splash window shows an unlock form.
- Wrong passwords keep the user on the splash unlock form and do not open the main window.
- Canceling unlock exits startup without creating the main window.
- User-facing strings are localized through the renderer i18n system.
- No SQLite password or derived key is written to logs, route activity, migration errors, telemetry,
  or renderer-visible state.
- Legacy plaintext config copies for migrated sensitive keys are removed or redacted after successful
  SQLite migration.

## Data To Encrypt

Already covered once `agent.db` is encrypted:

- Conversations, messages, tool traces, assistant blocks, pending inputs, usage stats, search
  documents, search indexes, attachment metadata, projects, sessions, and agents.
- Provider credentials and provider metadata already stored in SQLite, including API keys, OAuth
  tokens, AWS Bedrock secrets, and Vertex credentials.
- MCP server config, MCP env/custom headers, MCP settings, agent settings, and agent MCP selections
  already stored in SQLite.

Move into SQLite in this feature:

- `remoteControl`: Telegram/Discord bot tokens, Feishu/Lark app secrets, verification tokens,
  encrypt keys, QQBot client secrets, Weixin iLink bot tokens, account state, and bindings.
- `mcprouterApiKey`.
- `nowledgeMemConfig`, including `apiKey`.
- `hooksNotifications`, especially hook commands and webhook-like values.
- `custom_prompts` and `system_prompts`.
- `knowledge-configs`, including RAGFlow, Dify, FastGPT, and built-in knowledge config metadata.
- Legacy provider/model/MCP keys that remain in plaintext JSON after the previous config-to-SQLite
  migration.

Keep outside encrypted SQLite for startup:

- Language, theme, logging, proxy mode, sync folder path, update channel, window/startup flags, and
  other settings needed before the database is opened.
- `customProxyUrl` stays in startup config for compatibility, but credentials embedded in proxy URLs
  should be rejected or split into encrypted storage in a follow-up.

## Non-Goals

- No cloud key backup or password recovery.
- No guaranteed secure deletion on SSDs or filesystems with snapshots.
- No encryption of external files already exported by the user, old sync backups, crash dumps, or OS
  backups.
- No guarantee that every supported OS will show biometric UI; Electron delegates to the platform
  password manager.
- No change to the core SQL schema names for existing conversation, provider, MCP, or agent tables.

## Constraints

- `configInitHook` must continue to read logging and proxy settings before SQLite opens.
- `databaseInitHook` is the earliest point where encrypted SQLite can be unlocked.
- The unlock UI belongs to the splash renderer so the main app is not shown before DB unlock.
- New renderer-main APIs should use typed route contracts and renderer API clients, not new direct
  `useLegacyPresenter()` usage.
- Migration SQL must not include raw passwords in any logged SQL string.
- The implementation must support both safeStorage-backed startup unlock and manual startup unlock.

## Security Notes

- The SQLite password is present in main-process memory while the app is running.
- `safeStorage` protects stored password material at rest for the current OS user; it does not defend
  against malware running as that user.
- Deleting old database files is ordinary file deletion, not cryptographic erasure.
- WAL/SHM sidecar files must be checkpointed and removed during migration because they may contain
  plaintext data from before encryption.
- Sync backups created before encryption may still contain plaintext data and remain the user's
  responsibility to delete.

## References

- Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- SQLite3 Multiple Ciphers overview: https://utelle.github.io/SQLite3MultipleCiphers/
- SQLite3 Multiple Ciphers SQL pragmas:
  https://utelle.github.io/SQLite3MultipleCiphers/docs/configuration/config_sql_pragmas/
- SQLite3 Multiple Ciphers URI parameters:
  https://utelle.github.io/SQLite3MultipleCiphers/docs/configuration/config_uri/
