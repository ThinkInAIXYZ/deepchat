# Cron Agent Jobs Phase 1: Scheduler Process

## User Need

Users need a reliable Cron Jobs foundation that can discover due jobs without tying scheduling
accuracy to renderer lifetime, settings UI state, or one main-process timeout per task.

## Goal

Introduce the first independently mergeable slice of the Cron Jobs / Agent Jobs module:

- A SQLite-backed `cron_jobs` and `cron_job_runs` store.
- A main-process `SchedulerProcessManager`.
- An Electron `utilityProcess` named `deepchat-scheduler`.
- A typed scheduler protocol where the utility process only discovers due jobs and queues runs.
- A minimal Cron Jobs status UI that shows scheduler state.

The main process owns job execution. In this phase execution remains a mock action after receiving
`RUN_DUE`; no agent runtime work is performed yet.

## Current State

The removed legacy scheduled-task service used ConfigPresenter timers. Cron Jobs is the only
scheduler surface going forward and stores schedules in SQLite.

## Acceptance Criteria

- With zero enabled cron jobs, `deepchat-scheduler` is stopped.
- Creating or enabling the first cron job starts `deepchat-scheduler` after the app is ready.
- Disabling or deleting the last enabled cron job stops the scheduler within 30 seconds.
- The scheduler scans only `next_run_at <= Date.now()` jobs and creates `queued` runs.
- Queued run creation is idempotent for the same `(job_id, scheduled_at)` slot.
- Main receives `RUN_DUE` with `jobId` and `runId`.
- App startup and OS resume trigger `RECONCILE`.
- Utility-process crash is detected and restarted with bounded backoff while enabled jobs remain.
- Scheduler status is available through a typed route and rendered in the Cron Jobs page.
- The Cron Jobs page renders schedule-derived next runs as a read-only indicator, not a
  user-editable schedule setting.

## UX Shape

Running state:

```text
+---------------------------------------------------------+
| Cron Jobs                                               |
| Scheduler: Running | utilityProcess | pid 18421         |
| Enabled jobs: 2 | Next run: 2026-07-03 09:00            |
|                                                         |
| [New Job] [Restart Timer]                               |
+---------------------------------------------------------+
```

Stopped state:

```text
+---------------------------------------------------------+
| Cron Jobs                                               |
| Scheduler: Stopped                                      |
| Create or enable a cron job to start the scheduler.     |
|                                                         |
| [New Job]                                               |
+---------------------------------------------------------+
```

## Non-Goals

- No cron expression parser.
- No schedule editor beyond minimal data needed to exercise scheduler state.
- No agent binding, permission resolution, or real session execution.
- No delivery, remote continuation, or `cronjob` agent tool.
- Legacy scheduled-task cleanup is handled by `docs/issues/remove-legacy-scheduled-tasks`.

## Constraints

- Use typed routes, typed contracts, and renderer `api/*Client`.
- Do not introduce legacy IPC or `useLegacyPresenter()` paths.
- The scheduler utility process must not execute model, tool, notification, or remote delivery logic.
- If the database is encrypted, the utility process must open its own connection through a
  narrowly scoped scheduler DB adapter and must not log database credentials.
- `utilityProcess.fork()` must be invoked only after Electron app `ready`.

## References

- Electron `utilityProcess` creates a Node-enabled child process and supports message passing:
  https://www.electronjs.org/docs/latest/api/utility-process

## Open Questions

None. Phase 1 deliberately keeps execution mocked so later phases can replace the mock without
reworking the scheduler lifecycle.
