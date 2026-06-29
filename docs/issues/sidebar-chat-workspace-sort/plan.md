# Sidebar Chat Workspace Sort Plan

## Approach

- Keep using `sessionStore.groupMode` as the Workspace grouping mode.
- In `WindowSideBar.vue`, flatten the already filtered non-pinned sessions, split them by project
  path into Chat and Workspace, then render each section separately.
- Make the Chat section header use the existing collapsed group set.
- Use the same chat icon name as the new-thread project selector for the Chat section header.
- Update existing sidebar tests for Chat collapse and date-mode Workspace scoping.

## Affected Files

- `src/renderer/src/components/WindowSideBar.vue`
- `test/renderer/components/WindowSideBar.test.ts`

## Test Strategy

- Run the targeted WindowSideBar test file.
- Run project formatting, i18n, and lint checks required by repository instructions.
