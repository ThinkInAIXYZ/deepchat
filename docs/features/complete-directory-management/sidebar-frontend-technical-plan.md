# Sidebar Frontend Technical Plan

This document scopes the main-window sidebar reorder work for project-directory groups. It is more
detailed than the product plan because this area combines scroll pagination, grouped rendering,
collapse state, search filtering, active-session behavior, keyboard shortcuts, and pin animations.

## Current Sidebar Facts

- `WindowSideBar.vue` currently uses a normal scroll container:
  - `.session-list`
  - `@scroll.passive="handleSessionListScroll"`
  - `requestAnimationFrame` throttling through `sessionListScrollFrame`
- It is not currently rendered through `vue-virtual-scroller`, but it behaves like a scroll window:
  - pages are loaded lazily through `sessionStore.loadNextPage()`;
  - `ensureSessionListFilled()` keeps fetching while the viewport is not filled;
  - layout height changes can trigger extra pagination.
- Sidebar modes:
  - `groupMode === 'time'`: date buckets; directory reorder must be disabled.
  - `groupMode === 'project'`: directory groups; reorder can be enabled.
- Pinned sessions are a separate section and must not participate in directory ordering.
- `No project` is a synthetic group, not a directory. It should not be persisted as an environment
  preference.
- Search is applied after grouping by filtering sessions and dropping empty groups.
- Agent selection also filters visible sessions/groups.
- Group collapse state is keyed by group id in `collapsedGroupIds`.
- Active-session watchers auto-expand the active session's group.
- Pin/unpin uses a clone animation, placeholder state, and scroll restoration:
  - `pinFlightSessionId`
  - `pinDockedSessionId`
  - `restoreSessionListScroll()`
- Shortcut badges are derived from the first visible sessions after group expansion and filtering.

## Reorder Scope

Enable group reordering only when all of these are true:

```text
sidebar expanded
groupMode == project
sessionSearchQuery is empty
no group drag is already active
no pin flight animation is active
not loading the first page
```

Pinned section and sessions inside groups are not draggable. Directory reorder moves group blocks only.
There is no separate drag affordance icon. The folder icon/name area is the drag target, matching
normal folder management expectations.
Sessions inside a group keep the current `updatedAt DESC` behavior.

Recommended v1 behavior:

- Real active directory groups are draggable.
- Archived directory groups, if still shown for session discoverability, render after active directory
  groups and are not draggable until restored.
- `No project` renders as a fixed non-draggable group after real directory groups.
- Time groups never expose a folder drag target.

## DOM Structure Rule

Do not keep the whole project group header as one broad interactive `<button>` after adding reorder.
The current header is a button because it only toggles collapse. Reorder needs an explicit folder
identity control without adding a separate drag affordance:

```text
group-row
  folder-identity-target -> folder icon/name; drag to reorder; click below threshold toggles collapse
  more-menu-button       -> keyboard/accessibility move actions
group-sessions
  WindowSideBarSessionItem...
```

The folder identity target must use a small movement threshold. Pointer movement above the threshold
starts reorder and suppresses the following click. Pointer up below the threshold keeps the familiar
click-to-expand/collapse behavior.

## Drag Implementation Options

Preferred for the current non-virtualized sidebar:

- Wrap only project group blocks in `vuedraggable`.
- Use `item-key` = group id/path.
- Use a handle selector that targets the folder icon/name area, not the whole row and not a separate
  drag affordance.
- On drag start:
  - set `isProjectGroupDragging = true`;
  - capture `scrollTop`;
  - freeze shortcut badges;
  - pause scroll auto-fill and load-more checks;
  - suppress collapse auto-expansion caused by active-session watcher.
- On drag end:
  - compute ordered real active directory paths;
  - persist through `project.reorderEnvironments`;
  - restore captured `scrollTop` after `nextTick`;
  - re-enable pagination checks;
  - run one `ensureSessionListFilled()` pass after layout settles.
- On drag cancel/error:
  - rollback local order;
  - restore `scrollTop`;
  - clear drag state.

If the sidebar is later migrated to a true virtual scroller:

- Do not derive the new order from DOM indexes; use group ids from the model.
- Do not wrap recycled virtual rows directly with SortableJS.
- Keep DnD at the project-group model layer, or use a lightweight reorder overlay that renders group
  headers only.
- Never include virtualized session rows inside a draggable item if their DOM can be recycled during
  pointer movement.

## Filtering And Merge Rules

Search:

- Disable drag while `sessionSearchQuery.trim()` is non-empty.
- Reason: search removes groups dynamically as the query changes, so the visual subset is too
  transient to be a reliable global order source.

Agent filter:

- Agent-filtered project mode can remain reorderable if implementation uses a visible-subset merge.
- Merge algorithm:
  1. Start from the full persisted active directory order.
  2. Find the visible draggable path subset.
  3. Replace only that subset's relative order with the new visible order.
  4. Keep hidden paths in their previous relative positions.
