# Implementation Plan

## UI

- Replace the three always-visible Danger Zone destructive buttons in `DataSettings.vue` with one outline reset entry.
- Keep the existing confirmation dialog and radio choices as the authoritative place for choosing the reset type.
- Add stable test IDs for the reset entry and dialog choices.

## Behavior

- Opening the reset dialog resets the selected type to `chat`.
- Confirmation continues to call `devicePresenter.resetDataByType(resetType.value)`.
- Existing disabled states for import and backup still gate both the entry and confirmation action.

## Validation

- Update focused renderer tests for the single entry and dialog options.
- Verify selected reset type still reaches the presenter.
- Run format, i18n, lint, and the focused Data Settings test.
