# Cron Agent Jobs Trigger Logging

## User Need

When a scheduled cron job does not create a session or deliver a result, developers need logs that show where the trigger chain stopped.

## Goal

Add focused main-process logs for due-run receipt, run processing, session creation, and prompt dispatch.

## Acceptance Criteria

- Logs show when the scheduler reports a due run.
- Logs show when the cron service starts processing a due run.
- Logs show session creation and task dispatch boundaries.
- Logs do not include task prompt content.

## Constraints

- Do not add a new tracing subsystem.
- Do not log scheduler heartbeats.

## Open Questions

None.
