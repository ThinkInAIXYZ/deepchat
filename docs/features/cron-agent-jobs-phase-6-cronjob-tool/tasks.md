# Tasks

## Tool Schema

- [x] Define zod schemas for all `cronjob` actions.
- [x] Define stable structured result types.
- [x] Add parser-backed validation for schedule preview inputs.

## Tool Handler

- [x] Implement read actions: list, show, history, and preview schedule.
- [x] Use existing tool permission precheck for create, update, delete, pause, resume, and run now.
- [x] Implement approved write execution through Cron Jobs service methods.
- [x] Redact long prompt and delivery details in model-facing summaries.

## Registry And UI

- [x] Register `cronjob` in `AgentToolManager`.
- [x] Reuse existing permission UI instead of adding a cronjob-specific confirmation renderer.
- [x] Ensure the tool is disabled by default and can be enabled through existing local tool controls.

## Tests And Validation

- [x] Cover every action.
- [x] Prove write permission precheck does not mutate state before approval.
- [x] Cover write permission precheck and invalid payload errors.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
