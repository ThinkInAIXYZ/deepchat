# macOS Native Feel Audit

## User Story

As a DeepChat user on macOS, I want the app to respond like a regular Mac desktop app rather than a web page in a wrapper, so core windowing, shortcuts, scrolling, cursor behavior, and materials match platform expectations.

## Problem

The current Electron shell already has some native-facing choices, including a separate Settings window, native context menus for webContents, macOS traffic lights, and window state persistence. Several details still reveal web-wrapper behavior:

- App-scoped commands such as New Conversation, Close Window, Settings, zoom, sidebar, and workspace are registered through `globalShortcut`, which reserves system accelerators instead of using the application menu.
- Primary list rows and navigation items use `cursor-pointer`, making desktop lists feel like web links.
- Global and targeted smooth scrolling creates web-like route/search movement where native apps usually jump or restore immediately.
- macOS window options use native title bar/vibrancy hooks, but the material state should follow the window and avoid HUD-like chrome for normal app windows.

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
