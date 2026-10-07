# Sidebar Session Batches Plan

- [x] Extend lightweight query filters through the typed route and SQL projection.
- [x] Implement independent sidebar prefixes, loading, collapse reset and active-row visibility.
- [x] Integrate controls, scrolling, shortcut rows, search and translations.
- [x] Review lifecycle and existing workspace behavior; retain minimal regression protection.
- [x] Run formatting, i18n, lint, type checks and relevant main/renderer tests.

Implementation precedes new tests. Acceptance and scope are defined in [spec.md](./spec.md).

## Validation

- Formatting, i18n, lint, type checks and the Electron production build pass.
- Relevant main and renderer suites pass: 275 tests, including native SQLite filtering and IPC serialization.
- A disposable Electron profile verifies independent 5-row prefixes, pagination to the final page, collapse reset, search restoration and keyboard focus after the final button disappears.
