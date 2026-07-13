# Remove Legacy Scheduled Tasks

## Problem

The old `ScheduledTasksService` overlaps with the Cron Jobs implementation and keeps a second
scheduler path alive through ConfigPresenter routes, lifecycle hooks, and renderer clients.

## Goal

Remove legacy scheduled-task compatibility so Cron Jobs is the only scheduler.

## Acceptance Criteria

- No main-process `ScheduledTasksService` is constructed or started.
- No `scheduledTasks.*` route contract or dispatcher branch remains.
- No renderer `ScheduledTasksClient` or legacy settings component remains.
- ConfigPresenter no longer reads or writes the `scheduledTasks` config key.
- Settings route names may stay if they already point at the new Scheduled page.

## Non-Goals

- No migration from legacy scheduled tasks.
- No compatibility fallback for old config.
