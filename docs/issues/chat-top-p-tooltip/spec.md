# Chat Top P Tooltip

## User Need

The chat settings panel Top P help icon must show explanatory text reliably. The settings dialog should keep inline description text, while the chat status bar should keep a hover tooltip interaction.

## Goal

Fix the Top P help content in `ChatStatusBar.vue` so it is visible above the settings popover and has a readable width.

## Acceptance Criteria

- Hovering the Top P help icon in the chat settings panel shows the Top P description.
- The tooltip is not hidden behind the model settings popover.
- The tooltip content has a readable constrained width for the long description.
- The settings dialog Top P description remains inline text.
- The existing Top P range clamp behavior remains aligned between chat and settings pages.

## Constraints

- Keep changes focused to the chat settings Top P help behavior.
- Preserve existing i18n keys and shadcn/reka UI styling patterns where practical.
- Do not introduce new dependencies.

## Non-goals

- Redesign the full chat settings panel.
- Change Top P semantics or persisted data shape.
