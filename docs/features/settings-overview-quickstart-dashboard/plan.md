# Implementation Plan

## Change

- Replace the fourth metric card in `SettingsOverview.vue` with a compact Quick start card.
- Remove the standalone Quick start and Nostalgia section from the overview.
- Render `DashboardSettings` directly after the top row without hiding Nostalgia.
- Remove overview state that only existed to host the standalone Nostalgia card.

## Validation

- Run format, i18n, lint, web typecheck, and focused dashboard tests.
