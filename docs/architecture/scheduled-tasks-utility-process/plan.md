# Scheduled Tasks Utility Process Plan

## Decisions

- Use an architecture SDD folder because this is a runtime/process-boundary refactor.
- Store V2 scheduled tasks and runs in the existing app SQLite database.
- Keep the public presenter/service name `ScheduledTasksService`.
- Keep task trigger/action field names compatible with V1 (`kind`, `body`).
- Split scheduler logic into pure core, SQLite store, Electron utility host, and main process
  manager.
- Main process remains the only executor for notifications, prompt drafts, auto-send sessions,
  permissions, model selection, skills, MCP, delivery, and UI events.

## Target Architecture

```txt
+------------------------------------------------------------+
| DeepChat Main Process                                      |
| typed routes | UI events | notifications | agent runtime   |
+-----------------------+------------------------------------+
                        | utilityProcess messages
+-----------------------v------------------------------------+
| Scheduler Utility Process                                  |
| due scan | nextRunAt | run queue | reconciliation          |
+-----------------------+------------------------------------+
                        | SQLite WAL database
+-----------------------v------------------------------------+
| Scheduled Task Store                                       |
| scheduled_tasks | scheduled_task_runs | scheduled_task_locks|
+------------------------------------------------------------+
```

## Data Model

Add SQLite table classes under `src/main/presenter/sqlitePresenter/tables/` and register them in
`SQLitePresenter.initTables()`, `getMigrationTables()`, and `schemaCatalog.ts`.

Tables:

- `scheduled_tasks`: task definition, `version`, `trigger_json`, `action_json`, `timezone`,
  `next_run_at`, `last_run_id`, `last_fired_at`, timestamps.
- `scheduled_task_runs`: queued/running/terminal run history with scheduled/queued/started/completed
  timestamps, reason, optional session/tape/message IDs, preview, and error.
- `scheduled_task_locks`: task-level lock record with run ID, owner, and timestamp.

Indexes:

- `scheduled_tasks(enabled, next_run_at)`
- `scheduled_task_runs(task_id, created_at)`
- `scheduled_task_runs(status)`

Use one new schema version across the table classes. Fresh installs create the tables directly;
existing installs receive create-table migrations through the current migration system.

## Migration

Read V1 config from `ConfigPresenter.getScheduledTasksConfig()` during service startup or store
initialization, then migrate into SQLite once.

Migration rules:

- Preserve `id`, `name`, `enabled`, `trigger`, `action`, `createdAt`, and `lastFiredAt`.
- Add `version = 2`.
- Add `timezone = Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Compute `nextRunAt` for enabled tasks.
- Set `lastRunId = null`.
- Keep V1 config read compatibility long enough to avoid dropping existing users.
- Prevent double-loading by recording a migration marker in SQLite or config after successful import.

## Scheduler Core

Create core code with no Electron imports:

```txt
src/main/presenter/scheduledTasks/
  schedulerTypes.ts
  schedulerProtocol.ts
  schedulerStore.ts
  schedulerCore/
    computeNextRunAt.ts
    reconcileDueTasks.ts
    recoverStaleRuns.ts
    schedulerLoop.ts
