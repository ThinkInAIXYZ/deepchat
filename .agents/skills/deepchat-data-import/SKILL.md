---
name: deepchat-data-import
description: Help developers build third-party tools that import, inspect, migrate, or analyze DeepChat data. Use when Codex needs to work with DeepChat provider configuration, model configuration, MCP/app settings, sessions, messages, legacy chat data, `agent.db`, `chat.db`, SQLCipher encrypted SQLite, Electron safeStorage wrapped passwords, Tauri importers, or native macOS/Windows/Linux data access.
---

# DeepChat Data Import

## Overview

Use this skill to design or implement importers for DeepChat local data. `agent.db` stores product
configuration, session metadata, legacy history and transcript projections. For a built-in session
bound to Dim, native history, events and attachments live in the Dim profile. Use DeepChat's
session export for a transcript and its full backup for restorable native history.

## Workflow

1. Identify the source: session export, live or copied profile, sync backup, standalone
   `agent.db`, or legacy `chat.db`. Check for a Dim session binding before treating SQLite
   message rows as complete.
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
- Never open the active `agent.db` read-write from a third-party tool. Use DeepChat's backup,
  a read-only SQLite backup connection, or a copy of the closed database and its sidecars.
- Prefer parameterized key APIs for SQLCipher passwords. Do not interpolate passwords into SQL.
- Redact secrets by default in logs, telemetry, previews, and generated sample output.
- Inspect `schema_versions` and `sqlite_master` before assuming column availability.
- Keep the Dim profile with its backup. Restore it through DeepChat with a compatible runtime.

## Source Files

Use these repository files as the current source of truth when updating the skill or answering
version-sensitive questions:

- SQLite and legacy encryption: `src/main/data/mainDatabase.ts`, `src/main/data/connectionConfig.ts`,
  `src/main/app/databaseSecurity.ts`.
- Settings and transcript tables: `src/main/provider/data/`, `src/main/settings/data/`, and
  `src/main/session/data/tables/`.
- Session export: `src/main/exporter/agentSessionExporter.ts`.
- Backup and restore: `src/main/sync/index.ts` and `src/main/agent/dim/profileBackups.ts`.
