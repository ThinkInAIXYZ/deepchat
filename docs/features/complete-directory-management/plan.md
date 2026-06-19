# Plan

## Current Data Flow

```text
new_sessions.project_dir \
                          +-> new_environments derived aggregate -> ProjectPresenter.getEnvironments()
acp_sessions.workdir ----/                                         +-> project.listEnvironments

project.listEnvironments -> ProjectClient -> project store -> EnvironmentsSettings.vue
new_projects recent list -> ProjectPresenter.getRecentProjects() -> NewThreadPage project picker
Session.projectDir -> session store -> WindowSideBar project groups
new_environment_preferences.sort_order -> project/session stores -> settings list + sidebar groups
```

`new_environments` cannot be the only persistence layer for order/archive/remove, because it is
recomputed from sessions. Add durable display metadata beside the derived aggregate and join it at
read time.

## Recommended Architecture

Add a small metadata table owned by the SQLite presenter, for example
`new_environment_preferences`:

```text
path TEXT PRIMARY KEY
status TEXT NOT NULL DEFAULT 'active'  -- active | archived | removed
sort_order INTEGER
archived_at INTEGER
removed_at INTEGER
updated_at INTEGER NOT NULL
```

Use the next global schema version after the current maximum (`32` at the time of writing) and add
the table to `SQLitePresenter.initTables()`, migration collection, and `schemaCatalog`.

This is a real new table, but it is necessary because `new_environments` is derived and can be
rebuilt. Keeping preferences separate avoids corrupting usage aggregates and preserves compatibility
with existing sync/repair logic.

## Main Process Work

1. Add `NewEnvironmentPreferencesTable`
   - Create/get migration SQL.
   - Upsert status and order.
   - Reorder active paths with dense integer positions.
   - Clear removed tombstones when a path is explicitly selected or assigned again.
2. Extend environment reads
   - `NewEnvironmentsTable.list()` can stay usage-only.
   - `ProjectPresenter.getEnvironments({ status })` joins usage rows with preference rows.
   - Default status is `active` when no preference exists.
   - `removed` rows are excluded unless internal code explicitly requests them.
   - Sort order: default directory first, explicit `sort_order`, derived `last_used_at DESC`, path.
3. Add lifecycle methods
   - `reorderEnvironments(paths: string[])`
   - `archiveEnvironment(path: string)`
   - `restoreEnvironment(path: string)`
   - `removeEnvironment(path: string, options)`
   - Reuse `reorderEnvironments` from both Settings and the main sidebar so all directory order
     changes share the same persistence path.
4. Preserve session integrity for remove
   - For regular sessions, route through `AgentSessionPresenter` or an equivalent session-domain
     method so active runtime state and stored `project_dir` stay in sync.
   - For ACP-only derived entries, keep ACP workdir intact and store `status = removed`.
   - Clear `defaultProjectPath` if it matches the removed or archived path.

## Shared Contracts

Extend `EnvironmentSummary` and `EnvironmentSummarySchema`:

```ts
type EnvironmentStatus = 'active' | 'archived'

interface EnvironmentSummary {
  path: string
  name: string
  sessionCount: number
  lastUsedAt: number
  isTemp: boolean
  exists: boolean
  status: EnvironmentStatus
  sortOrder: number | null
  archivedAt: number | null
}
```

Add routes:

- `project.listEnvironments` input: `{ status?: 'active' | 'archived' }`
- `project.reorderEnvironments` input: `{ paths: string[] }`
- `project.archiveEnvironment` input: `{ path: string }`
- `project.restoreEnvironment` input: `{ path: string }`
- `project.removeEnvironment` input: `{ path: string, clearSessionProjectDirs?: boolean }`

Keep existing route defaults compatible so old callers that pass `{}` still receive active
environments.

## Renderer Store And API

Update `ProjectClient` and the `project` Pinia store:

- `fetchEnvironments(status = 'active')`
- `fetchArchivedEnvironments()`
- `reorderEnvironments(paths)`
- `archiveEnvironment(path)`
- `restoreEnvironment(path)`
- `removeEnvironment(path, options)`
- optimistic reorder with rollback on failure;
- refresh active and archived lists after archive/restore/remove.

