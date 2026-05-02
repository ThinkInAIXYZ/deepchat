# Sidebar And Workspace Shortcuts

## User Need

Laptop users need faster access to more chat space without reaching for the mouse. DeepChat should provide keyboard shortcuts to toggle the left sidebar and the right workspace panel from the main chat window.

## Defaults

- `ToggleSidebar`: `CommandOrControl+B`
- `ToggleWorkspace`: `CommandOrControl+J`

## Acceptance Criteria

- Both shortcuts are registered through the existing shortcut settings flow.
- Both shortcuts appear in the settings shortcut page and can be customized.
- `ToggleSidebar` toggles the main chat sidebar collapsed state.
- `ToggleWorkspace` toggles the workspace side panel for the active chat session only.
- Shortcut events are delivered only to the currently focused DeepChat chat window.
- Existing sidebar and workspace buttons keep working without behavior changes.

## Non-Goals

- No persistence change for sidebar collapsed state.
- No new buttons, menu items, or layout redesign.
- No localization sweep for every existing locale in this increment.
