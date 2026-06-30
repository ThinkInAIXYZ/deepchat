# Sidebar Section New Chat Actions - Plan

## Fix Strategy

Reuse the existing sidebar new-chat handler after setting `projectStore.selectedProject` to the workspace implied by the clicked row.

This keeps the change local to the sidebar and avoids adding route query state.

## Affected Files

- `src/renderer/src/components/WindowSideBar.vue`
- `test/renderer/components/WindowSideBar.test.ts`

## Implementation Plan

1. Remove the Chat section leading icon markup and the now-unused icon constant.
2. Make the Chat row background include the action area and place the Chat `+` inside the row.
3. Add a small helper that selects a project path, then calls the existing new-chat handler.
4. Use the default Chat workspace path for the Chat `+`, falling back to explicit no-project chat when unavailable.
5. Add Project folder `+` buttons before the existing `...` button only for project directory groups.
6. Add click isolation on `+` buttons so they do not toggle their section.
7. Update the sidebar component test to assert no leading Chat icon, preserved collapse behavior, workspace selection, and no Project `+` in time grouping.

## Test Strategy

1. Run `pnpm vitest run test/renderer/components/WindowSideBar.test.ts`.
2. Run `pnpm run format`.
3. Run `pnpm run i18n`.
4. Run `pnpm run lint`.
5. Run `pnpm run typecheck`.
