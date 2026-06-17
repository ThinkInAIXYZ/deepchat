# Tasks

- [x] Inspect current workspace file list and preview rendering flow.
- [x] Create SDD artifacts for the single-file viewer flow.
  - [x] `WorkspacePanel.vue` includes Git diff selections in the single-item viewer flow while keeping Artifact selections in list mode.
  - [x] `useWorkspaceSync.ts` refreshes existing file trees in the background without flashing the initial loading state.
- [x] Update `WorkspaceViewer.vue` with a back control for single-file mode.
- [x] Fix the single-item mode condition so file/Git selections hide the workspace list while Artifact selections keep it visible.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
- [x] Run focused renderer tests for `WorkspacePanel` and `WorkspaceViewer`.
