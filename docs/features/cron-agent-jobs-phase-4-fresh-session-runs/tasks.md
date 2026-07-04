# Tasks

## Execution Path

- [x] Add `CronJobRunExecutor`.
- [x] Implement transactional queued-run claiming.
- [x] Create fresh detached sessions through the existing agent session presenter.
- [x] Start the job prompt through the existing send-message path.
- [x] Persist run status, session id, output message id, preview, and errors.
- [x] Enforce max duration, max turns, and full concurrency policy.

## Persistence And Routes

- [x] Add run claiming and output columns.
- [x] Add session metadata storage for `source='cron_job'`.
- [x] Add run history routes.
  - [x] Add run history and open-session routes.
  - [x] Remove open-session route if no UI entry uses it.

## UI

- [x] Add run history list.
- [x] Keep history compact; do not add run detail, continue, or run-again actions.
- [x] Add session-list source indicators for cron-job sessions where appropriate.
- [x] Reuse existing i18n keys.

## Tests And Validation

- [x] Cover completed, failed, cancelled, timeout, and duplicate `RUN_DUE` cases.
- [x] Cover manual `Run Now` using the same execution path.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
