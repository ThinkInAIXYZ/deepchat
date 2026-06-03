# Implementation Plan — Sidebar Chat Number Shortcuts

## Touch Points

### Sidebar container — `src/renderer/src/components/WindowSideBar.vue`

- Compute a `numberedShortcutSessions` array from the same renderer state used by the visible list:
  `pinnedSessions` when expanded, followed by each non-collapsed `filteredGroups[].sessions`.
- Limit numbering to the first 10 sessions and map row indexes to shortcut labels:
  `1..9`, then `0`.
- Register window-level `keydown` / `keyup` listeners while the sidebar is mounted.
- Detect platform with existing renderer device information, preferring `useDeviceVersion()` or the
  same `createDeviceClient().getDeviceInfo()` source used by existing components.
- On macOS, handle `event.metaKey`; on Windows/Linux, handle `event.altKey`.
- Start a 0.5 second timer when the platform modifier is pressed by itself.
- Show `showShortcutBadges` when the timer completes and the modifier is still down.
- Clear the timer and hide badges on modifier release, blur, visibility change, unmount, or sidebar
  collapse.
- Ignore shortcut handling when focus is inside editable UI or when modal/overlay focus owns the
  keyboard.
- On number shortcut, recompute the current mapping synchronously and call
  `sessionStore.selectSession(target.id)` when a target exists.

### Sidebar item — `src/renderer/src/components/WindowSideBarSessionItem.vue`

- Add optional props:
  - `shortcutBadgeLabel?: string | null`
  - `shortcutBadgeVisible?: boolean`
- Render the badge inside the existing `.right-button` area.
- When the badge is visible, hide/disable the delete button in that same area so the badge covers
  the hover delete affordance.
- Keep badge visibility controlled only by the explicit `shortcutBadgeVisible` prop. Do not make
  shortcut badges appear through `.session-item:hover`, `group-hover`, or `focus-within` selectors.
- Keep the existing hover delete trigger intact for the normal state; the long-press overlay should
  replace what is rendered in the right slot, not alter the row's hover state machine.
- Add ARIA/tooltip text using i18n, e.g. "Switch to this chat with {shortcut}".
- Keep row width stable; the badge must not shift the chat title or resize the row.

### i18n — `src/renderer/src/i18n/*/thread.json`

- Add labels under `thread.actions` or a sidebar-oriented namespace:
  - `switchWithShortcut`
  - `shortcutBadge`
- Include at least English and Chinese source strings in the implementation increment, then run
  `pnpm run i18n` to synchronize locale files according to the repository workflow.

### Tests

- Add renderer unit coverage near the sidebar tests. If no direct sidebar suite exists, add
  `test/renderer/components/WindowSideBar*.test.ts` with Vue Test Utils.
- Cover visible-row mapping:
  - pinned expanded rows before grouped rows;
  - collapsed pinned/group sections excluded;
  - search-filtered rows excluded;
  - `0` maps to the tenth row.
- Cover keyboard behavior:
  - macOS uses `metaKey`;
  - Windows/Linux uses `altKey`;
  - missing index does nothing;
  - editable focused elements suppress switching.
- Cover long-press behavior with fake timers:
  - badges show after 0.5 seconds;
  - badges hide on modifier release;
  - delete button is not rendered/clickable while the badge is visible.
- Cover hover separation:
  - hovering a row without long-press does not render a shortcut badge;
  - long-press renders badges even when no row is hovered;
  - after long-press ends, hover delete behavior still works.

## Shortcut Mapping

The mapping is intentionally not stored. It is derived from current computed values each time:

```text
visibleShortcutRows =
  expanded pinned sessions
  + expanded grouped sessions in rendered group order

keys:
  1 -> visibleShortcutRows[0]
  2 -> visibleShortcutRows[1]
  ...
  9 -> visibleShortcutRows[8]
  0 -> visibleShortcutRows[9]
```

This keeps behavior aligned with sidebar search, agent filtering, lazy-loaded sessions, group
collapse state, and pin/unpin changes.

## Decisions

- **Renderer-only shortcut.** The feature depends on current sidebar presentation state, so global
  Electron accelerators or main-process presenters would be the wrong source of truth.
- **Visible rows only.** Group headers are not selectable chats, and collapsed/filtered/unloaded
  sessions are not part of the user's current visual list.
- **`0` means tenth.** This matches common numbered shortcut conventions and keeps the first ten rows
  addressable.
- **Badges replace delete affordance.** The screenshot shows the shortcut label in the right-side
  action slot; using the existing delete slot avoids adding another competing control.
- **Hover and shortcut states stay separate.** Hover remains responsible for delete affordance
  visibility; modifier long-press is the only trigger for shortcut badge visibility.
- **No settings surface in first increment.** The requested shortcut is fixed and discoverable via
  long-press, keeping the change small.

## Event Flow

```text
Window keydown
  -> detect platform modifier
  -> if modifier-only, start 0.5s badge timer
  -> if modifier+digit, recompute visibleShortcutRows
  -> select target session through sessionStore.selectSession()

Window keyup / blur / visibility hidden / unmount
  -> cancel badge timer
  -> hide badges
```

## Compatibility

- Existing session activation, route updates, message clearing, and selected agent sync remain
  delegated to `sessionStore.selectSession()`.
- Existing pin/unpin animation and delete dialog behavior are unchanged.
- The shortcut should not conflict with `Command+F` chat search because it listens only for digits.
- The long-press overlay should respect reduced-motion preferences by avoiding nonessential
  animation.

## Risks And Mitigations

- **Alt conflicts on Windows/Linux:** handle only `Alt+digit` and modifier-only hold. Avoid
  preventing default for unrelated Alt combinations.
- **Input focus conflicts:** suppress the shortcut in editable elements and active overlays.
- **Stale timer state:** clear timers on keyup, blur, visibility change, unmount, and sidebar
  collapse.
- **Layout regression:** keep badge rendering inside the current right action slot and verify desktop
  plus narrow sidebar widths.

## Validation

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- Targeted renderer tests for the sidebar shortcut behavior
- Manual check on macOS and Windows/Linux-equivalent platform mocks:
  - press `Command+2` / `Alt+2`;
  - hold modifier for 0.5 seconds;
  - search/filter/collapse, then verify badge numbers recalculate.
