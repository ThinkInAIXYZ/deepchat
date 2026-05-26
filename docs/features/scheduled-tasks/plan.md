# Implementation Plan

## Architecture

- **Shared types** (`src/shared/scheduledTasks.ts`) define the `Trigger`,
  `Action`, `ScheduledTask`, and `ScheduledTasksSettings` shapes.
- **Route contracts** (`src/shared/contracts/routes/scheduledTasks.routes.ts`)
  expose `scheduledTasks.{list,upsert,delete,toggle,fireNow}` via Zod
  schemas, mirroring `onboarding.routes.ts`.
- **Persistence** is handled in `ConfigPresenter` (`get/setScheduledTasks`)
  with a `normalizeScheduledTasksConfig` pass identical in pattern to
  `normalizeHooksNotificationsConfig`.
- **Scheduling** lives in a new `ScheduledTasksService`
  (`src/main/presenter/scheduledTasks/index.ts`). One `setTimeout` per
  armed task, chained at most 12h at a time. Public surface:
  - `start()` — read tasks, run startup pass (one-shot backfill, arm next
    slot for recurring), called from the existing lifecycle init flow.
  - `stop()` — clear all armed timers (called on app shutdown).
  - `list()` / `upsert(task)` / `delete(id)` / `toggle(id, enabled)` /
    `fireNow(id)` — back the IPC routes and rearm timers on mutation.
  - `computeNextFireAt(task, after)` — pure function, exported for tests.
- **Action dispatch** is a small helper inside the service: switch on
  `task.action.kind`, then call `notificationPresenter` and/or
  `eventBus.sendToRenderer(DEEPLINK_EVENTS.START, ...)` and/or
  `sessionService.createSession(...)`.

## Wiring

- `Presenter` constructor (`src/main/presenter/index.ts`) instantiates
  `ScheduledTasksService` next to `hooksNotifications`, passing it
  `configPresenter`, `notificationPresenter`, `windowPresenter`, and a
  thunk that resolves `sessionService` lazily (the route runtime owns
  sessionService, so the service exposes a setter the route runtime calls
  during bootstrap).
- `src/main/routes/index.ts` wires the five new route cases against
  `runtime.scheduledTasksService` and, in the same place that constructs
  the runtime, sets the service's session-service reference so auto-send
  has somewhere to call.
- Lifecycle `after-start` hook invokes `scheduledTasksService.start()`
  after the other presenters have come up; the existing `beforeQuit` hook
  calls `stop()`.

## UI

- Settings navigation adds `settings-scheduled-tasks` (group `tools`,
  position 5.6, icon `lucide:clock-9`).
- `ScheduledTasksSettings.vue` mirrors `NotificationsHooksSettings.vue`:
  ScrollArea + header + "新建任务" button + bordered cards per task.
- A renderer client `ScheduledTasksClient.ts` matches the
  `OnboardingClient` shape.
- i18n keys go in every locale under `routes.settings-scheduled-tasks` and
  `settings.scheduledTasks.*` so `pnpm run i18n` stays green.

## Validation

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- Unit tests in `test/main/presenter/scheduledTasks.test.ts` cover
  `computeNextFireAt` (daily wrap, weekly across the week, one-shot past
  with/without `lastFiredAt`) and `normalizeScheduledTasksConfig`
  (drops malformed entries, deduplicates ids, preserves valid ones).
