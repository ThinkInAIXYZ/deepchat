# Tasks

## Preparation

- [x] Add shared Cron Jobs domain types and route contracts.
- [x] Add SQLite table classes and migrations for `cron_jobs` and `cron_job_runs`.
- [x] Add repository methods for job CRUD, enabled counts, due scans, queued run insertion, and
      status updates.

## Scheduler Process

- [x] Implement `SchedulerProcessManager` with start, stop, restart, reconcile, heartbeat, and
      crash backoff.
- [x] Implement `schedulerHost` utility-process entry with direct scheduler DB adapter access.
- [x] Add scheduler protocol validation and defensive error serialization.
- [x] Wire startup, resume, before-quit, and job-change lifecycle hooks.

## Routes And UI

- [x] Register `cronJobs.*` routes in shared contracts and main route dispatcher.
- [x] Add `CronJobsClient`.
- [x] Add minimal Cron Jobs settings page with scheduler status and one restart-timer action.
- [x] Change per-job next run from an editable date-time field to a read-only indicator.
- [x] Add i18n keys for all visible strings.

## Tests And Validation

- [x] Cover due-run idempotency and `next_run_at <= now` scan behavior.
- [x] Cover scheduler start/idle-stop/crash-restart transitions.
- [x] Cover route dispatcher and renderer client behavior.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
