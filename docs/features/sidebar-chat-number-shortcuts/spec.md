# Sidebar Chat Number Shortcuts

## User Need

Users with many chats in the left sidebar need a fast way to switch between the currently visible
chat rows without moving the pointer. The shortcut should be discoverable in the same place where
the action will happen, so users can learn the mapping while looking at the sidebar.

## Goal

Add renderer-local number shortcuts for the current left sidebar chat list:

- macOS: `Command+1` through `Command+9`, plus `Command+0`.
- Windows/Linux: `Alt+1` through `Alt+9`, plus `Alt+0`.
- `1` maps to the first currently displayed chat row, `2` to the second, and so on.
- `0` maps to the tenth currently displayed chat row.
- The mapping is recalculated from the current renderer state every time the shortcut is pressed.
- Holding the platform modifier for 0.5 seconds shows shortcut badges on the first ten displayed chat
  rows, matching the provided screenshot style.

## Acceptance Criteria

1. Pressing `Command+N` on macOS or `Alt+N` on Windows/Linux selects the Nth chat in the left
   sidebar's current displayed order.
2. `N=1..9` selects rows 1 through 9; `N=0` selects row 10.
3. The displayed order is derived only from the renderer's current sidebar state:
   - pinned chats first when the pinned section is expanded;
   - grouped chats in the same order as `filteredGroups`;
   - collapsed sections, filtered-out search results, empty group headers, and unloaded pages are
     excluded;
   - hidden pin-flight placeholders are excluded.
4. Shortcut selection calls the existing `sessionStore.selectSession(session.id)` path and does not
   add main-process IPC or persisted shortcut settings.
5. If the requested index has no current chat row, the shortcut is ignored without UI noise.
6. The shortcut handler does not fire while typing in inputs, textareas, contenteditable editors, or
   active command/search overlays.
7. Holding only the platform modifier for 0.5 seconds shows number badges for at most ten displayed
   chat rows. Releasing the modifier hides them immediately.
8. While the badge overlay is visible, it occupies the same right-side area as the hover delete
   button so the delete button is visually covered and cannot be clicked.
9. Badge visibility is independent from row hover/focus state:
   - hovering a row never starts or reveals shortcut badges;
   - long-pressing the platform modifier never forces the row into its hover visual state;
   - when badges are hidden, existing hover delete behavior remains unchanged.
10. The overlay labels use `⌘1..⌘9`, `⌘0` on macOS and `Alt+1..Alt+9`, `Alt+0` on Windows/Linux.
11. The overlay updates from current renderer state when sidebar search, agent filter, pinned state,
    collapse state, or session list data changes.
12. The sidebar collapsed state does not expose hidden chat shortcuts. If the sidebar is collapsed,
    shortcut switching and badge rendering are disabled.
13. All user-facing tooltip/ARIA text uses vue-i18n keys.

## ASCII UI

Default row, no hover:

```text
+------------------------------------------------+
|  [pin space]  Chat title text              ... |
+------------------------------------------------+
```

Hover row before this feature:

```text
+------------------------------------------------+
|  [pin]       Chat title text              [del]|
+------------------------------------------------+
```

Modifier held for 0.5 seconds:

```text
+------------------------------------------------+
|  [pin]       Chat title text              [⌘1] |
|  [pin]       Another title                [⌘2] |
|  [pin]       Third title                  [⌘3] |
|  ...                                           |
|  [pin]       Tenth title                  [⌘0] |
+------------------------------------------------+
```

Windows/Linux badge labels:

```text
+------------------------------------------------+
|  [pin]       Chat title text             [Alt+1]|
|  [pin]       Another title               [Alt+2]|
+------------------------------------------------+
```

Collapsed and filtered rows do not receive numbers:

```text
+------------------------------------------------+
|  Pinned                                [closed]|
|  Today                                  [open] |
|    Visible chat A                         [⌘1]|
|    Visible chat B                         [⌘2]|
|  Older                                 [closed]|
+------------------------------------------------+
```

## Constraints

- This is a renderer-only feature driven by the sidebar's current computed state.
- No stored preference, migration, menu item, global Electron accelerator, or main-process presenter
  change is needed for the first increment.
- The implementation should stay inside existing sidebar boundaries and reuse the session store.
- Badge visuals should follow the current sidebar item styling: compact pill, right-aligned, no
  layout jump, with the same default surface as the pin/delete action buttons.
- Badge display state must be driven by the modifier long-press state, not by CSS `:hover`,
  `group-hover`, or row focus selectors.
- Do not change session sorting, grouping, pagination, pinning, deletion, or agent filter behavior.

## Non-goals

- No configurable keybinding UI in settings.
- No shortcuts for group headers, settings, remote controls, new chat, or non-chat sidebar items.
- No switching to sessions that are not currently loaded in the renderer.
- No mouse-only tutorial or onboarding modal.
- No changes to chat input shortcuts.

## Business Value

The feature reduces navigation friction for keyboard-heavy users and makes the shortcut self-teaching
through the sidebar badge overlay, while keeping the implementation local to the renderer and low
risk for session persistence.
