# Tasks

## Parser Integration

- [ ] Add and lock the cron parser dependency.
- [ ] Implement `CronExpressionService` with validate, preview, next-run, misfire, and preset
      conversion methods.
- [ ] Add tests for minute interval, weekdays, monthly last day, nth weekday, timezone, DST, and
      invalid expressions.

## Persistence And Scheduler

- [ ] Add schedule-related migrations to `cron_jobs`.
- [ ] Recompute `next_run_at` on every create, update, toggle, run completion, and reconcile.
- [ ] Implement `skip` and `run_once` misfire behavior.
- [ ] Keep utility-process scans based on `next_run_at <= now`.

## Routes And UI

- [ ] Add `cronJobs.previewSchedule` and `cronJobs.validateSchedule` route contracts.
- [ ] Update `CronJobsClient`.
- [ ] Build the schedule editor with preset and raw cron modes.
- [ ] Add next-runs preview, loading, empty, and parser-error states.
- [ ] Add i18n keys.

## Validation

- [ ] Run targeted main and renderer tests.
- [ ] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
