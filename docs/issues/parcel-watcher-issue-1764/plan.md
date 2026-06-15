# Parcel Watcher Issue 1764 Plan

## Architecture

Add a main-process watcher facade backed by Electron utility process hosts:

```text
Renderer
  -> WorkspaceClient / existing typed events
  -> WorkspacePresenter / SkillPresenter
  -> WatcherService facade in Electron main
  -> WatcherHostClient
  -> Electron utilityProcess
  -> @parcel/watcher subscriptions
```

Recommended file layout:

```text
src/main/fileWatcherUtilityHostEntry.ts
src/main/lib/fileWatcher/
  eventCoalescer.ts
  watcherHost.ts
  watcherHostClient.ts
  watcherPool.ts
  watcherService.ts
  watcherTypes.ts
```

Responsibilities:

- `WatcherService` is the only watcher dependency injected into Presenters.
- `WatcherHostClient` owns utility process startup, restart, shutdown, and RPC correlation.
- `WatcherPool` deduplicates logical requests and reference-counts feature subscribers.
- `watcherHost` imports `@parcel/watcher` and owns native subscriptions.
- `eventCoalescer` maps `create | update | delete` into stable DeepChat watcher events and
  collapses create/delete/update bursts before they cross the process boundary.

The first implementation uses two independently restartable host instances:

```text
content watcher host
  -> workspace content
  -> skill hot reload

git watcher host
  -> git HEAD/index/packed-refs/refs metadata
```

This keeps native watcher fd usage and event storms outside the Electron main process. A watcher
host crash becomes a degraded watcher state, while the main process and the background exec utility
remain spawnable.

## VS Code-Inspired Rules

- Watcher and feature code stay decoupled through logical subscriptions.
- Identical watch requests share one native subscription.
- Parent recursive requests cover child requests when include/exclude rules allow it.
- Raw events are batched for 75 ms before coalescing.
- Batched events are delivered in chunks of at most 500, with 200 ms throttle delay.
- Buffered events cap at 30000 entries; overflow triggers degraded mode and one full refresh.
- Native watcher errors restart the host up to a small cap for transient failures.
- `EMFILE`, `ENOSPC`, and repeated Parcel rescan errors switch to fallback mode.
- Deleted watch roots suspend the native watcher and resume through polling or lifecycle refresh
  when the root returns.

## Dependency And Packaging

1. Add `@parcel/watcher@^2.5.6` to `dependencies`.
2. Remove `chokidar` from `dependencies`.
3. Refresh `pnpm-lock.yaml`.
4. Add ASAR unpack entries:

```yaml
asarUnpack:
  - '**/node_modules/@parcel/watcher/**/*'
  - '**/node_modules/@parcel/watcher-*/**/*'
```

5. Add `fileWatcherUtilityHost` to the Electron main build inputs.
6. Verify platform optional packages are present for macOS arm64, macOS x64, Windows x64/arm64,
   and Linux x64/arm64 release targets.
7. Add an `afterPack` guard when the unpacked package is absent in a packaged build.

## Watcher Service Contract

Use stable request and event types inside `src/main/lib/fileWatcher/watcherTypes.ts`:

```typescript
export type WatcherHostKind = 'content' | 'git'
export type WatcherEventType = 'create' | 'update' | 'delete' | 'overflow' | 'root-deleted'
export type WatcherMode = 'native' | 'snapshot-polling' | 'lifecycle'
export type WatcherHealth = 'healthy' | 'degraded' | 'failed'

export interface WatchRequest {
  id: string
  hostKind: WatcherHostKind
  rootPath: string
  recursive: boolean
  includes?: string[]
  excludes: string[]
  owner: 'workspace' | 'skill'
  purpose: 'workspace-content' | 'workspace-git' | 'skill-hot-reload'
  fallbackPolicy: 'snapshot-polling' | 'lifecycle'
}

export interface WatchEventBatch {
  requestId: string
  rootPath: string
  mode: WatcherMode
  events: Array<{ type: WatcherEventType; path: string }>
}
```

