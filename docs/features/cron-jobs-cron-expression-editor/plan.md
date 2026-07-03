# Plan

## Implementation

1. Remove `@vue-js-cron/core`, the local cron editor wrapper, and its renderer test.
2. Change the shared Cron Jobs default expression to `* * * * *`.
3. Render static reference examples under the existing cron expression input.
4. Keep preview chips, validation errors, and upsert flow unchanged.

## Data Flow

```text
Raw cron input
  -> cronExpr string
  -> CronJobsSettings.commitJob()
  -> cronJobs.upsert
  -> CronExpressionService validation and next-run calculation
```

Reference examples are display-only and do not write state.

## Validation

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
