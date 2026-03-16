# Workspace Lifecycle Plan

## Architecture

- `WorkspacePresenter` owns watcher runtimes keyed by `workspacePath`.
- Each runtime contains:
  - a recursive filesystem watcher for workspace content
  - a targeted Git metadata watcher for `HEAD`, `index`, `packed-refs`, and `refs`
  - a debounce buffer that emits one invalidation payload
- `registerWorkspace` remains the read-security boundary.
- `watchWorkspace` / `unwatchWorkspace` control watcher lifecycle separately from path registration.

## Event Contract

- Channel: `workspace:files-changed`
- Canonical constant: `WORKSPACE_EVENTS.INVALIDATED`
- Legacy alias: `WORKSPACE_EVENTS.FILES_CHANGED`
- Payload:

```ts
type WorkspaceInvalidationEvent = {
  workspacePath: string
  kind: 'fs' | 'git' | 'full'
  source: 'watcher' | 'fallback' | 'lifecycle'
}
```

## Renderer Refresh Flow

- Initial load and all invalidation refreshes use the same sync helper.
- `fs/full` refresh:
  - reload root tree
  - restore expanded directories
  - reload Git state
  - reload current preview and diff
  - clear stale selected file/diff state
- `git` refresh:
  - reload Git state
  - reload current diff
  - leave file tree and plain file preview untouched

## Test Strategy

- Main-process tests cover watcher ref counting, debounce behavior, Git invalidation emission, and destroy cleanup.
- Renderer tests cover watcher lifecycle, full-vs-git refresh routing, expanded directory restoration, and stale selection cleanup.
