# Plan

## Implementation Approach

1. Add an optional sticky header mode to `SettingsPageShell`.
2. Enable the sticky header mode only from `CronJobsSettings.vue`.
3. Change the cron job list sort to creation order and append newly inserted jobs before sorting.

## Affected Interfaces

- `SettingsPageShell.vue` gets an optional `stickyHeader` prop with a default-false behavior.
- No IPC, route, or shared contract changes.

## Data Flow

- `client.list()` still returns cron jobs from the backend.
- The renderer normalizes the visible list to `createdAt ASC`.
- `applyJob()` updates an existing row in place or appends a new row.

## Compatibility

- Existing persisted cron jobs do not require migration.
- Other settings pages keep the current non-sticky shell header.

## Test Strategy

- Run formatter, i18n generation, lint, and typecheck.
- Manually inspect the relevant Vue structure for sticky classes and stable list ordering.
