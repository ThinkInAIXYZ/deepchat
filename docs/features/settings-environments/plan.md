# Settings Environments Plan

## Data Model

- Add `new_environments` with:
  - `path TEXT PRIMARY KEY`
  - `session_count INTEGER NOT NULL`
  - `last_used_at INTEGER NOT NULL`
- Add index `idx_new_environments_last_used` on `last_used_at DESC`.
- Add schema migration `v17` to create the table.
- Add schema migration `v18` to rebuild environment history from:
  - non-draft `new_sessions.project_dir`
  - ACP `workdir` rows when the linked session has no `project_dir`

## Synchronization Strategy

- Keep `new_environments` as a derived table managed in application code.
- `NewSessionManager` recomputes all affected paths after session create, update, and delete.
- ACP session persistence updates also recompute affected environment paths when `workdir` changes.
- `LegacyChatImportService` performs a full rebuild after import because it writes session rows directly.
- `SQLitePresenter.clearNewAgentData()` clears `new_environments` together with session-domain tables.

## Presenter / IPC

- Extend `IProjectPresenter` with:
  - `getEnvironments()`
  - `openDirectory(path)`
- Extend `IConfigPresenter` with:
  - `getDefaultProjectPath()`
  - `setDefaultProjectPath(path | null)`
- Add `CONFIG_EVENTS.DEFAULT_PROJECT_PATH_CHANGED` so renderers can react to default directory updates.

## Renderer

- Add `EnvironmentsSettings.vue` under settings routes.
- Reuse current settings card layout and controls.
- Use a switch to control temp directory visibility.
- Use the project store to:
  - fetch environment history
  - manage the default project path
  - open directories
- Extend the project store with:
  - `environments`
  - `defaultProjectPath`
  - selection-source tracking so default selection does not override manual selection
  - synthetic project injection for missing default/manual paths

## Sorting and Grouping

- Sort by:
  - default directory first
  - then `lastUsedAt DESC`
- Render as one main list, with temp environments appended in a collapsed section.
- Treat app-managed workspace roots, including legacy app-data `workspaces` paths, as temp entries.

## Test Strategy

- Main process:
  - migration `v18` backfill and idempotency
  - `NewEnvironmentsTable` single-path recompute, ACP `workdir` fallback, draft filtering, delete-on-empty, full rebuild
  - `ProjectPresenter` environment mapping and directory open behavior
  - `NewSessionManager` environment sync calls
  - `LegacyChatImportService` rebuild trigger and `workdir` import fallback
- Renderer:
  - settings page rendering, temp switch collapse, open/default/clear actions
  - project store default selection and synthetic project behavior
  - new thread page consumes the preselected project path
