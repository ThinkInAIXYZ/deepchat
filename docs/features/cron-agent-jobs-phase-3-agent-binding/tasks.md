# Tasks

## Domain And Persistence

- [x] Extend shared Cron Jobs types with agent, task, runtime, and status fields.
- [x] Add migrations for task, policy, runtime, and snapshot columns.
- [x] Normalize existing rows without agents into disabled or `invalid_agent` state.

## Runtime Resolution

- [x] Implement `CronJobRuntimeResolver`.
- [x] Resolve current agent config in follow mode.
- [x] Capture and use sanitized runtime snapshots.
- [x] Revalidate jobs on agent update, disable, and delete paths.

## Routes And UI

- [x] Update create/update/toggle validation to require a valid agent for enabled jobs.
- [x] Add agent selector and runtime policy controls.
- [x] Add invalid-agent list and editor states.
- [x] Add i18n keys.

## Tests And Validation

- [x] Cover resolver success and failure paths.
- [x] Cover follow vs snapshot policy behavior.
- [x] Cover invalid jobs being excluded from scheduler runnable counts.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
