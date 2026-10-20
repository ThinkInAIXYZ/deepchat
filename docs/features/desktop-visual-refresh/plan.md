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

## Validation results

- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck`: passed.
- Internationalization contracts: 23 locales; no missing keys or invalid message contracts.
  The two new Tibetan and traditional Mongolian labels use English fallback text.
- `pnpm run build`: passed, including the CLI build. Normal model/ACP catalog refreshes and generated
  icon updates are retained. The application also rebuilt successfully after visual adjustments.
- Complete renderer regression suite: 289 files, 2738 tests passed.
- Electron smoke tests passed for agent draft preservation, local streaming with an editable
  composer, keyboard navigation, and settings navigation across desktop/dark/minimum-RTL layouts.
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
- Runtime visual inspection: macOS. Windows and Linux native window behavior was not exercised.
