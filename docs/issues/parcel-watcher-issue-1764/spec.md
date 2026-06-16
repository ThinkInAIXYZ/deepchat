# Parcel Watcher Issue 1764 Spec

## Goal

Fix GitHub issue #1764 by replacing DeepChat's runtime file watching dependency with
`@parcel/watcher`, eliminating the workspace watcher file-descriptor exhaustion path while
preserving workspace refresh and skill hot-reload behavior.

## Sources

- GitHub issue: https://github.com/ThinkInAIXYZ/deepchat/issues/1764
- `@parcel/watcher` package: https://www.npmjs.com/package/@parcel/watcher
- `@parcel/watcher` README: https://github.com/parcel-bundler/watcher
- VS Code File Watcher Internals:
  https://github.com/microsoft/vscode/wiki/File-Watcher-Internals
- VS Code source repo: https://github.com/microsoft/vscode
  - `src/vs/platform/files/node/watcher/parcel/parcelWatcher.ts`
  - `src/vs/platform/files/node/watcher/watcherMain.ts`
  - `extensions/git/src/repository.ts`

## Problem

Issue #1764 reports that selecting a large macOS workspace such as `~/Downloads` with about
260k recursive entries causes the workspace content watcher to exhaust the main process file
descriptor pool. The observed failure chain is:

```text
large workspace
  -> chokidar fs.watch traversal
  -> EMFILE from too many watched entries
  -> child process spawn cannot allocate stdio fds
  -> agent exec utility exits during startup
  -> every exec tool call fails regardless of command content
```

Current DeepChat uses `chokidar` in two main-process Presenters:

- `src/main/presenter/workspacePresenter/index.ts`
  - content watcher for workspace file changes
  - git metadata watcher for `HEAD`, `index`, `packed-refs`, and `refs`
- `src/main/presenter/skillPresenter/index.ts`
  - skills directory watcher for `SKILL.md` hot reload

`@parcel/watcher` supports recursive directory subscriptions and uses FSEvents first on macOS,
which matches the root fix requested in the issue.

## Design Direction

Use the VS Code watcher model as the design reference:

- A watcher service owns native watcher lifecycle and exposes logical subscriptions to features.
- Watcher hosts run outside the Electron main process using Electron `utilityProcess`.
- Watch requests are pooled and deduplicated by root, scope, include/exclude rules, and fallback
  policy.
- Raw events are buffered, coalesced, and throttled before feature code receives them.
- Git metadata watching uses a dedicated watcher host lane so repository refresh pressure is
  isolated from content and skill hot reload.
- Large workspaces keep a degraded but functional mode through snapshot polling or lifecycle
  refresh when native watching fails or event pressure exceeds limits.

## Requirements

- Native file watching runs through a main-process `WatcherService` facade.
- `WorkspacePresenter` and `SkillPresenter` consume logical watcher subscriptions and do not
  import `@parcel/watcher` directly.
- The watcher service starts Electron utility process hosts for native watcher work.
- Workspace content and skill hot reload use the content watcher host.
- Git metadata uses a separate git watcher host or an independently restartable git watcher lane.
- Workspace content watching uses `@parcel/watcher` for recursive subscriptions in the watcher
  host.
- Workspace git metadata watching uses `@parcel/watcher` in the git watcher host and still emits
  git-only invalidations for `HEAD`, `index`, `packed-refs`, and `refs` changes.
- Workspace watcher lifecycle keeps the existing security boundary:
  `registerWorkspace` grants access; `watchWorkspace` owns watcher lifetime.
- Workspace watcher runtime ref counting remains intact across repeated panel mounts.
- Workspace file changes still publish `workspace.invalidated` with `kind: 'fs'`.
- Git metadata changes still publish `workspace.invalidated` with `kind: 'git'`.
- `.git` directory creation, deletion, or replacement still refreshes git watch metadata and
  publishes `workspace.invalidated` with `kind: 'full'`.
- Workspace content ignores preserve the existing ignored directory set:
  `node_modules`, `dist`, `build`, `__pycache__`, `.venv`, `venv`, `.idea`, `.vscode`,
  `.cache`, `coverage`, `.next`, `.nuxt`, `out`, and `.turbo`.
- Workspace content watcher ignores `.git` children while still observing the `.git` directory
  boundary itself.
- Skill hot reload still handles `SKILL.md` update, create, and delete events.
- Skill hot reload still ignores `.deepchat-meta`.
- Skill hot reload still respects `SKILL_CONFIG.FOLDER_TREE_MAX_DEPTH` at event handling time.
- Raw watcher events are buffered and coalesced before Presenter callbacks run.
- Event delivery is throttled with bounded memory so event floods degrade cleanly.
- Large workspace degradation emits `workspace.invalidated` with `source: 'fallback'` when native
  events are unavailable.
- A typed workspace watcher status event reports `healthy`, `degraded`, and `failed` states to the
  renderer for a small workspace-panel warning.
- Duplicate skill-name handling remains unchanged.
- `chokidar` is removed from runtime dependencies and lockfile entries.
- Native packaging includes the `@parcel/watcher` package and platform prebuilt packages.

## Acceptance Criteria

- On macOS, selecting a workspace with more than 100k files does not produce a sustained EMFILE
  storm from the workspace watcher.
- After selecting that large workspace, a simple agent exec command such as `mkdir -p test` can
  still spawn.
- Killing or crashing the watcher utility process does not terminate the main process.
- The watcher service restarts a failed watcher host and replays active watch requests.
- Native watcher failure with `EMFILE`, `ENOSPC`, or Parcel rescan errors enters degraded mode
  instead of repeated error storms.
- Workspace panel refresh behavior remains unchanged for:
  - create, update, and delete under the workspace
  - ignored directory changes
  - `.git` boundary changes
  - git `HEAD`, `index`, `packed-refs`, and `refs` updates
- Skills catalog refresh behavior remains unchanged for:
  - editing an existing `SKILL.md`
  - adding a new `SKILL.md`
  - deleting an existing `SKILL.md`
  - duplicate skill names
- Unit tests cover the watcher adapter, workspace watcher lifecycle, workspace event mapping, git
  metadata filtering, skill event mapping, and async subscription teardown.
- Unit tests cover watcher request pooling, event coalescing, host restart, and large workspace
  fallback state transitions.
- `pnpm run typecheck:node`, focused main-process tests, `pnpm run format`, `pnpm run i18n`,
  and `pnpm run lint` pass before implementation is considered complete.

## Constraints

- Keep existing `workspace.invalidated` and `skills.catalog.changed` event payloads unchanged.
- Add one typed watcher status event only for degraded/failure UI state.
- Keep workspace directory reading and file search lazy; this change targets live change
  detection only.
- Keep native dependency packaging explicit because Electron ASAR packaging can break `.node`
  modules when they remain inside `app.asar`.
- Keep exec utility error-copy improvements outside this increment after the fd-exhaustion root
  cause is removed.

## Review Decisions

- Recommended dependency version: `@parcel/watcher@^2.5.6`.
- Recommended implementation shape: a main-process `WatcherService` facade backed by Electron
  utility process watcher hosts.
- Recommended lifecycle change: model watcher startup and shutdown as async operations where the
  Presenter lifecycle already supports promises.
- Recommended isolation model: content/skill watcher host and git watcher host are independently
  restartable.
