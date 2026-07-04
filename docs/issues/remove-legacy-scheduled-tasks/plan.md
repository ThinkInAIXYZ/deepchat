# Implementation Plan

1. Delete the legacy service, route contract, renderer client, and legacy component.
2. Remove presenter construction, lifecycle hooks, route wiring, and ConfigPresenter methods.
3. Remove tests that only covered the deleted legacy scheduler.
4. Keep the new Scheduled/Cron Jobs settings route intact.

## Validation

- `pnpm run lint`
- `pnpm test -- test/main/presenter/cronJobs.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/cronJobsClient.test.ts`
