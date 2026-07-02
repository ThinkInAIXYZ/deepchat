# Tasks

## Persistence

- [ ] Add `cron_job_deliveries` table and indexes.
- [ ] Add `delivery_json` to `cron_jobs`.
- [ ] Add delivery receipt repository methods.

## Delivery

- [ ] Implement `CronJobDeliveryRouter`.
- [ ] Add DeepChat Inbox, desktop notification, origin session, and remote target adapters.
- [ ] Persist receipt success and failure per target.
- [ ] Add delivery retry route only if needed for failed receipts.

## Continuation

- [ ] Add remote delivery/continuation port to `RemoteControlPresenter`.
- [ ] Store remote message to `runId/sessionId` mapping.
- [ ] Continue original session from supported remote replies.
- [ ] Continue original session from DeepChat UI.
- [ ] Enforce remote authorization before continuation.

## UI And Validation

- [ ] Add delivery configuration controls.
- [ ] Add delivery status and logs to run detail.
- [ ] Add i18n keys.
- [ ] Cover router, remote mapping, unauthorized reply, and UI states.
- [ ] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
