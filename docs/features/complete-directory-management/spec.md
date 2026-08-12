# Directory and Default Workspace Contract

Status: implemented and maintained. GitHub issues `#1785` and `#1795` are closed.

## Ownership

`src/main/project/` owns managed directory metadata, default workspace, archive/remove/reorder and project
routes. Session only stores `projectDir`; Workspace owns filesystem authorization/tree/search. Directory
management never deletes real files.

## Active directory behavior

- Existing users without custom order see default directory first, then recent usage, then stable path order.
- Active managed directories are sidebar entities independently of Session history. In project grouping, an
  eligible zero-Session directory remains visible and can start its first scoped draft. The sidebar registration
  and merge contract is maintained in
  [`sidebar-workspace-registration`](../sidebar-workspace-registration/spec.md).
- Active non-temporary directories support persisted reorder from Settings and project-group sidebar mode.
- A directory newly registered or reactivated through the directory picker is persisted at the top of the
  active order in the same database transaction as recent-project registration, without projecting or
  checking every unrelated directory. Selecting an already-active directory does not change its position.
- Sidebar reorder is disabled outside project grouping or while search is active; sessions inside a group keep
  their normal activity ordering.
- The Chat and project-group section actions create a new draft with the relevant workspace context.
- Missing directories remain visible through the existing filter. App-managed temporary directories stay
  hidden unless they are the default or the user explicitly requests them.

## Archive, restore and remove

- Archive hides a directory from active management/project picker surfaces but preserves Session data and
  filesystem content.
- Active workspace rows expose Archive behind a confirmation dialog even when reorder is unavailable. A
  zero-Session row disappears after the archive mutation's exact Project snapshot version commits; existing
  Session history remains discoverable as a non-active historical group. A failed or incomplete refresh keeps
  the row and confirmation visible.
- Restore treats the directory as newly active: it is persisted at the top while existing active
  directories retain their relative order.
- Remove requires confirmation and means “remove from DeepChat”, never filesystem deletion.
- Removing a regular directory clears `projectDir` on associated regular Sessions.
- ACP workdir needed for resume is not destructively cleared; a tombstone prevents a derived environment from
  immediately reappearing until the path is selected again.
- Removing the default directory clears the default in the same transaction.

## Default workspace

The default workspace is optional, persisted by Project, and used when creating a draft without an explicit
project. Users can set, clear or change it from environment settings. An invalid/missing default must not
block opening DeepChat; the UI exposes the missing state and lets the user recover. A lifecycle snapshot that
archives or removes a manually selected draft workspace clears that selection before another draft is created.

## UI and compatibility

Settings provides active/archived views and the full lifecycle surface. The project-group sidebar exposes
active reorder and confirmed Archive; Restore and Remove remain in Settings. Drag is only a shortcut;
keyboard/menu actions must produce the same order. All strings use i18n and the route/client/store path
remains typed.

Existing `new_environments` usage data is migrated without losing Session/project associations. Derived usage
rows are not the sole source of archive/remove/order truth.

Non-goals: deleting filesystem folders, deleting all Sessions, nested directory hierarchies, rename and bulk
archive/remove.
