# Scheduled Runs Not Visible

## User Need

Scheduled jobs should visibly create a new run when their next run time arrives.

## Goal

Keep the settings page aligned with scheduler heartbeats so a scheduled run appears without manual reload, and keep service coverage for due-run execution.

## Acceptance Criteria

- When scheduler status advances after a due scan, visible job histories refresh.
- A scheduler due event can start a fresh cron run session through `CronJobsService`.
- No extra controls or fallback migration paths are added.

## Constraints

- Keep the existing scheduler process and route contracts.
- Keep history display to the latest timestamp only.

## Non-Goals

- Do not add push notifications or a new renderer event bus in this fix.