If the new chat project picker should honor managed order/status in the same slice, introduce a
computed picker source that merges managed active environments with recent manual projects without
duplicating paths.

Expose the active directory order to the sidebar either by:

- letting `session` store consume a small order map from `project` store; or
- adding a focused project client call that returns environment preferences without requiring the
  settings page to be mounted.

Prefer the first option if lifecycle refresh timing stays simple; prefer the second if cross-store
coupling makes startup or tests harder to reason about.

## Environments Settings UX

Use `SettingsPageShell` and keep the dense list layout:

- Add segmented control or tabs for `Active` and `Archived`.
- Keep refresh in page actions.
- Keep "Show missing"; add "Show temp" if archived/temp visibility needs explicit control.
- Render active rows inside `vuedraggable` with:
  - `item-key="path"`;
  - `handle=".environment-folder-drag-target"`;
  - `animation="150"`;
  - `ghost-class` and `chosen-class`.
- Do not add a separate drag affordance icon. The folder icon/name area is the drag target.
- Disable pointer drag while searching/filtering if the resulting subset would make reorder
  ambiguous.
- Add a More menu per row:
  - active: move up, move down, move to top, move to bottom, archive, remove;
  - archived: restore, remove.
- Add confirmation dialogs:
  - archive: states that sessions and folder are preserved, active list entry is hidden;
  - remove: states folder and messages are preserved, regular sessions move to "No project", default
    is cleared when relevant.
- Toast failures with the existing `useToast` destructive variant.

## Sidebar And Picker Integration

Recommended first implementation:

- Settings page is the complete lifecycle management surface.
- The main sidebar is a second reorder surface when `sessionStore.groupMode === 'project'`.
- Sidebar implementation must follow
  [sidebar-frontend-technical-plan.md](./sidebar-frontend-technical-plan.md), especially the event
  gates around scroll pagination, auto-fill, search, pin animation, and group collapse.
- Sidebar project groups use the folder icon/name area as the drag target. Do not add a separate drag
  affordance icon.
- Dragging a sidebar project group calls the same `project.reorderEnvironments` route used by
  Settings.
- Grouped sessions inside a directory keep the current `updatedAt DESC` ordering.
- Disable sidebar drag reorder while sidebar search is active; filtered reordering is ambiguous.
- New chat project picker should avoid offering archived or removed directories once it reads managed
  metadata.
- Sidebar project groups should not hide archived groups in v1 unless we add an explicit archived
  section. This prevents existing conversations from appearing to disappear.

## Compatibility And Migration

- No data rewrite is required for existing rows. Missing metadata means active/default order.
- `new_environments` rebuilds remain valid because preferences are stored separately.
- Legacy import and repair flows should not wipe preferences.
- If a removed path is explicitly selected again through the folder picker or assigned to a session,
  clear the tombstone so the directory can reappear.

## Test Strategy

- SQLite table tests:
  - default active status with no preference;
  - archive/restore status transitions;
  - remove tombstone excludes derived row;
  - reorder writes dense positions and preserves unknown rows.
- Project presenter tests:
  - mapping includes lifecycle fields;
  - active/archived filters;
  - default path ordering;
  - default clearing on archive/remove.
- Route contract tests for all new routes and extended schema fields.
- Renderer API client tests for new methods.
- Project store tests for optimistic reorder and archive/restore/remove refresh.
- `EnvironmentsSettings` tests:
  - active and archived tabs;
  - drag reorder emits/store call;
  - menu move actions;
  - archive/remove dialogs;
  - restore action;
  - missing/temp filters do not corrupt order.
- Session store/sidebar tests:
  - project group headers follow managed directory order;
  - drag reorder is exposed only in project-group mode;
  - drag reorder is disabled while search is active;
  - sessions inside groups stay sorted by most recent update.

Before handoff after implementation, run:

```text
pnpm run format
pnpm run i18n
pnpm run lint
```

Run focused main/renderer tests while developing, then broaden as needed for touched modules.
