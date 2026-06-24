# Plan

## Current data flow

1. Renderer calls `sessionClient.listLightweight({ limit: 30, cursor, includeSubagents: false })` from the session store.
2. Main presenter delegates to `NewSessionManager.listPage` and SQLite `new_sessions` cursor pagination ordered by `updated_at DESC, id DESC`.
3. Store maps rows to `UISession`, merges pages, and exposes `sessions`, `hasMore`, and `nextCursor`.
4. `WindowSideBar.vue` derives pinned sessions and grouped sessions from the loaded `sessions` array, then applies agent filter and local title search.
5. Pagination is triggered by scroll-near-bottom and by an auto-fill loop for non-overflowing content.

## Failure modes

- The existing auto-fill watcher observes raw session count, `hasMore`, loading state, and selected agent, but not all rendered-height inputs. Group mode changes, collapsed/expanded groups, search text, pinned collapse, and project metadata ordering can drastically alter visible height without changing `sessions.length`.
- The scroll check only runs on actual scroll events. If content shrinks below the viewport after grouping/filtering, no scroll event fires.
- Agent filtering is applied after the global page is fetched. A specific agent or All agents visible state may be too short even while the global cursor has more rows.
- The current loop stops when `sessions.length` does not increase. If the fetched page is deduped because of prioritized sessions or cursor overlap, it can stop even while `hasMore` remains true.
- Confirmed runtime root cause: `nextCursor.value` is a Pinia/Vue reactive object. Passing it directly through the IPC bridge for `sessionClient.listLightweight()` can fail structured clone with `An object could not be cloned`, leaving the renderer at the first 30 rows while `hasMore` remains true.

## Implementation approach

1. Extend `WindowSideBar.vue` pagination fill triggers to observe rendered list drivers:
   - `filteredGroups` shape / visible session ids
   - `pinnedSessions` ids
   - `collapsedGroupIds` and pinned section collapsed state
   - `sessionStore.groupMode`
   - `normalizedSessionSearchQuery`
   - sidebar collapsed state
2. Add a `ResizeObserver` on the session list container so height changes re-run the fill check.
3. After group expand/collapse and pinned expand/collapse, schedule a post-render fill check.
4. Harden `ensureSessionListFilled`:
   - keep the max-round guard
   - stop on missing cursor, no `hasMore`, active loading, drag, collapsed sidebar, or errors
   - treat `hasMore`/cursor progress as the primary signal, not only `sessions.length`
5. Clone the pagination cursor into a plain object before sending it over IPC so Vue/Pinia proxies do not hit structured clone errors.
6. Keep backend pagination unchanged unless tests reveal cursor/filtering bugs.

## Affected files

- `src/renderer/src/components/WindowSideBar.vue`
- `test/renderer/components/WindowSideBar.test.ts`
- Potentially `src/renderer/src/stores/ui/session.ts` and store tests if cursor/dedupe behavior needs a small guard.

## Test strategy

- Add/adjust renderer component tests for:
  - auto-fill after a group collapses and visible content no longer fills the viewport
  - auto-fill after switching to All agents or an agent filter with too few visible items
  - auto-fill after search filters the visible list down while more pages exist
  - no extra fetch when `hasMore` is false or a page is already loading
- Keep existing store tests for `includeSubagents: false` and cursor propagation.

## Validation

Run at minimum:

- `pnpm vitest run test/renderer/components/WindowSideBar.test.ts`
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
