# Tasks

- [x] Add SDD artifacts.
- [x] Define shared types (`src/shared/scheduledTasks.ts`) and route contracts.
- [x] Implement `ScheduledTasksService` (presenter + `computeNextFireAt` + action dispatch).
- [x] Wire `ConfigPresenter` persistence (`scheduledTasks` key) with normalize-on-read.
- [x] Register routes in `src/main/routes/index.ts` and instantiate in `Presenter` constructor.
- [x] Hook lifecycle: start on `after-start`, stop on `beforeQuit`.
- [x] Add renderer client `src/renderer/api/ScheduledTasksClient.ts`.
- [x] Add settings navigation entry and dynamic route component.
- [x] Implement `ScheduledTasksSettings.vue` (CRUD, mirror NotificationsHooks layout).
- [x] Add i18n keys across all locales.
- [x] Unit tests for `computeNextFireAt` and `normalizeScheduledTasksConfig`.
- [x] Add service tests for notification firing, one-shot disable, and prompt auto-send dispatch.
- [x] Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`.
- [x] Address PR review comments without changing scheduled-task behavior.
