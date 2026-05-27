---
name: deepchat-data-import
description: Help developers build third-party tools that import, inspect, migrate, or analyze DeepChat data. Use when Codex needs to work with DeepChat provider configuration, model configuration, MCP/app settings, sessions, messages, legacy chat data, `agent.db`, `chat.db`, SQLCipher encrypted SQLite, Electron safeStorage wrapped passwords, Tauri importers, or native macOS/Windows/Linux data access.
---

# DeepChat Data Import

## Overview

Use this skill to design or implement importers for DeepChat local data. Treat DeepChat's SQLite
schema as an internal but documentable contract: inspect the current schema when precision matters,
prefer read-only snapshots, and avoid writing to a live profile.

## Workflow

1. Identify the source: live DeepChat profile, copied profile, sync backup, exported `agent.db`, or
   legacy `chat.db`.
2. Read [references/data-locations.md](references/data-locations.md) to locate `agent.db`,
   sidecar files, encryption metadata, and backup paths.
3. Read [references/sqlite-access.md](references/sqlite-access.md) before opening SQLite. Decide
   whether the database is unencrypted, can be unlocked through Electron safeStorage, or must ask
   the user for the SQLite password.
4. Read [references/schema-reference.md](references/schema-reference.md) for provider config,
   settings, session, message, and legacy table relationships.
5. Read [references/import-recipes.md](references/import-recipes.md) when writing extractor code,
   mapping DeepChat data to another app, or creating a compatibility import.

## Safety Rules

- Get explicit user consent before reading local DeepChat data. Provider keys, OAuth tokens, MCP
  env vars, prompt text, message traces, and chat content may be sensitive.
- Never open the active `agent.db` read-write from a third-party tool. Copy `agent.db`,
  `agent.db-wal`, and `agent.db-shm`, or use SQLite backup APIs through DeepChat itself.
- If DeepChat is running, either ask the user to quit it or make a WAL-aware snapshot before import.
- Prefer parameterized key APIs for SQLCipher passwords. Do not interpolate passwords into SQL.
- Redact secrets by default in logs, telemetry, previews, and generated sample output.
- When the schema has changed, inspect `schema_versions`, `sqlite_master`, and the table classes
  under `src/main/presenter/sqlitePresenter/tables/` before assuming column availability.

## Source Files

Use these repository files as the current source of truth when updating the skill or answering
version-sensitive questions:

- `src/main/presenter/sqlitePresenter/index.ts`
- `src/main/presenter/sqlitePresenter/connectionConfig.ts`
- `src/main/presenter/databaseSecurityPresenter/index.ts`
- `src/main/presenter/sqlitePresenter/tables/*.ts`
- `src/main/presenter/agentRuntimePresenter/messageStore.ts`
- `src/main/presenter/agentRuntimePresenter/sessionStore.ts`
- `src/main/presenter/configPresenter/**`
