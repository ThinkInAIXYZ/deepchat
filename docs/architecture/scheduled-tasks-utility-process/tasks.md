# Scheduled Tasks Utility Process Tasks

## 0. Review Gate

- [x] Inspect existing scheduled task types, routes, presenter, normalizer, lifecycle hooks, and UI.
- [x] Confirm current storage is `ConfigPresenter` V1 config, not SQLite.
- [x] Confirm the app already has SQLite table/migration/catalog conventions.
- [x] Confirm existing Electron `utilityProcess` host patterns.
- [x] Create SDD documents for the refactor.

## 1. Storage

- [x] Update `src/shared/scheduledTasks.ts` to V2 while keeping V1 `kind` and `body` field names.
- [x] Update scheduled task zod schemas to expose V2 fields.
- [x] Add `scheduled_tasks` SQLite table class with create SQL, indexes, and schema version.
- [x] Add `scheduled_task_runs` SQLite table class with create SQL, indexes, and status helpers.
- [x] Add `scheduled_task_locks` SQLite table class with create SQL and lock helpers.
- [x] Register tables in `SQLitePresenter.initTables()`.
- [x] Register tables in `SQLitePresenter.getMigrationTables()`.
- [x] Register tables in `schemaCatalog.ts`.
- [x] Add `SQLiteSchedulerStore`.
- [x] Add V1 config-to-SQLite migration with a duplicate-import guard.
- [x] Add store tests for migration and run state transitions.

## 2. Scheduler Core

- [x] Add the narrow scheduler store interface used by core and main execution.
- [x] Move next-run calculation into `schedulerCore/computeNextRunAt.ts`.
- [x] Preserve current once, daily, and weekly local-time behavior.
- [x] Add one-run misfire handling for startup, resume, task change, scheduler restart, and run-now.
- [x] Add stale queued/running recovery.
- [x] Add transactional queued-run creation with duplicate prevention.
- [x] Add short-tick scheduler loop.
- [x] Add focused core tests.

## 3. Utility Process

- [x] Add `schedulerProtocol.ts` command and event types.
- [x] Add `schedulerUtility/utilityHost.ts`.
- [x] Add `src/main/scheduledTasksUtilityHostEntry.ts`.
- [x] Add Electron build input for the utility host.
- [x] Implement parent-port transport using the existing utility host message unwrapping pattern.
- [x] Initialize SQLite store in the utility process from START payload.
- [x] Emit ready, heartbeat, due-run, idle, and error events.
- [x] Add process-host coverage where practical through focused tests, typecheck, and full Vitest.

## 4. Main Process

- [x] Add `schedulerProcessManager.ts`.
- [x] Resolve utility host entry point using the existing watcher/background-exec pattern.
- [x] Wire process manager into `ScheduledTasksService`.
- [x] Replace in-process per-task timers with utility reconciliation.
- [x] Delete obsolete timer map and chained 12-hour timeout path.
- [x] Add `executeQueuedRun(taskId, runId)` around existing action execution.
- [x] Keep notify, prompt draft, auto-send, and fallback behavior compatible.
- [x] Add startup, resume, task change, manual reconcile, restart, and quit handling.
- [x] Add duplicate execution guards.

## 5. API And UI

- [x] Keep existing scheduled task routes compatible with the `settings` response envelope.
- [x] Add scheduler status route and client method.
- [x] Add run history route and client method.
- [x] Add reconcile and restart routes if they fit current settings UI patterns.
- [x] Add compact scheduler status display.
- [x] Add per-task latest run display.
- [x] Add failed-run error text.
- [x] Keep scheduled tasks settings layout otherwise unchanged.

## 6. Verification

- [x] Run focused scheduler core tests.
- [x] Run focused SQLite scheduled task store tests; local native SQLite ABI mismatch skips the DB-backed assertions until runner.
- [x] Run focused route tests.
- [x] Run focused renderer scheduled task client tests.
- [x] Run full `pnpm vitest run`.
- [x] Verify notify, prompt draft, auto-send, fallback, startup miss, sleep/resume miss,
  zero-enabled idle, utility crash restart, and `fireNow` through focused service/core coverage.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [ ] Validate packaged Windows and Linux utility-process behavior in CI runner after PR.

## 7. Scheduled Agent Runs P0 Gap

- [x] Update SDD acceptance and plan for first-class scheduled agent runs.
- [x] Add shared action, context, execution, delivery, and route schemas.
- [x] Persist agent-run policies in SQLite and migrate existing rows with defaults.
- [x] Execute `agent_run` through main-process session creation and one scheduled message send.
- [x] Record session ID, output message ID, and output preview in run history.
- [x] Add minimal settings UI controls for `agent_run`, permission, context, and delivery.
- [x] Add a run-history action that opens the agent-run session in the main chat window.
- [x] Add focused service/store coverage and validate the renderer through full Vitest.
- [x] Run format, i18n, lint, typecheck, and relevant Vitest coverage.
