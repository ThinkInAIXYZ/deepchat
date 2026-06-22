# Plan

## Approach

Add the smallest path that makes bootstrap return a valid default project path for first-run users
and lets the renderer distinguish that path from user-selected project folders:

1. Add a `ProjectPresenter.ensureDefaultWorkspace()` method.
2. Call it before startup bootstrap reads `ConfigPresenter.getDefaultProjectPath()`.
3. Return a typed built-in chat workspace marker in bootstrap.
4. Render built-in default workspace sessions under `Chats` / `聊天`, separate from normal project
   folders.

## Default Workspace Rules

- Resolve the preferred path as `path.join(app.getPath('documents'), 'DeepChat')`.
- If resolving or creating the Documents path fails, try `path.join(app.getPath('home'), 'DeepChat')`.
- If home also fails, use `path.join(userDataWorkspacesRoot, 'DeepChat')`.
- Create the chosen directory with `fs.mkdirSync(path, { recursive: true })`.
- Register it with:
  - `sqlitePresenter.newProjectsTable.upsert(defaultPath, 'DeepChat')`
  - `sqlitePresenter.newEnvironmentPreferencesTable.markActive(defaultPath)`
- If the current default is already one of the DeepChat default candidates, recreate/register that
  path idempotently when missing and leave the config value unchanged.
- Set `configPresenter.setDefaultProjectPath(defaultPath)` only when the current default is empty and
  there is no existing active workspace history.

`DeepChat` remains the stable on-disk and storage name. Renderer-visible labels for this built-in
path should come from i18n, not from the stored project name.

## Existing User Guard

Treat the app as an existing workspace user when either of these is true:

- `configPresenter.getDefaultProjectPath()` returns a non-empty custom path that is not one of the
  DeepChat default workspace candidates.
- Existing project/environment storage already contains at least one active non-removed workspace.

This avoids silently changing users who intentionally started with a manual project or later cleared
their global default.

## Affected Interfaces

- `src/main/presenter/projectPresenter/index.ts`
  - Add default path resolution and idempotent creation/registration.
  - Reuse the existing `userDataWorkspacesRoot` fallback.
  - Return the ensured built-in chat workspace path to the startup caller.
- `src/shared/types/presenters/project.presenter.d.ts`
  - Add the method to the presenter type if runtime typing requires it.
- `src/shared/contracts/common.ts`
  - Extend `StartupBootstrapShellSchema` with nullable built-in chat workspace metadata, for example
    `defaultChatWorkspacePath`.
- `src/main/routes/index.ts`
  - In `startup.getBootstrap`, ensure the default workspace before constructing the bootstrap
    payload in both coordinator and non-coordinator branches.
  - Include the built-in chat workspace path only when the current default is the built-in workspace.
- `src/renderer/src/stores/ui/project.ts`
  - Keep the built-in chat workspace path from bootstrap so renderer code can identify it without
    guessing from the folder basename.
- `src/renderer/src/stores/ui/session.ts`
  - In project grouping mode, map sessions whose `projectDir` matches the built-in chat workspace
    path to a `Chats` group with an i18n label key instead of a path-basename project group.
- `src/renderer/src/components/WindowSideBar.vue`
  - Keep user project folder groups under the normal project area and render the built-in chat
    workspace group as a separate non-reorderable `Chats` section.
- `src/renderer/src/i18n/*/chat.json`
  - Add sidebar label keys for `Chats` / `聊天`.

No new renderer API or preload route is required; startup bootstrap metadata is enough.

## Compatibility

- Existing configured defaults stay unchanged.
- Existing projects/environments stay unchanged.
- A real `Documents/DeepChat` folder with user files is reused, not cleaned or overwritten.
- If the fallback path is used, it is still registered in existing project/environment storage, but
  sidebar display uses the built-in chat workspace metadata instead of the basename.
- Remote/ACP-adjacent flows that read the global default workdir benefit automatically because they
  already call `ConfigPresenter.getDefaultProjectPath()`.

## Test Strategy

- Add focused `ProjectPresenter` tests for:
  - first-run creation and registration;
  - reuse of an existing default directory;
  - no migration when default path exists;
  - no migration when project/environment history exists;
  - Documents failure falling back to home or userData.
- Add or update startup route tests to prove bootstrap returns the ensured default path before the
  renderer receives it.
- Add renderer store/component tests for:
  - built-in default workspace sessions render under `Chats` / `聊天`;
  - user-selected folders remain under project folder groups;
  - the `Chats` section is not included in project-folder reordering.
- Run the repository-required checks after implementation:
  - `pnpm run format`
  - `pnpm run i18n`
  - `pnpm run lint`

## Deliberate Simplifications

- No one-time initialization flag. The ensure method is cheap and idempotent.
- No opt-out setting in the first increment. Existing users are protected by the guard.
- No new workspace/domain type table. A nullable bootstrap marker is enough for one built-in chat
  workspace.
