# Settings Control Center Plan

## Layout

- Add grouped settings navigation metadata and a grouped sidebar.
- Add a shared page shell for consistent headers, descriptions, actions, and scroll behavior.
- Add `/overview` and hide `/dashboard` from navigation while preserving route compatibility.

## Pages

- Build `SettingsOverview` with passive status cards, quick tasks, needs attention, recent activity, and embedded usage dashboard.
- Refactor Provider into list plus detail tabs: Connection, Models, Limits, Advanced.
- Refactor MCP into status cards, filters, server cards, and a right-side Sheet detail.
- Refactor Data into Backup & Sync, Privacy Mode, Data Operations, and Danger Zone.
- Wrap remaining tabs with the new shell without changing their core behavior.

## Data

- Add `settings_activity` SQLite table with a 2000-record retention cap.
- Add a typed list route returning at most 200 records.
- Record key successful mutations from provider, model, MCP, sync, and settings update routes.

## QA

- Update unit tests and e2e settings smoke tests.
- Run format, i18n, lint, typecheck, focused tests, and settings e2e.
- Start the app and capture settings screenshots before stopping the dev app.