Presenter-facing API:

```typescript
watch(request: WatchRequest, listener: (batch: WatchEventBatch) => void): Promise<WatchHandle>
getStatus(requestId: string): WatcherHealth
```

`WatchHandle.close()` is async and idempotent.

## Event Flow

```text
@parcel/watcher raw batch
  -> normalize absolute path
  -> apply include/exclude filters
  -> buffer for 75 ms
  -> coalesce same-path changes
  -> drop child deletes covered by parent delete
  -> throttle chunks through host RPC
  -> WatcherService routes by request id
  -> Presenter maps to workspace/skill domain behavior
```

Workspace keeps the existing 120 ms invalidation debounce after the watcher service batch.
Skill hot reload keeps a per-path stability delay before parsing `SKILL.md`.

## Workspace Presenter Integration

Change watcher runtime state:

```text
WorkspaceWatchRuntime
  contentWatcher: WatchHandle | null
  gitWatcher: WatchHandle | null
  gitWatchKey: string | null
  debounceTimer: NodeJS.Timeout | null
  pendingKind: WorkspaceInvalidationKind | null
  pendingSource: WorkspaceInvalidationSource | null
```

Implementation flow:

1. Create the runtime with `contentWatcher: null`, store it in `watchRuntimes`, then await the
   watcher service subscription.
2. If the runtime is still current after the async subscription resolves, attach the handle.
3. If the runtime was disposed during startup, close the resolved handle immediately.
4. Keep ref counting unchanged.
5. Make `destroy()` await all runtime disposals and update the root Presenter shutdown path to
   await it.

Content watcher rules:

- Subscribe to the workspace root through the content watcher host.
- Use ignore globs for the existing ignored directories.
- Ignore `.git` children with `**/.git/**`.
- Preserve `.git` directory boundary events so `git init`, repo deletion, and worktree changes can
  trigger `refreshGitWatcher()` plus `kind: 'full'`.
- Map content events to `scheduleInvalidation(runtime, 'fs', 'watcher')`.
- Map watcher overflow, host restart, and snapshot polling batches to
  `scheduleInvalidation(runtime, 'full', 'fallback')`.

Git watcher rules:

- Extend `resolveGitWatchMetadata()` to return watch roots plus tracked metadata paths.
- Subscribe through the git watcher host.
- Watch the smallest stable directory root needed by Parcel, usually the `.git` root.
- Filter events to:
  - exact `HEAD`, `index`, and `packed-refs` paths
  - descendants of `refs`
- Emit `scheduleInvalidation(runtime, 'git', 'watcher')` for matching events.
- Rebuild git subscriptions when the metadata watch key changes.
- Use fallback polling of git metadata mtimes when the git watcher host is degraded.

## Large Workspace Fallback

Fallback is failure-driven and pressure-driven. The implementation avoids recursive preflight
counting.

Native mode:

```text
@parcel/watcher subscribe
  -> buffer 75 ms
  -> coalesce
  -> throttle
  -> feature listener
```

Fallback triggers:

- native subscribe returns `EMFILE`, `ENOSPC`, or Parcel rescan errors
- utility process exits repeatedly within the restart window
- event buffer reaches the max buffered event cap
- unsubscribe or restart cannot settle within the shutdown timeout

Fallback modes:

- `snapshot-polling`: use `@parcel/watcher.writeSnapshot()` and `getEventsSince()` from the
  watcher host on a 5000 ms interval for workspace content.
- `git-metadata-polling`: stat `HEAD`, `index`, `packed-refs`, and scan `refs` mtimes from the git
  watcher host on a 1000 ms interval.
- `lifecycle`: emit a full fallback invalidation when the workspace panel activates or the
  workspace path changes.

Degraded mode emits a typed status event:

```text
workspace.watch.status.changed
  workspacePath
  mode: native | snapshot-polling | lifecycle
  health: healthy | degraded | failed
  reason
```

WorkspacePanel warning layout:

