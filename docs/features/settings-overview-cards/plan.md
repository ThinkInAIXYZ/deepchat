# Implementation Plan

## UI

- Add interactive behavior to the reusable status metric card through an optional select event.
- Wire the four overview metrics to existing settings route names.
- Extract the dashboard nostalgia card into a small reusable component and render it in Settings Overview.
- Add an option to hide the nostalgia card in the embedded dashboard instance to avoid duplication.
- Move the settings activity table below the dashboard in Settings Overview.

## Data Flow

- Keep `DashboardSettings` as the owner of usage dashboard loading.
- Emit the latest dashboard payload from `DashboardSettings` when it loads.
- Let `SettingsOverview` pass that payload into the extracted nostalgia component.

## Test Strategy

- Rely on existing Vue type checking and lint for component integration.
- Run the repository-required `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` after implementation.
