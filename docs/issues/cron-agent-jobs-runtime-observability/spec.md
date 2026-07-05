# Cron Agent Jobs Runtime Observability

## User Need

Scheduled cron runs should create agent sessions when due, and failures should be visible through run history and configured delivery targets.

## Goal

Ensure the cron scheduler is wired to the session starter before it starts, and avoid silent completion when no executor is available.

## Acceptance Criteria

- Cron jobs start after route runtime wiring has registered the run session starter.
- A due run without an executor is marked failed instead of completed.
- Failures before executor handoff are delivered when `notifyOnFailure` is enabled.

## Constraints

- Do not add a new cron status.
- Keep the scheduler utility process unchanged.

## Open Questions

None.
