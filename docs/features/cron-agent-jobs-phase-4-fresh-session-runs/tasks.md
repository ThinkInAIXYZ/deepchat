# Tasks

## Execution Path

- [x] Add `CronJobRunExecutor`.
- [x] Implement transactional queued-run claiming.
- [x] Create fresh detached sessions through the existing agent session presenter.
- [x] Start the job prompt through the existing send-message path.
- [x] Persist run status, session id, output message id, preview, and errors.
- [ ] Enforce max duration, max turns, max tool calls, and full concurrency policy.

## Persistence And Routes

- [x] Add run claiming and output columns.
- [x] Add session metadata storage for `source='cron_job'`.
- [x] Add run history, run detail, open session, continue, and run-again routes.
  - [x] Add run history and open-session routes.
  - [x] Add run detail, continue, and run-again routes.

## UI

- [x] Add run history list.
- [ ] Add run detail view.
- [ ] Add Open Session, Continue Session, and Run Again actions.
  - [x] Add Open Session action.
  - [ ] Add Continue Session and Run Again actions.
- [x] Add session-list source indicators for cron-job sessions where appropriate.
- [x] Reuse existing i18n keys.

## Tests And Validation

- [ ] Cover completed, failed, cancelled, waiting_permission, and duplicate `RUN_DUE` cases.
- [x] Cover manual `Run Now` using the same execution path.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
