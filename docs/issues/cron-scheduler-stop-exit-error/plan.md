# Plan

1. Change scheduler process exit handling to decide whether the exit is expected before writing
   status.
2. Treat exits with no enabled jobs as idle, not error.
3. Add a focused process-manager test.
4. Run formatting, i18n, lint, typecheck, and the focused cron test.

