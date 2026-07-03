# Plan

1. Add a narrow scheduler-status polling loop to the Scheduled settings page.
2. Use the existing `cronJobs.getSchedulerStatus` route rather than reloading jobs.
3. Clean up the polling timer on page unmount.
4. Validate formatting, i18n, lint, typecheck, and focused cron tests.

