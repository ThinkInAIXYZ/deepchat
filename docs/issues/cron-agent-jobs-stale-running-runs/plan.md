# Plan

1. Add a table/repository method to fail all persisted `running` cron runs.
2. Call it once when the cron service starts.
3. Add focused service coverage.
4. Run format, i18n, lint, typecheck, and focused cron tests.