```text
+------------------------------------------------------+
| Files                                                |
| ! Watching in fallback mode. Changes refresh slower. |
| tree...                                              |
+------------------------------------------------------+
```

## Skill Presenter Integration

Change skill watcher lifecycle to match async subscription semantics:

```text
watchSkillFiles(): Promise<void>
stopWatching(): Promise<void>
destroy(): Promise<void>
```

Update `ISkillPresenter` and `SkillPresenter.initialize()` accordingly.

Implementation flow:

1. Track a pending watcher start promise so repeated `watchSkillFiles()` calls during startup still
   create one subscription.
2. Subscribe to `skillsDir` through the content watcher host with ignore globs for
   `.deepchat-meta`.
3. Filter events by relative depth so paths deeper than `SKILL_CONFIG.FOLDER_TREE_MAX_DEPTH` are
   skipped.
4. Handle only events whose basename is `SKILL.md`.
5. Map Parcel event types:

```text
update -> current change handler
create -> current add handler
delete -> current unlink handler
```

6. Add a per-path stability delay for update/create events before parsing `SKILL.md`, using the
   existing `WATCHER_STABILITY_THRESHOLD` value.
7. Ensure `stopWatching()` and `destroy()` close a subscription that resolves after stop was
   requested.
8. Use lifecycle fallback for skill hot reload: log degraded mode, invalidate catalog on explicit
   install/uninstall/save flows, and keep startup discovery authoritative.

## Tests

Update mocks from `chokidar` to `WatcherService` or `WatcherHostClient`. Presenter tests should
mock `WatcherService` so native watcher mechanics stay out of feature tests.

Watcher infrastructure tests:

- pools identical watch requests and reference-counts subscribers
- keeps content and git hosts independently restartable
- coalesces create/update/delete bursts
- drops child delete events covered by a parent delete
- throttles batches and enters degraded mode on buffer overflow
- restarts utility process after transient errors and replays active requests
- switches to fallback for `EMFILE`, `ENOSPC`, and Parcel rescan errors
- closes pending and active subscriptions during stop/destroy

Workspace tests:

- starts one content subscription and one git subscription for a registered git workspace
- shares runtime by workspace and closes handles after final unwatch
- debounces create/update/delete events into one `fs` invalidation
- emits `git` invalidation only for tracked git metadata events
- refreshes git metadata and emits `full` invalidation for `.git` boundary events
- emits fallback invalidation when watcher status degrades
- ignores configured content directories

Skill tests:

- starts one subscription when called repeatedly
- maps `update` to metadata-updated behavior
- maps `create` to installed behavior
- maps `delete` to uninstalled behavior
- keeps duplicate skill-name behavior unchanged
- ignores `.deepchat-meta`
- skips events deeper than `FOLDER_TREE_MAX_DEPTH`
- closes pending and active subscriptions during stop/destroy

Renderer tests:

- shows the workspace watcher degraded banner when `workspace.watch.status.changed` reports
  degraded mode
- clears the banner when status returns to healthy

Verification commands:

```bash
pnpm run typecheck:node
pnpm test -- \
  test/main/lib/fileWatcher \
  test/main/presenter/workspacePresenter.test.ts \
  test/main/presenter/skillPresenter/skillPresenter.test.ts
pnpm test -- test/renderer/components/WorkspacePanel.test.ts
pnpm run format
pnpm run i18n
pnpm run lint
```

## Risks

- Utility process host packaging:
  Add build input, ASAR unpack rules, and packaged build guard.
- Native module unavailable in packaged app:
  Verify platform optional packages on each release target.
- Parcel emits directory events differently from chokidar:
  Filter by normalized absolute path and basename, then preserve behavior in tests.
- Async subscription resolves after stop/destroy:
  Track pending startup and close late handles immediately.
- `@parcel/watcher` lacks `awaitWriteFinish`:
  Keep workspace debounce and add skill parse stability delay.
- Git worktree paths span multiple directories:
  Compute watch roots from resolved git metadata paths and filter tracked paths after events arrive.
