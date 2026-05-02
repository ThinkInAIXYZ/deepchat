# Workspace Lifecycle

## Summary

Workspace sidepanel state should refresh through a single invalidation pipeline instead of ad-hoc reloads. The main process owns invalidation production, and the renderer owns refresh execution.

## User Stories

- As a user, when files are created, edited, moved, or removed in the current workspace, the file tree should refresh without manual action.
- As a user, when Git metadata changes without a file content change, the Git section should still refresh.
- As a maintainer, I need one clear contract for workspace invalidation so future features do not add more bespoke refresh paths.

## Acceptance Criteria

- Workspace content changes emit a typed invalidation event with `kind: 'fs'`.
- Git metadata changes emit a typed invalidation event with `kind: 'git'`.
- Renderer refreshes file tree, Git state, preview, and diff through one shared sync path.
- Expanded directories stay expanded after a full refresh when the directory still exists.
- Stale selected file and diff state are cleared when the backing file or Git change disappears.
- Read-only filesystem operations do not emit workspace invalidation events.

## Non-Goals

- Artifact refresh is not part of workspace invalidation.
- Hidden file visibility rules are unchanged.
- Watchers are not promoted to a global always-on workspace service.
