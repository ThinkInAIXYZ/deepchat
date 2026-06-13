# macOS Native Feel Audit

Status: implemented in current code as of 2026-06-13; keep this spec as the native-feel regression
contract.

## User Story

As a DeepChat user on macOS, I want the app to respond like a regular Mac desktop app rather than a web page in a wrapper, so core windowing, shortcuts, scrolling, cursor behavior, and materials match platform expectations.

## Problem

The current Electron shell has native-facing choices, including a separate Settings window, native
context menus for webContents, macOS traffic lights, application-menu accelerators, and window state
persistence. This spec records the desktop-feel contract that should remain true:

- App-scoped commands such as New Conversation, Close Window, Settings, zoom, sidebar, and workspace
  use application menu accelerators.
- `globalShortcut` is reserved for true system-level show/hide window behavior.
- Primary app chrome and list rows use desktop cursor behavior while content hyperlinks keep link
  affordances.
- App chrome and search/message jumps use immediate/default scroll behavior.
- macOS window materials follow the window role and state.

## Scope

1. Replace app-scoped shortcut handling with native application menu accelerators.
2. Keep only true system-level window toggle behavior on `globalShortcut`.
3. Remove pointer cursors from primary app chrome/list rows while preserving content hyperlinks and explicitly draggable/resizable affordances.
4. Replace default smooth scrolling with immediate/native scroll behavior in app chrome and search jumps.
5. Tune macOS-only BrowserWindow material options without changing Windows/Linux shell behavior.

## Non-goals

- Rewriting the Electron shell into a native AppKit shell.
- Replacing renderer dialogs/toasts with native alert/notification flows in this increment.
- Changing user-configurable shortcut names or adding a new settings screen.
- Removing content-level link/image affordances where pointer cursor still communicates web content.
- Changing stored window bounds or migration behavior.

## Acceptance Criteria

- App-scoped shortcuts are installed as `Menu` accelerators and remain active when the app is focused.
- `globalShortcut` is used only for the configured show/hide window shortcut.
- Updating shortcut settings and calling the existing shortcut registration path refreshes menu accelerators.
- Main app commands still dispatch the existing shortcut events to the correct focused chat window or settings window.
- Sidebar/session/model/settings/spotlight-style rows no longer show hand cursor on hover.
- Global CSS no longer enables smooth scrolling by default.
- Explicit chat search/message jumps use immediate/default scroll behavior.
- macOS main/settings windows use a follow-window native material state; non-macOS options remain unchanged.
- Shortcut presenter tests cover menu accelerator dispatch and the global shortcut boundary.

## Platform Trade-offs

- Shortcut handling changes on all desktop platforms: app commands become application-menu accelerators instead of system-level registrations. This is more native, but it means those shortcuts are only guaranteed while DeepChat is the active app. The show/hide window shortcut remains global.
- Cursor and scroll changes affect all renderer platforms because the renderer is shared. The benefit is a desktop-like default; the cost is that clickable rows feel less like web links.
- Window material changes are macOS-only and should not alter Windows mica or Linux behavior.
