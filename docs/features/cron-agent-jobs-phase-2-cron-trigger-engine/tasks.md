# Tasks

## Parser Integration

- [x] Add and lock the cron parser dependency.
- [x] Implement `CronExpressionService` with validate, preview, next-run, misfire, and preset
      conversion methods.
- [x] Add tests for minute interval, weekdays, monthly last day, nth weekday, timezone, DST, and
      invalid expressions.

## Persistence And Scheduler

- [x] Add schedule-related migrations to `cron_jobs`.
- [x] Recompute `next_run_at` on create, update, toggle, list, and scheduler reconcile/due
      advancement.
- [x] Implement `skip` and `run_once` misfire behavior.
- [x] Keep utility-process scans based on `next_run_at <= now`.

## Routes And UI

- [x] Add `cronJobs.previewSchedule` and `cronJobs.validateSchedule` route contracts.
- [x] Update `CronJobsClient`.
- [x] Build the raw cron editor and computed next-run indicator.
- [x] Build preset controls that write only cron expressions.
- [x] Add next-runs preview, loading, empty, and parser-error states.
- [x] Reuse existing i18n keys where no new visible copy is needed.

## Validation

- [x] Run targeted main and renderer tests.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
