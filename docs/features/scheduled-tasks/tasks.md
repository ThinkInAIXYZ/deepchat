# Tasks

- [x] Add SDD artifacts.
- [ ] Define shared types (`src/shared/scheduledTasks.ts`) and route contracts.
- [ ] Implement `ScheduledTasksService` (presenter + `computeNextFireAt` + action dispatch).
- [ ] Wire `ConfigPresenter` persistence (`scheduledTasks` key) with normalize-on-read.
- [ ] Register routes in `src/main/routes/index.ts` and instantiate in `Presenter` constructor.
- [ ] Hook lifecycle: start on `after-start`, stop on `beforeQuit`.
- [ ] Add renderer client `src/renderer/api/ScheduledTasksClient.ts`.
- [ ] Add settings navigation entry and dynamic route component.
- [ ] Implement `ScheduledTasksSettings.vue` (CRUD, mirror NotificationsHooks layout).
- [ ] Add i18n keys across all locales.
- [ ] Unit tests for `computeNextFireAt` and `normalizeScheduledTasksConfig`.
- [ ] Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`.
