# Cron Jobs Cron Expression Reference

## Goal

Keep Cron Jobs schedule editing simple by using one raw cron expression input with lightweight
reference examples below it.

## Decision

Do not use a visual cron picker.

Rationale:

- The renderless picker still expands into several dense selects and is harder to scan than cron.
- Cron Jobs already persists only `cronExpr`; keeping one input avoids duplicate schedule controls.
- Static examples cover the common schedules without adding UI state or dependencies.

## Requirements

- New Cron Jobs default to `* * * * *`.
- The raw cron expression input remains the only editable schedule control.
- Common examples are shown as read-only references below the input.
- Preview and validation continue to use the main-process `cronJobs.previewSchedule` and
  `cronJobs.validateSchedule` routes.
- No scheduler, SQLite, route-contract, or parser changes.
- No cron editor dependency.

## UX Shape

```text
+---------------------------------------------------------+
| [Name] [Agent] [Timezone]                               |
| Cron expression: [* * * * *]                             |
| */5 * * * *  Every 5 minutes                            |
| 0 * * * *    Hourly                                     |
| 0 9 * * *    Daily at 09:00                             |
| 0 9 * * 1-5  Weekdays at 09:00                          |
|                                                         |
| [Task prompt]                         [Runtime]          |
| Next runs                                               |
| [2026-07-03 09:00] [2026-07-04 09:00] ...              |
+---------------------------------------------------------+
```

## Non-Goals

- Do not add clickable schedule shortcuts.
- Do not persist schedule mode, editor tabs, or UI-only state.
- Do not add an external UI framework package.