```

Core rules:

- Disabled task returns `nextRunAt = null`.
- Once task in the future uses `firesAt`.
- Once task after successful run becomes inactive.
- Daily and weekly keep current local-time behavior.
- Default misfire policy is one run, not historical backfill.
- Scheduler loop uses short DB scans, not per-task long timers.
- Tick delay clamps to 1s minimum and 30s maximum.
- `createQueuedRunWithLock` is transactional and updates `nextRunAt` with run creation.

## Utility Host

Follow existing utility process patterns:

- Add a dedicated entry point like `scheduledTasksUtilityHostEntry.ts`.
- Add it to `electron.vite.config.ts` main rollup input.
- Fork with `utilityProcess.fork`.
- Use `process.parentPort`, `parentPort.start?.()`, and message payload unwrapping like the file
  watcher and background exec hosts.
- Pass DB path and SQLCipher password over the START message, not environment variables.
- Utility sends `READY`, `HEARTBEAT`, `RUN_DUE`, `IDLE`, and `ERROR`.
- Utility never imports notification/session/agent/runtime presenters.

## Main Process Manager

Add `SchedulerProcessManager` owned by `ScheduledTasksService`.

Responsibilities:

- Start when enabled task count is greater than zero.
- Stop after 30s idle grace when enabled count reaches zero.
- Send reconcile on startup, task change, manual reconcile, resume, and scheduler restart.
- Restart crashed utility process with bounded backoff: immediate, 1s, 5s, 15s, then stop after 5
  crashes in 5 minutes.
- Track scheduler status for typed routes and UI.
- Receive `RUN_DUE` and delegate to `ScheduledTasksService.executeQueuedRun(taskId, runId)`.

## Main Execution Path

Add an execution method around existing action logic:

```txt
RUN_DUE
  -> load task and run
  -> skip if run is already running or terminal
  -> mark run running
  -> execute current notify/prompt/autoSend logic
  -> mark success or failed
```

Keep fallback-to-draft inside prompt auto-send handling. A fallback that produces a draft still counts
as successful user-visible delivery unless the existing behavior throws before fallback completes.

For scheduled agent runs, add `agent_run` as a separate action instead of overloading `prompt`.
Execution stays in the main process:

```txt
queued run
  -> create empty session with stored agent/model/context/permission policy
  -> send one scheduled prompt
  -> read the assistant output message when available
  -> mark run success with sessionId/outputMessageId/outputPreview
