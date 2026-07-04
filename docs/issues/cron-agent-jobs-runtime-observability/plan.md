# Plan

1. Prime the route runtime in the cron after-start hook before starting the scheduler.
2. Mark due runs failed when the run executor is not wired.
3. Deliver pre-executor failures through the existing delivery router.
4. Add focused tests.
5. Run format, i18n, lint, typecheck, and focused tests.
