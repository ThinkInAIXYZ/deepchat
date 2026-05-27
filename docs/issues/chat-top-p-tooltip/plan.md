# Plan

## Approach

The current nested `Tooltip` is fragile inside the model settings `Popover` and can render beneath or outside the visible stacking context. Replace it with a controlled lightweight hover/focus panel anchored next to the Top P label. This keeps tooltip-style interaction while avoiding portal stacking conflicts.

## Affected Interfaces

- `src/renderer/src/components/chat/ChatStatusBar.vue`

## Data Flow

No data flow changes. The same `chat.advancedSettings.topPDescription` i18n string is displayed.

## Compatibility

No persisted configuration changes. The chat settings Top P clamp behavior remains unchanged.

## Test Strategy

- Static verification of template/script changes.
- Run project formatting/lint commands if package tooling is available.
