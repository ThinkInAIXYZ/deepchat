# Cron Agent Jobs Concurrency Skip Delivery

## User Need

Users should not receive Remote delivery messages for cron runs that were intentionally skipped because a previous run is still active.

## Goal

Suppress delivery for concurrency-policy skip cancellations while preserving the recorded cancelled run for history/debugging.

## Acceptance Criteria

- A skipped overlapping run does not call delivery targets.
- Genuine failed or cancelled runs still deliver when `notifyOnFailure` is enabled.
- The run remains recorded as cancelled with the existing active-run message.

## Constraints

- Do not add a new run status for this bug fix.
- Keep the change inside the cron run executor.

## Open Questions

None.
