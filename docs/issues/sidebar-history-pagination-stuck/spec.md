# Sidebar history pagination remains stuck

## User need

Users with many persisted conversations must be able to browse and search older conversations from the sidebar. The database can contain complete history, but the sidebar currently exposes only the already-loaded subset when pagination does not continue.

## Problem statement

Issue [#1762](https://github.com/ThinkInAIXYZ/deepchat/issues/1762) reports that historical conversations cannot be loaded even though the database is complete. A prior fix added viewport auto-fill for the case where the first regular-session page does not create a scrollbar. The problem still appears to persist when sidebar height, project/date grouping, collapsed groups, and the All agents view affect the rendered list height and scrollability.

Current behavior to re-check:

- Sidebar pulls lightweight conversation pages from SQLite.
- Renderer appends pages only when the sidebar scroll container reaches the bottom or auto-fill decides the rendered viewport is not filled.
- Grouping and collapsed groups can make the rendered content much shorter than the loaded data set.
- All agents is a UI-level filter over already-loaded sessions, not an independent complete fetch scope.
- Search is currently local to loaded sidebar sessions, so older database rows cannot be found until pagination reaches them.
- Runtime comparison showed DB had 52 regular non-draft sessions while the renderer stayed at 30 with `hasMore=true`; `loadNextPage()` failed because Pinia's reactive cursor proxy could not be cloned over IPC.

## Goals

1. Ensure sidebar pagination continues until the user can reach older regular conversations.
2. Make bottom loading robust when rendered height changes because of grouping, collapsed groups, pinning, All agents/agent filter changes, and search filtering.
3. Keep All agents capable of eventually loading the complete regular-session history rather than stopping at the visible subset.
4. Preserve the existing lightweight-session paging API and avoid loading message bodies for sidebar browsing.

## Acceptance criteria

- Initial sidebar load continues fetching when visible content does not overflow the list container and `hasMore` remains true.
- Toggling group mode, expanding/collapsing groups, switching All agents vs a specific agent, changing search text, pinning/unpinning, or resizing the sidebar re-runs the pagination fill check.
- Scrolling near the bottom still requests the next page exactly once per pending page and keeps using the current cursor.
- All agents view does not become stuck with `hasMore=true` and no further page requests when visible groups are shorter than the viewport.
- Tests cover the stuck cases caused by collapsed/filtered/grouped visible content, not only the first-page-no-scroll case.

## Constraints

- Sidebar list should keep using lightweight session records only.
- Subagent sessions must not consume visible sidebar page slots unless explicitly requested elsewhere.
- Do not introduce unbounded eager loading; keep guardrails against cursor stalls or repeated empty pages.
- Avoid changing database schema for this issue.

## Non-goals

- Full global message search redesign.
- Reworking project group ordering UX.
- Changing how conversations are stored.

## Open questions

None for implementation. The intended behavior is: sidebar pagination should be driven by the rendered visible list and user filter changes, and should continue safely while `hasMore` is true and the viewport/bottom condition requires more rows.
