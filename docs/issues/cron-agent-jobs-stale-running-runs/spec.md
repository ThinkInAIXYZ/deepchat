# Cron Agent Jobs Stale Running Runs

## User Need

After restarting the app, stale cron run rows from a previous process must not block new runs as if another run were active.

## Goal

Close leftover `running` cron runs during scheduler startup before new due runs are processed.

## Acceptance Criteria

- Startup marks existing `running` cron runs as failed.
- New manual or scheduled runs are not skipped because of stale rows.
- Startup repair does not send delivery notifications for historical stale rows.

## Constraints

- Do not add a new run status.
- Keep the repair in cron startup, not in every active-run check.

## Open Questions

None.
