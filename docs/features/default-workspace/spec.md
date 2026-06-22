# Default Workspace

Related issue: https://github.com/ThinkInAIXYZ/deepchat/issues/1795
Status: implemented
Date: 2026-06-22

## User Need

New users should be able to start a DeepChat agent session without selecting a folder first.
Today, a cold start can leave the workspace empty, so the file panel shows "No workspace" and agent
sessions may run without a working directory.

## Goal

Create and register a built-in default chat workspace at `Documents/DeepChat` for true first-run
users. The on-disk folder stays `DeepChat`, but user-facing navigation should call this space
`Chats` / `聊天` and keep it visually separate from user-selected project folders.

The default chat workspace can still be managed through the existing directory management flow, but
it must not look like a normal user project in the main session sidebar.

## Current Behavior

- `ConfigPresenter.getDefaultProjectPath()` returns `null` until a user setting exists.
- `ProjectPresenter.selectDirectory()` is the manual path that registers a workspace in
  `new_projects` and marks it active in `new_environment_preferences`.
- Startup bootstrap returns `defaultProjectPath` directly from `ConfigPresenter`.
- The renderer project store already selects a non-null bootstrap default path.
- Project-mode session grouping currently groups sessions by `projectDir` and labels each path by
  its basename, so `Documents/DeepChat` would appear as a normal `DeepChat` project group.
- Project-mode session grouping uses a separate no-project group for sessions with no `projectDir`;
  this group also belongs under `Chats` / `聊天`, not under normal project folders.
- `WorkspacePanel.vue` shows the `chat.workspace.files.noWorkspace.*` empty state when there is no
  workspace path.
- Local and remote agent workdir resolution already falls back to the global default project path.

## Desired UX

Before:

```text
Workspace
+--------------------------------+
| No workspace                   |
| Select or drag a folder        |
| [Select Folder]                |
+--------------------------------+
```

After first-run initialization in the workspace panel:

```text
Workspace
+--------------------------------+
| Chats                          |
| ~/Documents/DeepChat           |
| files appear as the user works |
+--------------------------------+
```

After first-run initialization in the main sidebar project mode:

```text
Pinned
  pinned session

Chats
  (collapsed by default)

Projects
  user-project-folder
    project-backed session
```

When no user project folders exist, the `Projects` area may only show the existing folder picker
entry. The `Chats` section is hidden when it has no sessions and visible once it has sessions.

## Acceptance Criteria

- On a true first launch with no configured `defaultProjectPath` and no existing workspace history,
  DeepChat creates `path.join(app.getPath('documents'), 'DeepChat')`.
- If Electron cannot provide or create the Documents path, DeepChat falls back to
  `path.join(app.getPath('home'), 'DeepChat')`; if that also fails, it falls back to
  `path.join(app.getPath('userData'), 'workspaces', 'DeepChat')`.
- Default workspace creation is idempotent: an existing `DeepChat` directory is reused, and a
  previously initialized default workspace is recreated on a later launch if the folder disappears.
- Existing users are not migrated. If they already have a custom global default project path or any
  active project/environment history, startup leaves their config untouched.
- The default workspace is inserted into the same project/environment storage used by manual folder
  selection.
- User-facing labels for the built-in default workspace use `Chats` / `聊天`; the UI must not expose
  it as a normal `DeepChat` project group in the main session sidebar.
- Chat/no-project affordances in the new-thread selector and sidebar use a chat icon, not a folder
  icon.
- Project-mode sidebar grouping separates sessions backed by the built-in default workspace from
  sessions backed by user-selected project folders.
- Project-mode sidebar grouping also renders explicitly no-project sessions under `Chats` /
  `聊天`.
- The `Chats` section appears directly below pinned sessions, is collapsed by default, and is hidden
  when it contains no sessions.
- User-selected project folders remain under the normal `Projects` area and keep existing project
  group ordering/reordering behavior.
- The built-in `Chats` section is not reorderable with user project folders.
- When the user explicitly chooses no project for a DeepChat session, session creation passes a
  nullable `projectDir` through to the main process and does not fall back to the global default
  workdir.
- Manual folder selection still overrides the selected workspace for the current session as it does
  today.
- Removing or archiving the default workspace through existing directory management clears or changes
  only DeepChat metadata according to existing directory-management behavior; it never deletes the
  real folder.
- The behavior works on macOS, Windows, and Linux.

## Constraints

- Keep the folder name on disk exactly `DeepChat` across locales.
- Pass enough typed metadata to the renderer to distinguish the built-in chat workspace from a custom
  user default project path. Do not infer this from the basename `DeepChat`.
- Do not add a new dependency.
- Do not overwrite files inside an existing `DeepChat` directory.
- Keep startup work cheap and synchronous enough for the current bootstrap path, or async only where
  the route already awaits work.

## Non-goals

- Adding an opt-out setting.
- Creating a new persisted workspace type system beyond the one built-in chat workspace marker.
- Migrating existing users to `Documents/DeepChat`.
- Renaming, moving, or deleting filesystem directories.
- Redesigning the workspace empty state.

## Open Questions

None.
