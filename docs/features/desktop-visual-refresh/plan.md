# Desktop Visual Refresh Plan

Contract: [spec.md](./spec.md).

- [x] Inspect shell, theme tokens, sidebar state, composer callers, settings navigation and tests.
- [x] Create `dimagent/visual-refresh` from the current checkout, preserving unrelated files.
- [x] Update shared light/dark surfaces and control presentation; synchronize the design reference.
- [x] Integrate sidebar navigation, preserving agent switching, session groups and collapsed access.
- [x] Align welcome/chat content and integrate session controls into both composer callers.
- [x] Apply the visual hierarchy to settings, appearance previews and navigation filtering.
- [x] Unify search, workspace panels, scheduled tasks and plugin/skill presentation.
- [x] Review the complete change for focus, resizing, persistence, permissions and performance.
- [x] Select focused regression coverage after implementation; remove temporary probes.
- [x] Run formatting, i18n, lint, typecheck and relevant renderer suites; inspect runtime visuals.
- [x] Align the wider text-size selector and keep environment scrolling inside the list.
- [x] Move ACP configuration and maintenance actions behind compact installed-Agent rows.
- [x] Keep Hooks and data initialization quiet, preserving write and error feedback.
- [x] Preserve main-window visibility when enabling the floating widget.
- [x] Restore Markstream table ownership and visible low-usage context tracks.

## Validation results

- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck`: passed.
- Internationalization contracts: 23 locales; no missing keys or invalid message contracts.
  The two new Tibetan and traditional Mongolian labels use English fallback text.
- `pnpm run build`: passed, including the CLI build. Normal model/ACP catalog refreshes and generated
  icon updates are retained. The application also rebuilt successfully after visual adjustments.
- Complete renderer regression suite: 289 files, 2741 tests passed.
- Floating-widget window, layout and presenter tests: 3 files, 16 tests passed, including Linux
  inactive-show fallback, actual visibility state and macOS panel construction.
- ACP settings: 13 tests passed, including uninstall/reinstall and external registry removal
  without reopening details or leaving focus on the removed action.
- Electron smoke tests passed for agent draft preservation, local streaming with an editable
  composer, keyboard navigation, and settings navigation across desktop/dark/minimum-RTL layouts.
  Floating-widget IPC coverage also verifies that the main window stays visible after enabling it.
  Streaming Markdown coverage checks padding on every table header/body edge cell.
- Agent dropdown placement passed at 800×320 with twelve additional agents: the menu stays below
  its trigger, scrolls within the viewport, and supports keyboard selection of its final item.
  Checked-item selection preserves the conversation and draft; explicit all-agents selection clears
  the filter. Temporary agents are deleted during smoke-test cleanup.
- A temporary preview probe passed against isolated user data, checking theme synchronization,
  settings filtering, search focus restoration, plugins and 800px/760px windows. The probe was
  removed; runtime screenshots remain outside the repository in the task's visualization folder.
- Rendered blue status text contrast: at least 6.2:1 against the composer and 5.0:1 against a 15%
  primary tint in both themes. Primary button contrast remains at least 4.9:1.
- RTL layout checks passed for the conversation and settings shells: their divider and rounded
  corner follow the navigation edge.
- Isolated Electron layout checks passed at 1280×900 and 800×600: the text-size selector spans
  360px, a thirty-row environment list scrolls without moving its heading or filters, and ACP
  detail navigation restores focus. Agent and directory screenshots use synthetic read-only data.
- Both themes show a filled track background and inset outline at 0% context occupancy.
- Sidebar regression checks preserve one bottom toggle's coordinates and keyboard focus across
  both states, including the narrow-window default collapse policy. Theme selection has its own
  row, collapsed footer buttons share their size and center, and both states keep the footer
  reachable at 800×320. Sidebar unit coverage: 80 tests; Agent-menu and keyboard/settings Electron
  smoke coverage: 2 tests passed.
- Agent-menu regression checks cover both sidebar states after toggling at 800×320. The menu
  stays below its current trigger, scrolls within the viewport, and restores focus on Escape.
  Runtime screenshots also cover 1280×900 in light mode. Geometry assertions protect anchoring,
  viewport bounds, and toggle position without fixing button dimensions or footer padding.
- Runtime visual inspection: macOS. Windows and Linux native window behavior was not exercised.
  Native macOS checks preserve the main window and Dock visibility and confirm all-workspace
  visibility. Cross-application fullscreen composition and manual Spaces switching were not tested.