- If this feels confusing during implementation, disable drag when `sidebarSelectedAgentId !== null`
  for v1 and keep menu move actions available from Settings only.

Collapsed groups:

- Collapsed and expanded groups both participate in ordering.
- Dragging a collapsed group moves only the header visually; dragging an expanded group moves the
  whole group block.
- Collapse state remains keyed by group id and must survive reorder.

## Event Conflict Matrix

| Event/state | Risk | Required handling |
| --- | --- | --- |
| Folder identity click | Drag end can also emit click and collapse the group | Use a movement threshold and suppress click after drag |
| Scroll near bottom | Sortable movement changes height and can trigger pagination | Pause `handleSessionListScroll` and `ensureSessionListFilled` while dragging |
| Auto-fill watcher | It may load pages during drag because height changes | Gate `ensureSessionListFilled()` behind `!isProjectGroupDragging` |
| Pin flight animation | It clones rows and restores scroll while reorder moves groups | Disable group drag while `pinFlightSessionId` or `pinDockedSessionId` is set |
| Pin toggle during drag | Session rows can move while group order is unstable | Ignore or disable pin controls while `isProjectGroupDragging` |
| Active session changed | Watcher may auto-expand a group during drag | Queue expansion until after drop, or skip expansion while dragging |
| Group mode toggle | Switching to time mode mid-drag invalidates the model | Disable group-mode toggle while dragging, or cancel drag first |
| Search input | Search removes groups during drag | Disable drag when search is non-empty; cancel active drag if search starts |
| Sidebar collapse | Collapsing removes the visible drag surface | Cancel drag before collapse, or disable collapse while dragging |
| Agent filter | Reorder may operate on a subset | Use visible-subset merge or disable drag under agent filter |
| Shortcut badges | Badges are based on visible session order | Freeze or hide badges while dragging; recompute after drop |
| Load-more response | New groups can appear after reorder starts | Ignore new page groups for active drag; merge them after drop by persisted order fallback |
| Reduced motion | Drag feedback should not rely on motion only | Keep static ghost/placeholder styling; animation can be reduced |

## Ordering Model

Use one canonical order source:

```text
new_environment_preferences.sort_order
```

Sidebar local order is a projection:

```text
active real directories by persisted sort_order
visible archived directories, read-only
No project synthetic group, fixed
```

When the sidebar receives sessions for a directory that has no preference row yet, place that group
by fallback order until the user explicitly reorders:

```text
default directory first
explicit sort_order
lastUsedAt desc if known
path asc
```

## Performance Guardrails

- Do not recompute grouped session arrays from scratch inside pointer-move handlers.
- Do not call persistence APIs during drag movement; persist only on drop/menu action.
- Keep row heights stable during drag; avoid hiding session children dynamically unless using a
  deliberate lightweight reorder mode.
- Keep drag ghost styling simple: opacity, border, background. Avoid expensive shadows/filters.
- Preserve `scrollTop` around reorder commits.
- Do not trigger `loadNextPage()` while dragging.
- If a group contains many rendered sessions and drag becomes janky, fallback to a lightweight
  reorder mode for sidebar:

```text
Project order mode
+----------------------------------+
| folder  app                12    |
| folder  old-client          2    |
| folder  mobile              9    |
+----------------------------------+
Done
```

This mode renders group headers only and commits the same path order.

## Accessibility And Keyboard

- More menu on every draggable group must expose:
  - move up;
  - move down;
  - move to top;
  - move to bottom.
- The folder identity drag target must have an accessible name that includes the group label.
- Because the folder identity itself is the pointer drag target, keyboard movement through the More
  menu is required, not optional.
- Movement actions announce success through existing toast/status patterns if available.
- Keyboard move actions use the same reorder persistence path as pointer drag.

## Test Matrix

Unit/store tests:

- Project group order follows environment preferences.
- No Project group is fixed and not persisted.
- Archived groups are read-only in sidebar order.
- Visible-subset merge preserves hidden group relative order, if agent-filter drag is enabled.
- Sessions inside each project group remain sorted by recent update.

Component tests:

- Folder identity drag target is enabled only in project mode.
- Folder identity drag target is disabled in time mode.
- Folder identity drag target is disabled while search is non-empty.
- Folder identity drag target is disabled while pin flight state is active.
- Group collapse button still works when not dragging.
- Folder identity click toggles collapse when pointer movement stays below threshold.
- Folder identity drag does not toggle collapse after drop.
- Reorder calls the project store once on drop.
- Reorder preserves collapsed group ids.
- Reorder preserves scrollTop.
- `loadNextPage()` is not called during active drag.
- Auto-fill runs again after drag completes when viewport is not filled.

Visual/browser QA:

- Long sidebar with many groups and expanded sessions.
- Narrow sidebar width.
- All agents and single-agent filters.
- Project mode and time mode toggle.
- Search active and cleared.
- Pinned section present and absent.
- Active session inside moved group.
- Reduced motion enabled.
