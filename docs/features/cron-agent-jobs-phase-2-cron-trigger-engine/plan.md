# Implementation Plan

## Phase Boundary

This phase depends on phase 1 tables, routes, repository, and scheduler status. It makes schedules
real, but still leaves job execution mocked.

## Data Model Changes

Alter `cron_jobs`:

```sql
ALTER TABLE cron_jobs ADD COLUMN misfire_policy TEXT NOT NULL DEFAULT 'skip';
ALTER TABLE cron_jobs ADD COLUMN max_catch_up_runs INTEGER;
ALTER TABLE cron_jobs ADD COLUMN schedule_error TEXT;
```

Keep `cron_expr`, `timezone`, and `next_run_at` as first-class columns for scan efficiency.

## Core Services

Add `CronExpressionService`:

- `validate(cronExpr, timezone)`
- `preview(cronExpr, timezone, count, from)`
- `computeNextRunAt(schedule, from)`
- `reconcileMisfire(job, now)`
- `presetToCron(preset)`

This service is pure and has no renderer or SQLite dependency.

## Route Additions

Add or extend:

- `cronJobs.previewSchedule`
- `cronJobs.validateSchedule`
- `cronJobs.upsert` schedule fields

Every write route must recompute `next_run_at` on the main side. Renderer-supplied previews are not
trusted.

## Scheduler Reconcile

The utility process should keep the scan rule simple:

```text
SELECT enabled jobs WHERE next_run_at IS NOT NULL AND next_run_at <= now
```

After queuing a run, it asks the schedule service to advance `next_run_at` based on the stored
schedule and misfire policy. This keeps phase 1's scheduler lifecycle stable.

## UI Plan

Upgrade the job editor schedule area:

```text
+---------------------------------------------------------+
| Schedule                                                |
| [Preset] [Cron]                                         |
|                                                         |
| Preset: [Weekdays v] [09:00]                            |
| Timezone: [Asia/Tokyo v]                                |
|                                                         |
| Cron: 0 9 * * 1-5                                      |
| Next runs                                               |
| 2026-07-03 09:00 | 2026-07-06 09:00 | ...              |
+---------------------------------------------------------+
```

Use inline validation near the cron input. Do not use visible instructional paragraphs to explain
cron syntax; rely on compact labels, preview, and error messages.

## Compatibility

- Legacy `ScheduledTasksService` remains unchanged.
- New Cron Jobs never stores `kind: 'daily'` or `kind: 'weekly'`.
- If legacy migration is attempted later, map old triggers into cron expressions at migration time.

## Test Strategy

- Pure unit tests for parser-backed preview and validation.
- Timezone tests with at least `UTC`, `Asia/Tokyo`, and a DST-observing zone.
- Misfire policy tests around app downtime and resume.
- Repository tests proving `next_run_at` updates are transactional with queued run creation.
- Renderer tests for preset mode, raw cron mode, preview loading, and invalid expression state.

## Validation Commands

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm test -- test/main/presenter/cronJobs`
- `pnpm test -- test/renderer`
