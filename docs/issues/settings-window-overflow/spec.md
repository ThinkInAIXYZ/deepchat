# Settings Window Overflow - Spec

## Problem

Settings can be resized below the width assumed by several fixed-width rows. The window state persists user size, but `createSettingsWindow` sets no minimum size. A narrow Settings window can squeeze the fixed `w-60` sidebar plus rows that combine `min-w-[220px]` labels and `w-[320px]` controls.

## Goal

Prevent Settings content from overflowing horizontally at the smallest supported Settings window size.

## Evidence

- `src/main/presenter/windowPresenter/index.ts` creates the Settings `BrowserWindow` with default size only.
- `src/renderer/settings/App.vue` uses a fixed `w-60` sidebar.
- `src/renderer/settings/components/common/DefaultModelSettingsSection.vue` and `ProxySettingsSection.vue` use fixed 220px labels plus 320px controls.
- `src/renderer/settings/components/MemoryConfigPanel.vue` already shows the preferred responsive control pattern: `w-full min-w-0 ... md:w-[320px]`.

## Acceptance Criteria

1. A Settings window cannot be resized or restored narrower than the width required by current fixed rows.
2. At the minimum width, Settings pages do not show horizontal document overflow.
3. No new user-facing strings are introduced.
4. Existing Settings window state restore behavior still works for valid saved sizes.

## Non-Goals

- Do not redesign Settings layout.
- Do not rewrite every Settings row in this pass.
- Do not change main-window Plugins pages.

