# Tasks

## Execution Path

- [ ] Add `CronJobRunExecutor`.
- [ ] Implement transactional queued-run claiming.
- [ ] Create fresh sessions through existing session service.
- [ ] Send job prompt through existing chat service.
- [ ] Persist run status, session id, output message id, preview, and errors.
- [ ] Enforce max duration, max turns, max tool calls, and concurrency policy.

## Persistence And Routes

- [ ] Add run claiming and output columns.
- [ ] Add session metadata storage for `source='cron_job'`.
- [ ] Add run history, run detail, open session, continue, and run-again routes.

## UI

- [ ] Add run history list.
- [ ] Add run detail view.
- [ ] Add Open Session, Continue Session, and Run Again actions.
- [ ] Add session-list source indicators for cron-job sessions where appropriate.
- [ ] Add i18n keys.

## Tests And Validation

- [ ] Cover success, failed, cancelled, waiting-permission, and duplicate `RUN_DUE` cases.
- [ ] Cover manual `Run Now` using the same execution path.
- [ ] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
