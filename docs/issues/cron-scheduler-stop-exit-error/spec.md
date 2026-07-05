# Cron Scheduler Stop Exit Error

## Problem

When the user disables the last scheduled task, the scheduler utility can exit while there are no
enabled jobs left. The process manager currently writes `Cron scheduler utility exited with code 1.`
before it checks that no restart is needed, so the settings page shows an error for a user-initiated
stop path.

## Acceptance Criteria

- Disabling the last enabled job must not surface a scheduler exit-code error.
- Explicit stop/restart paths must still clear scheduler errors.
- Unexpected exits while enabled jobs remain must still be marked as errors and scheduled for restart.
