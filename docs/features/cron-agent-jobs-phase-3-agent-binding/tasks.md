# Tasks

## Domain And Persistence

- [ ] Extend shared Cron Jobs types with agent, task, runtime, and status fields.
- [ ] Add migrations for task, policy, runtime, and snapshot columns.
- [ ] Normalize existing rows without agents into disabled or `invalid_agent` state.

## Runtime Resolution

- [ ] Implement `CronJobRuntimeResolver`.
- [ ] Resolve current agent config in follow mode.
- [ ] Capture and use sanitized runtime snapshots.
- [ ] Revalidate jobs on agent update, disable, and delete paths.

## Routes And UI

- [ ] Update create/update/toggle validation to require a valid agent for enabled jobs.
- [ ] Add agent selector and runtime policy controls.
- [ ] Add invalid-agent list and editor states.
- [ ] Add i18n keys.

## Tests And Validation

- [ ] Cover resolver success and failure paths.
- [ ] Cover follow vs snapshot policy behavior.
- [ ] Cover invalid jobs being excluded from scheduler runnable counts.
- [ ] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
