# Tasks

## Tool Schema

- [ ] Define zod schemas for all `cronjob` actions.
- [ ] Define stable structured result types.
- [ ] Add parser-backed validation for schedule preview inputs.

## Tool Handler

- [ ] Implement read actions: list, show, history, and preview schedule.
- [ ] Implement confirmation card creation for create, update, delete, pause, resume, and run now.
- [ ] Implement confirmed write execution through Cron Jobs service methods.
- [ ] Redact long prompt and delivery details in model-facing summaries.

## Registry And UI

- [ ] Register `cronjob` in `AgentToolManager`.
- [ ] Add confirmation card renderer and i18n strings.
- [ ] Ensure the tool can be disabled through existing local tool controls.

## Tests And Validation

- [ ] Cover every action.
- [ ] Prove write previews do not mutate state before confirmation.
- [ ] Cover denied confirmation and invalid payload errors.
- [ ] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
