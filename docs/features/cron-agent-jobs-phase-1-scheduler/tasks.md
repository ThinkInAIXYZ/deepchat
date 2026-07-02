# Tasks

## Preparation

- [ ] Add shared Cron Jobs domain types and route contracts.
- [ ] Add SQLite table classes and migrations for `cron_jobs` and `cron_job_runs`.
- [ ] Add repository methods for job CRUD, enabled counts, due scans, queued run insertion, and
      status updates.

## Scheduler Process

- [ ] Implement `SchedulerProcessManager` with start, stop, restart, reconcile, heartbeat, and
      crash backoff.
- [ ] Implement `schedulerHost` utility-process entry with direct scheduler DB adapter access.
- [ ] Add scheduler protocol validation and defensive error serialization.
- [ ] Wire startup, resume, before-quit, and job-change lifecycle hooks.

## Routes And UI

- [ ] Register `cronJobs.*` routes in shared contracts and main route dispatcher.
- [ ] Add `CronJobsClient`.
- [ ] Add minimal Cron Jobs settings page with scheduler status, reconcile, and restart actions.
- [ ] Add i18n keys for all visible strings.

## Tests And Validation

- [ ] Cover due-run idempotency and `next_run_at <= now` scan behavior.
- [ ] Cover scheduler start/idle-stop/crash-restart transitions.
- [ ] Cover route dispatcher and renderer client behavior.
- [ ] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