```

Default context/execution/delivery policies are stored for all tasks so old `notify` and `prompt`
records keep schema compatibility without changing their visible behavior.

## API

Keep existing routes compatible:

- `scheduledTasks.list`
- `scheduledTasks.upsert`
- `scheduledTasks.delete`
- `scheduledTasks.toggle`
- `scheduledTasks.fireNow`

Add minimal routes:

- `scheduledTasks.getSchedulerStatus`
- `scheduledTasks.listRuns`
- `scheduledTasks.openRunSession`
- `scheduledTasks.reconcileNow`
- `scheduledTasks.restartScheduler`

Extend shared schemas to expose V2 scheduler fields without breaking renderer callers that only read
V1 fields.

Agent-run fields:

- `context`: fresh-session context, optional working directory, active skill IDs.
- `execution`: optional agent/model/system prompt, permission profile, concurrency policy, max
  duration.
- `delivery`: inbox/desktop delivery flags and success/failure notification policy.

## Lifecycle

- Replace timer-only `scheduledTasksStartHook` with startup reconciliation through the process
  manager.
- Replace stop hook timer cleanup with utility process stop.
- Add `powerMonitor` resume handling in an existing lifecycle/event setup path.
- On app quit, send STOP and kill the utility process cleanly.

## Implementation Blueprint

### File Change Map

Create:

- `src/main/presenter/sqlitePresenter/tables/scheduledTasks.ts`
- `src/main/presenter/sqlitePresenter/tables/scheduledTaskRuns.ts`
- `src/main/presenter/sqlitePresenter/tables/scheduledTaskLocks.ts`
- `src/main/presenter/scheduledTasks/schedulerTypes.ts`
- `src/main/presenter/scheduledTasks/schedulerProtocol.ts`
- `src/main/presenter/scheduledTasks/schedulerStore.ts`
- `src/main/presenter/scheduledTasks/sqliteSchedulerStore.ts`
- `src/main/presenter/scheduledTasks/schedulerProcessManager.ts`
- `src/main/presenter/scheduledTasks/schedulerCore/computeNextRunAt.ts`
- `src/main/presenter/scheduledTasks/schedulerCore/reconcileDueTasks.ts`
- `src/main/presenter/scheduledTasks/schedulerCore/recoverStaleRuns.ts`
- `src/main/presenter/scheduledTasks/schedulerCore/schedulerLoop.ts`
- `src/main/presenter/scheduledTasks/schedulerUtility/utilityHost.ts`
- `src/main/scheduledTasksUtilityHostEntry.ts`

Edit:

- `src/shared/scheduledTasks.ts`
- `src/shared/contracts/routes/scheduledTasks.routes.ts`
- `src/main/presenter/scheduledTasks/index.ts`
- `src/main/presenter/scheduledTasks/normalize.ts`
- `src/main/presenter/sqlitePresenter/index.ts`
- `src/main/presenter/sqlitePresenter/schemaCatalog.ts`
- `src/main/routes/index.ts`
- `src/main/presenter/lifecyclePresenter/hooks/after-start/scheduledTasksStartHook.ts`
- `src/main/presenter/lifecyclePresenter/hooks/beforeQuit/scheduledTasksStopHook.ts`
- `src/renderer/api/ScheduledTasksClient.ts`
- `src/renderer/settings/components/ScheduledTasksSettings.vue`
- `src/renderer/src/i18n/*/settings.json`
- `electron.vite.config.ts`

Add tests near the touched owner:

- `test/main/presenter/scheduledTasks/computeNextRunAt.test.ts`
- `test/main/presenter/scheduledTasks/sqliteSchedulerStore.test.ts`
- `test/main/presenter/scheduledTasks/schedulerProcessManager.test.ts`
- `test/main/routes/scheduledTasks.test.ts`
- `test/renderer/components/ScheduledTasksSettings.test.ts`
- `test/main/presenter/scheduledTasks.test.ts` coverage for `agent_run` session creation and run
  metadata persistence.

### Shared Types

Keep V1 names and add V2 fields directly to the shared task type. Do not rename `kind` to `type` or
`body` to `message`.

```ts
export const SCHEDULED_TASKS_VERSION = 2 as const

export interface ScheduledTask {
  id: string
  version: 2
  name: string
  enabled: boolean
  trigger: ScheduledTaskTrigger
  action: ScheduledTaskAction
  timezone: string
  nextRunAt: number | null
  lastRunId: string | null
  lastFiredAt: number | null
  createdAt: number
  updatedAt: number
}
```

Run status:

```txt
queued -> running -> success
queued -> running -> failed
queued -> skipped
queued -> cancelled
running -> failed
running -> cancelled
```

Keep `waiting_permission` out of P0 unless the current execution path exposes a reliable transition.
Adding an unused state is not useful.

### Store API

`SQLiteSchedulerStore` is the single implementation. Keep the interface only because the utility
process core and main process execution both need the same narrow port.

Required methods:

- `countEnabledTasks()`
- `listEnabledTasks()`
- `getNearestNextRunAt()`
- `listDueTasks(now)`
- `getTask(taskId)`
- `upsertTask(task)`
- `deleteTask(taskId)`
- `createManualRun(taskId, now)`
- `createQueuedRunWithLock({ task, scheduledAt, reason, owner, now })`
- `markRunRunning(runId, startedAt)`
- `markRunSuccess(...)`
- `markRunFailed(...)`
- `markRunCancelled(runId, completedAt)`
- `recoverStaleRuns({ now, staleQueuedMs, staleRunningMs })`
- `listRuns(taskId, limit)`

### Transaction Rule

`createQueuedRunWithLock` is the duplicate-prevention point:

```txt
BEGIN
  read task by id
  reject missing, disabled, null next_run_at, or next_run_at > now
  insert or verify lock for task_id
  insert run with status queued
  compute following next_run_at
  update task last_run_id, last_fired_at, next_run_at, enabled
  delete lock or leave lock owner data only while transaction needs it
COMMIT
```

For recurring tasks, compute only the next future occurrence. Do not backfill multiple missed days or
weeks.

### Protocol

Use plain discriminated unions:

```txt
Command: START | STOP | RECONCILE | TASK_CHANGED | RUN_NOW
Event: READY | HEARTBEAT | RUN_DUE | IDLE | ERROR
```

`START` payload:

- `dbPath`
- `dbPassword`
- `owner`
- `staleQueuedMs`
- `staleRunningMs`

`RUN_DUE` payload:

- `taskId`
- `runId`

No request/response RPC framework is needed. The scheduler is event-driven and has few commands.

### Process Manager Details

Use the same entry-point resolution shape as `watcherHostClient.ts`:

```txt
appPath/out/main/scheduledTasksUtilityHost.js
appPath/scheduledTasksUtilityHost.js
dirname(import.meta.url)/scheduledTasksUtilityHost.js
process.cwd()/out/main/scheduledTasksUtilityHost.js
```

Status is in memory:

```ts
type SchedulerProcessState = 'stopped' | 'starting' | 'running' | 'idle' | 'crashed'
```

Expose this status through a route; do not persist it.

### Service Refactor

Keep `ScheduledTasksService` as the route-facing API:

- `list()` reads tasks from SQLite and returns the route-compatible settings envelope.
- `upsert()` validates with existing zod schemas, persists V2 task, then calls
  `processManager.onTaskChanged(task.id)`.
- `delete()` removes the task and calls idle stop check.
- `toggle()` updates enabled state and recomputes `nextRunAt`.
- `fireNow()` creates a manual run and executes the same queued-run path in main process.
- `executeQueuedRun(taskId, runId)` marks running, dispatches the existing action, then marks
  terminal status.

The old per-task timer map should be deleted after process-manager wiring replaces it.

### Route Contract Details

Existing route outputs keep the `settings` wrapper:

```txt
{ settings: { version: 2, tasks: ScheduledTask[] } }
```

New routes:

```txt
scheduledTasks.getSchedulerStatus -> { status }
scheduledTasks.listRuns           -> { runs }
scheduledTasks.reconcileNow       -> { status }
scheduledTasks.restartScheduler   -> { status }
```

`listRuns` input: `{ taskId: string, limit?: number }`, clamp limit to a small value such as `20`.

### Renderer Surface

Keep the settings page structure. Add only:

```txt
+-- Scheduler ------------------------------------------+
| Status: Running | Next: 2026-07-03 09:00              |
| [Reconcile now] [Restart]                             |
+-------------------------------------------------------+
```

Per task, show latest run status and error text if available. Full history can be collapsible or
loaded on demand.

### Implementation Order

1. Add SQLite tables and store tests.
2. Add shared V2 types and migration.
3. Add pure scheduler core tests.
4. Add utility host and process manager.
5. Refactor `ScheduledTasksService` around SQLite store and queued execution.
6. Add route contracts and renderer client.
7. Add minimal settings UI.
8. Run focused tests, then repo checks.

## Test Strategy

- Core tests for `computeNextRunAt` once/daily/weekly/disabled cases.
- Migration tests for V1 notify and prompt tasks.
- SQLite store tests for atomic queued run creation, duplicate prevention, disabled tasks, future
  tasks, status transitions, and run listing.
- Process manager tests for start/idle stop/crash restart/resume command behavior.
- Route tests for status and run history contracts.
- Renderer tests only for the small status/history display.

Manual acceptance should cover existing notify, draft prompt, auto-send, auto-send fallback, startup
miss, sleep/resume miss, zero-enabled idle state, utility crash restart, and `fireNow`.

## Risks

- Opening SQLCipher SQLite from both main and utility processes must use the existing password and WAL
  configuration consistently.
- Route output schemas currently describe V1 fields; V2 fields must be explicit or they will not
  reliably reach the renderer.
- Duplicate prevention belongs in the SQLite transaction, not in process memory.
- Utility process entry points must be included in the Electron build or production forks will fail.
