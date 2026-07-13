# Workspace Single File Viewer

## User Need

When the main window already has multiple sidebars expanded, opening workspace file preview currently shows the file tree/list and the preview at the same time. This consumes too much horizontal space.

## Goal

Switch workspace file selection into a single-file viewing flow: after choosing a file from the workspace file list, the file viewer should replace the list instead of appearing beside it. Users can go back to the workspace list when they want to choose another file.

## Acceptance Criteria

- Selecting a file in the workspace file tree shows the file preview/code/info viewer as the primary workspace content.
- Selecting a Git change shows the diff viewer as the primary workspace content, matching the file viewer flow.
- While a file or Git diff is being viewed, the workspace list/navigation is not displayed alongside the viewer.
- A visible back control returns from the file/diff viewer to the workspace list without clearing unrelated selection state.
- Reopening the workspace panel with an existing file tree refreshes in the background without flashing the initial “loading files” state.
- Artifact selections continue to preserve the workspace list unless they are later explicitly included in the same single-item viewer flow.
- Existing fullscreen/open-in-system-file controls remain available in the viewer.

## Constraints

- Keep the change in the renderer workspace side panel and reuse existing workspace state/store patterns.
- Use Vue 3 Composition API and existing i18n keys where possible.
- Avoid adding new persisted state unless the single-view/list-view mode cannot be derived from existing selection state.

## Non-goals

- Redesigning the entire side panel width model.
- Changing workspace file loading, preview parsing, or filesystem APIs.
- Changing chat input attachment behavior.

## Open Questions

None.
