# Complete Directory Management

Status: proposal for discussion.
Related issue: https://github.com/ThinkInAIXYZ/deepchat/issues/1785
Date: 2026-06-19

## User Need

As DeepChat accumulates project directories from normal sessions and ACP workdirs, users need a
clear way to organize active directories, move stale directories out of the everyday list, restore
archived directories, and remove directories that are no longer useful without losing existing
sessions or touching filesystem data unexpectedly.

## Current Behavior

- `Settings > Environments` renders a flat list from `project.listEnvironments`.
- `ProjectPresenter.getEnvironments()` reads `new_environments`, adds `exists` and `isTemp`, and
  sorts by derived `last_used_at`.
- `new_environments` is a derived aggregate from `new_sessions.project_dir` and ACP workdirs. It is
  rebuilt from sessions during legacy import and repaired schema flows, so deleting or editing only
  that row is not durable.
- The renderer `project` store can load environments, open a directory, and manage the global
  default directory. It has no APIs for order, archive, restore, or remove.
- The new chat project picker uses `new_projects` recent selections. The sidebar project grouping is
  derived from `Session.projectDir` and is separate from `Settings > Environments`.

## Goal

Provide complete directory lifecycle management centered on the existing Environments settings page
and reflected in the main sidebar when sessions are grouped by folder:

- reorder active directories with drag-and-drop and accessible menu actions;
- reorder folder groups directly in the main sidebar project-group mode;
- persist the order across restarts;
- archive directories so they leave the active management list but remain recoverable;
- view and restore archived directories;
- remove directories safely with clear confirmation and no filesystem deletion;
- migrate existing users without losing directories, sessions, or default directory behavior.

## Acceptance Criteria

1. Active directory ordering
   - Active non-temp directories can be reordered within the same flat list level by dragging the
     folder icon/name area.
   - The same reorder outcome is available from an item action menu, at minimum move up/down and
     move to top/bottom.
   - Reordered paths persist after app restart.
   - When the main sidebar is grouped by project directory, folder group headers use the same order
     and can also be reordered there.
   - Sidebar reordering only moves folder groups; sessions inside each folder remain sorted by
     `updatedAt` descending with the existing stable fallback.
   - Sidebar drag reorder is available only in project-group mode and when the sidebar search is
     empty.
   - Sidebar implementation follows the dedicated frontend technical plan so scroll pagination,
     auto-fill, pin animation, collapse state, shortcuts, and future virtual scrolling do not fight
     drag events.
   - Existing users with no custom order get a default order matching today's behavior: default
     directory first, then most recently used, then path as stable fallback.
2. Directory actions
   - Each row exposes actions through a More menu; right-click context menu can mirror the same
     actions if implementation cost stays low.
   - Open, set default, clear default, archive, restore, and remove are available only when valid for
     the row's lifecycle state.
   - Archive and remove require confirmation dialogs with explicit consequences.
3. Archive lifecycle
   - Archiving moves a directory out of the active management list and project picker surfaces that
     consume managed directory metadata.
   - Archived directories are visible in a dedicated archived view.
   - Restoring an archived directory returns it to the active list and places it near the top.
   - Archiving does not delete messages, sessions, ACP state, or filesystem folders.
4. Remove lifecycle
   - Removing a directory never deletes the real folder from disk.
   - Removing a regular project directory moves associated regular sessions to "No project" by
     clearing their `project_dir`.
   - Removing an ACP-only environment does not clear ACP workdir state if that would break resume;
     it records a tombstone so the derived environment does not reappear until the path is selected
     again.
   - If the removed path is the global default directory, the default is cleared as part of the
     confirmed operation.
5. Data compatibility
   - All existing environment rows remain active by default after upgrade.
   - Missing directories remain recoverable through the existing "show missing" control.
   - Temporary/app-managed directories remain hidden from the normal active list unless they are the
     default directory or the user explicitly opts into showing them.
6. UI quality
   - Drag feedback uses the folder icon/name area as the drag target, plus ghost/placeholder styling
     and short movement animation.
   - Text remains scannable in dense settings rows on desktop and narrow widths.
   - All new user-facing strings use i18n keys.
   - Tests cover data migration, presenter behavior, project client/store actions, and renderer
     component behavior.

