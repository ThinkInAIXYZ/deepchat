# Cron Job Run Insert Values

## User Need

Manual cron job runs must queue a run row without SQLite insert errors.

## Goal

Fix `cron_job_runs` queued-run insertion so the values list matches the Phase 4 column list.

## Acceptance Criteria

- `cronJobs.runNow` can insert a queued run.
- New Phase 4 run columns default to `NULL` on queued rows.
- No compatibility fallback or migration is added before first release.

## Non-Goals

- No schema rebuild.
- No legacy data migration.

