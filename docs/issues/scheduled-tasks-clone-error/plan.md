# Implementation Plan

- Convert scheduled task trigger/action values to plain objects before invoking the scheduled task IPC route.
- Keep the change local to `ScheduledTasksSettings.vue` so route contracts and main-process logic remain unchanged.
- Validate with formatting, typecheck, lint, and the focused scheduled tasks test suite.
