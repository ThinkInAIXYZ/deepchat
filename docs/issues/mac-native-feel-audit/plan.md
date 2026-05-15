# macOS Native Feel Audit Plan

## Guiding Principles

- Follow T3 from the native-feel skill: adopt the platform rather than recreating platform behavior in CSS or global hooks.
- Keep behavior scoped: global shortcuts are for app activation, app commands are for the native application menu.
- Preserve existing IPC/event names so renderer behavior and tests do not need broad migration.

## Shortcut Architecture

Current state:

- `ShortcutPresenter.registerShortcuts()` registers all shortcuts through `globalShortcut`.
- Focus/blur hooks register and unregister these shortcuts as windows gain or lose focus.
- Renderer settings save path calls `shortcutRuntime.registerShortcuts()` to refresh configured shortcuts.

Target state:

- `ShortcutPresenter.registerShortcuts()` rebuilds the application menu and registers only system-level shortcuts.
- Application menu items use the configured accelerators and call the same presenter/eventBus handlers currently used by `globalShortcut`.
- `unregisterShortcuts()` keeps the app menu installed and leaves only the show/hide global shortcut active, matching the existing focus/blur lifecycle without losing global activation.
- `destroy()` removes global shortcuts and clears the application menu during shutdown.

## Menu Command Routing

- Chat-window commands use the focused managed chat window:
  - Toggle Sidebar
  - Toggle Workspace
  - Clean Chat History
  - Delete Conversation
- Focused-window commands use any focused DeepChat window:
  - New Conversation
  - Close Window
- App commands can work without a focused chat window:
  - New Window
  - Settings
  - Quit
  - Zoom events
- Quick Search keeps current behavior: if Settings is focused, target the main chat window.

## Renderer Native-feel Cleanup

Remove `cursor-pointer` from:

- Main sidebar session rows.
- Settings sidebar rows.
- Model picker rows.
- Skill/model/sampling/spotlight list rows.
- File item rows/cards where the whole row behaves like native selectable content.

Preserve pointer cursor for:

- Content hyperlinks.
- Images or rich content that intentionally preview/open content.
- Drag and resize handles.
- Disabled/not-allowed states.

Scrolling:

- Replace global smooth scroll with `auto`.
- Replace chat spotlight/message search jump smooth scrolling with immediate/default behavior.

## macOS Window Shell

For main and settings windows:

- Keep macOS-only `titleBarStyle: hiddenInset`, transparency, traffic light position, and shadow.
- Add `visualEffectState: followWindow`.
- Use a normal app-window material rather than HUD-like material for primary windows.

No Windows/Linux shell options are intentionally changed.

## Test Strategy

- Update `test/main/presenter/shortcutPresenter.test.ts` so it asserts app commands are installed in the native menu, not in `globalShortcut`.
- Add coverage that sidebar/workspace menu commands dispatch to focused chat windows.
- Add coverage that chat commands do not dispatch to Settings/non-chat windows.
- Add coverage that only the show/hide shortcut is registered globally.
- Run targeted shortcut tests, then project formatting/i18n/lint.

## Risks

- Some Electron accelerators may behave slightly differently across platforms when routed through menus instead of `globalShortcut`.
- Hidden menu bars on Windows/Linux should still honor accelerators, but this should be manually smoke-tested in app builds.
- The renderer cursor cleanup is intentionally broad enough to be felt; if users strongly prefer hand cursors in certain tool panels, restore them only for controls that are closer to buttons than list rows.
