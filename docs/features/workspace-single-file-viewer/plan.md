# Plan

## Current Behavior

`WorkspacePanel.vue` renders a fixed workspace navigation/list `<aside>` next to `WorkspaceViewer.vue`. Clicking a file calls `sidepanelStore.selectFile(...)`, which sets `selectedFilePath`; `useWorkspaceSync` loads `selectedFilePreview`; the viewer then renders preview/code/info beside the list.

## Approach

- Derive a single-item view state in `WorkspacePanel.vue` from the current session selection:
  - File selected means single-file viewer mode.
  - Git diff selected uses the same single-item viewer/return flow as files.
  - Artifact selection keeps the workspace list visible, matching the existing resource browsing behavior.
- Render the nav/list `<aside>` only when file or Git diff single-item mode is inactive.
- Let `WorkspaceViewer.vue` expose a back action when it is embedded in single-item workspace mode.
- Back action clears the active file or Git diff selection and returns to the list/navigation.
- Keep fullscreen toggle and open-file controls in the existing viewer header.
- Avoid repeated initial loading flashes by showing `loadingFiles` only when no cached file tree exists; reopening can still refresh in the background.

## Affected Interfaces

- `WorkspacePanel.vue`
  - Conditional nav rendering.
  - Handle viewer back event and clear selected file/diff/artifact.
  - Pass a prop to `WorkspaceViewer` to show back control.
- `useWorkspaceSync.ts`
  - Background refreshes reuse the existing file tree without showing the initial loading state when cached data is present.

No main process or shared contract changes are required.

## Compatibility

- Existing persisted side panel width and nav width remain unchanged.
- Existing selected file/diff/artifact state remains compatible; back only clears active selection.
- When no item is selected, the workspace list behaves as before.

## Test Strategy

- Run project formatting and lint/i18n checks required by repository guidelines:
  - `pnpm run format`
  - `pnpm run i18n`
  - `pnpm run lint`
- If time permits, inspect the modified components for type errors introduced by props/emits changes.