## Recommended Interaction

Before:

```text
Environments                                      [Refresh]

[Show missing]  off

folder  app                         Open  Set default
        /work/app
        12 sessions | Last used Jun 18

folder  old-client                  Open  Set default
        /work/old-client
        2 sessions | Last used May 02
```

After:

```text
Environments                         [Active 12] [Archived 3] [Refresh]

[Show missing] off   [Show temp] off

Active
+------------------------------------------------------------+
| folder  app                      Default      Open   ...    |
|       /work/app                                             |
|       12 sessions | Last used Jun 18 | Exists               |
+------------------------------------------------------------+

+------------------------------------------------------------+
| folder  old-client                            Open   ...    |
|       /work/old-client                                      |
|       2 sessions | Last used May 02 | Missing               |
+------------------------------------------------------------+

More menu: Move up | Move down | Move to top | Archive | Remove from DeepChat

Archived
+------------------------------------------------------------+
| archive  folder  legacy-api                 Restore   ...  |
|          /work/legacy-api                                   |
|          18 sessions | Archived Jun 19                      |
+------------------------------------------------------------+
```

Main sidebar in project-group mode:

```text
All Agents                                      folder-mode  +
Search chats...

Pinned
  Chat A

folder  app                                    12
  Session updated recently
  Another session

folder  old-client                             2
  Legacy investigation

Date mode: no folder drag target.
Search active: folder drag target is disabled.
```

## Constraints

- Follow existing presenter boundaries: typed shared route contracts, main-process presenters, renderer
  API clients, Pinia store actions, and Vue Composition API components.
- Keep `new_environments` as the derived usage aggregate; do not rely on it alone for lifecycle state.
- Reuse existing `vuedraggable` and shadcn/reka UI primitives instead of adding another drag or modal
  library.
- Keep the first implementation flat. Cross-level moves and nested directory hierarchy are out of
  scope until the product has explicit nested directory semantics.

## Non-goals

- Deleting real filesystem folders.
- Deleting all sessions under a directory.
- Nested directory tree management.
- Bulk archive/remove.
- Directory rename.
- Changing global conversation search semantics for archived directories.
- Redesigning the sidebar session list beyond project-group reorder controls.

## Discussion Defaults Before Implementation

- Same-level only: implement a flat reorder first because DeepChat currently stores directories as
  paths, not as a tree with parent-child ownership.
- Primary surface: implement lifecycle management in `Settings > Environments`; keep sidebar reorder
  as a convenience entry point for users already organizing conversations.
- Sidebar behavior: support project group header reorder in v1. Do not hide archived project groups
  from the sidebar in the first pass unless we add an explicit archived group section, because hiding
  groups can make sessions feel lost.
- Remove wording: use "Remove from DeepChat" rather than "Delete folder" so users do not expect
  filesystem deletion.

## Research Notes

- Issue #1785 asks for drag-and-drop ordering, persisted order, delete/archive/restore, confirmations,
  and upgrade compatibility.
- `vue.draggable.next` supports Vue 3 drag-and-drop synchronized with the view model, handle
  selectors, smart auto-scroll, cancellation, and Sortable.js events.
- SortableJS exposes `animation`, `handle`, `ghostClass`, and `chosenClass`, which match the desired
  folder-identity drag target plus animated row reorder behavior.
- Atlassian's drag-and-drop accessibility guidance recommends alternatives to pointer dragging and
  item-level menus for movement outcomes.
- Nielsen Norman Group recommends clear grabbed/ghost feedback and animated movement previews for
  reorderable lists.
- Slack's archive/delete model distinguishes archive as preserved and recoverable from delete as
  permanent removal; DeepChat should be safer than Slack delete because local folders and sessions
  must not be destroyed by a directory-list action.

## Sources

- https://github.com/ThinkInAIXYZ/deepchat/issues/1785
- https://github.com/SortableJS/vue.draggable.next
- https://github.com/SortableJS/Sortable
- https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines
- https://www.nngroup.com/articles/drag-drop/
- https://slack.com/help/articles/213185307-Archive-or-delete-a-channel
