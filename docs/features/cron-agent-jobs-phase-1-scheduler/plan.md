# Implementation Plan

## Phase Boundary

This phase creates the scheduler substrate only. It can merge before cron parsing or agent runtime
integration because due work is represented as persisted `next_run_at` timestamps.

## Module Layout

Add new code under these ownership boundaries:

- `src/shared/cronJobs.ts` for shared domain types.
- `src/shared/contracts/routes/cronJobs.routes.ts` for typed route contracts.
- `src/renderer/api/CronJobsClient.ts` for renderer access.
- `src/main/presenter/cronJobs/` for service, repository, and scheduler manager.
- `src/main/presenter/cronJobs/schedulerHost.ts` for the utility-process entry.
- `src/renderer/settings/components/CronJobsSettings.vue` for the status-first UI.
- `test/main/presenter/cronJobs/` and `test/renderer/api/clients.test.ts` coverage.

Do not keep a second scheduler implementation after Cron Jobs is route-backed.

## Data Model

Create new SQLite tables through the sqlite presenter table catalog and migrations:

```sql
CREATE TABLE cron_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  cron_expr TEXT NOT NULL,
  timezone TEXT NOT NULL,
  agent_id TEXT,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE cron_job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  session_id TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_cron_jobs_enabled_next_run
ON cron_jobs(enabled, next_run_at);

CREATE INDEX idx_cron_job_runs_job_id_created
ON cron_job_runs(job_id, created_at);

CREATE UNIQUE INDEX idx_cron_job_runs_job_slot
ON cron_job_runs(job_id, scheduled_at);
```

The unique slot index is required for crash/reconcile idempotency.

## Scheduler Protocol

Use a serializable message protocol:

```ts
type SchedulerCommand =
  | { type: 'START' }
  | { type: 'STOP'; reason: 'idle' | 'app_quit' | 'restart' }
  | { type: 'RECONCILE'; reason: 'startup' | 'resume' | 'manual' | 'job_changed' }
  | { type: 'JOB_CHANGED'; jobId: string }
  | { type: 'RUN_NOW'; jobId: string }

type SchedulerEvent =
  | { type: 'READY'; pid: number }
  | { type: 'HEARTBEAT'; pid: number; nextRunAt: number | null; enabledJobCount: number }
  | { type: 'RUN_DUE'; jobId: string; runId: string }
  | { type: 'IDLE' }
  | { type: 'ERROR'; error: string; stack?: string }
```

Main owns restart policy, status cache, and mock execution. The utility process owns scans and run
row insertion.

## Lifecycle

1. On app startup, main constructs `CronJobsService` and `SchedulerProcessManager`.
2. `CronJobsService.start()` counts enabled jobs.
3. If enabled count is greater than zero, `SchedulerProcessManager` forks the utility process.
4. `READY` updates status and sends `RECONCILE`.
5. The utility process scans due jobs, inserts queued runs, and emits `RUN_DUE`.
6. Main marks the queued run as mock-completed or mock-failed through the service.
7. When enabled count becomes zero, main schedules a 30 second idle stop.
8. `before-quit` sends `STOP`.
9. `powerMonitor.resume` sends `RECONCILE`.

## Typed Routes

Initial route surface:

- `cronJobs.list`
- `cronJobs.upsert`
- `cronJobs.delete`
- `cronJobs.toggle`
- `cronJobs.runNow`
- `cronJobs.getSchedulerStatus`
- `cronJobs.reconcileScheduler`
- `cronJobs.restartScheduler`

Phase 1 `upsert` accepts `cronExpr`, `timezone`, `enabled`, and optional `nextRunAt`.
Phase 2 replaces permissive schedule handling with parser-backed validation.

## UI Plan

Replace the Scheduled Tasks settings entry only after the Cron Jobs page is route-backed and stable.
If product risk is high, keep both entries for one release and label the old page as compatibility.

The first UI is intentionally operational:

```text
+---------------------------------------------------------+
| Cron Jobs                                               |
| Scheduler: Running | pid 18421                          |
| Enabled: 2 | Next run: 2026-07-03 09:00                 |
| Last heartbeat: 3s ago                                  |
|                                                         |
| [Restart Timer]                                        |
+---------------------------------------------------------+
```

No nested cards. Use existing settings shell, shadcn controls, lucide icons, and i18n keys.
The UI exposes one user-facing scheduler recovery action; lower-level reconcile remains an
internal route for lifecycle hooks and diagnostics.
Schedule-derived next runs are displayed as one read-only preview. The page must not expose manual
date-time editing or a clear-next-run action in Phase 1.

## Compatibility

- New routes use `cronJobs.*`.
- No automatic migration from legacy scheduled tasks.
- Documentation and UI copy must avoid promising agent execution until phase 4.

## Test Strategy

- Unit test repository CRUD and due-run idempotency.
- Unit test `SchedulerProcessManager` start, idle stop, crash restart, and status transitions with
  a mocked utility process.
- Route dispatcher tests for every new route contract.
- Renderer client tests for route names and response parsing.
- Minimal renderer test for running and stopped status states.

## Validation Commands

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- Targeted tests: `pnpm test -- test/main/presenter/cronJobs`
