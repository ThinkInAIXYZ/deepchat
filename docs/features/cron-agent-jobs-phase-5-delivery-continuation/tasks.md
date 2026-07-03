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
- [ ] Add delivery retry route only if needed for failed receipts.

## Continuation

- [x] Add remote delivery port to `RemoteControlPresenter`.
- [ ] Add remote continuation port to `RemoteControlPresenter`.
- [ ] Store remote message to `runId/sessionId` mapping.
- [ ] Continue original session from supported remote replies.
- [ ] Enforce remote authorization before continuation.

## UI And Validation

- [x] Replace desktop notification delivery controls with Remote binding selection.
- [ ] Add delivery status and logs to run detail.
- [x] Add i18n keys.
- [x] Cover router remote delivery receipts.
- [ ] Cover remote mapping and UI states.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
