# Plan

## Implementation approach

Update `WindowSideBar.vue` so the existing `handleAgentSelect` path expands the shared sidebar store when invoked from a collapsed state. Keep the current Agent switch queue, active-session close, and selected-Agent toggle behavior intact.

## Affected interfaces

- Renderer component: `src/renderer/src/components/WindowSideBar.vue`
- Shared sidebar store API already has `setCollapsed(value: boolean)` and needs no interface changes.
- Component tests: `test/renderer/components/WindowSideBar.test.ts`

## Data flow

1. User clicks All Agents or Agent button in the left rail.
2. `handleAgentSelect(id)` runs.
3. If `collapsed` is true, call `sidebarStore.setCollapsed(false)`.
4. Continue the existing queued Agent selection pipeline:
   - derive current/next Agent id;
   - close active session if needed;
   - set selected Agent if the request is still current.
5. The now-visible session column renders sessions filtered by `sidebarSelectedAgentId`.

## Compatibility

- Existing expanded-sidebar behavior is unchanged because `setCollapsed(false)` is only called when the sidebar is collapsed.
- Existing Agent toggle semantics remain unchanged.
- No migration or persistence changes.

## Test strategy

- Add a component test that starts the sidebar in collapsed mode, clicks an Agent button, and verifies:
  - `setCollapsed(false)` was called;
  - the sidebar expands to the full width class;
  - the existing Agent selection action still runs.
- Run the targeted WindowSideBar test suite, then repository-required format/i18n/lint checks.
