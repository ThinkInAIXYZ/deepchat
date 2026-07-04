# Tasks

## Persistence

- [x] Add `cron_job_deliveries` table and indexes.
- [x] Add `delivery_json` to `cron_jobs`.
- [x] Add delivery receipt repository methods.

## Delivery

- [x] Implement `CronJobDeliveryRouter`.
- [x] Remove desktop notification, DeepChat Inbox, and origin session delivery targets.
- [x] Add Remote channel delivery adapter.
- [x] Persist receipt success and failure per target.
- [x] Do not add a delivery retry route unless a concrete recovery workflow needs it.

## Continuation

- [x] Add remote delivery port to `RemoteControlPresenter`.
- [x] Keep delivery notification-only; do not add remote continuation.

## UI And Validation

- [x] Replace desktop notification delivery controls with Remote binding selection.
- [x] Add delivery status and logs to run detail.
- [x] Add i18n keys.
- [x] Cover router remote delivery receipts.
- [x] Cover delivery list route and client.
- [x] Keep delivery UI limited to configured Remote targets and receipt status.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
