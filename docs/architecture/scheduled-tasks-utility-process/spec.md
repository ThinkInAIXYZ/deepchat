# Scheduled Tasks Utility Process Refactor

Status: proposed
Date: 2026-07-02

## User Need

Scheduled tasks must survive timer loss, app restart, sleep/resume, and scheduler process crashes
without moving notification, prompt draft, auto-send, permission, model, skill, MCP, or agent runtime
execution out of the DeepChat main process.

## Current Behavior

- Scheduled tasks are V1 objects stored by `ConfigPresenter` under the `scheduledTasks` key.
- Public task APIs are typed routes: `scheduledTasks.list`, `upsert`, `delete`, `toggle`, and
  `fireNow`.
- `ScheduledTasksService` owns both scheduling and execution in the main process.
- Scheduling uses per-task `setTimeout`, a 12-hour chained timeout cap, and a 1-minute drift
  tolerance.
- Startup backfills only unfired one-shot tasks whose `firesAt` is already past.
- Once tasks disable after firing; recurring tasks re-arm after firing.
- Actions are `notify` and `prompt`; prompt can create and auto-send through the route runtime.
- DeepChat already has an app SQLite database via `SQLitePresenter`, SQLCipher support, WAL mode,
  table classes under `src/main/presenter/sqlitePresenter/tables/`, and existing
  `utilityProcess` host patterns for file watcher and background exec workers.

## Goal

Move scheduled task discovery and run queue creation into an Electron `utilityProcess` that starts
only while enabled scheduled tasks exist. Keep actual task execution in the main process.

Future standalone daemon work should replace only the host/transport layer, not scheduler core logic,
task storage, run storage, or the due-run protocol.

## Acceptance Criteria

- Existing scheduled tasks migrate without losing IDs, triggers, actions, enabled state, or
  `lastFiredAt`.
- Existing `list`, `upsert`, `delete`, `toggle`, and `fireNow` routes keep working for current
  renderer consumers.
- Enabled tasks persist a computed `nextRunAt`; disabled tasks have `nextRunAt = null`.
- The scheduler utility process is stopped when there are no enabled tasks.
- Creating or enabling the first task starts the utility process.
- Disabling or deleting the last enabled task stops the process after a short idle grace.
- App startup reconciles due tasks from persistent storage.
- OS resume reconciles due tasks from persistent storage.
- Utility process crash restarts with bounded backoff when enabled tasks remain.
- Stale queued/running runs recover on startup, resume, and scheduler restart.
- Due scans create persistent run records before asking main to execute.
- The same scheduled occurrence cannot create duplicate queued runs.
- Main process skips duplicate `RUN_DUE` execution for already-running or terminal runs.
- Notify, prompt draft, and prompt auto-send behavior stays compatible with current behavior,
  including auto-send fallback to draft.
- Once tasks fire once and become inactive according to current behavior.
- Daily and weekly tasks keep current local-time semantics.
- Run history exposes recent success/failure/skipped state and useful error text.
- Scheduler status exposes stopped/starting/running/idle/crashed, enabled count, and next run time.
- No scheduler utility process directly shows UI, sends notifications, invokes tools, opens sessions,
  or runs agent code.
- `agent_run` is a first-class scheduled action that creates an auditable DeepChat agent session,
  sends exactly one scheduled prompt, and records the resulting session and output message metadata.
- Scheduled tasks persist minimal execution context, permission profile, concurrency policy, and
  delivery policy alongside the trigger and action.
- Run records bind successful agent runs to `sessionId`, optional `outputMessageId`, and an
  `outputPreview` suitable for history and follow-up entry points.
- Run history can open a successful agent-run session in the main chat window so the user can audit
  and continue the conversation.
- Prompt and notify tasks remain backward-compatible and receive default context/execution/delivery
  policy during migration or normalization.

## Constraints

- Use the existing app SQLite layer, not a second storage system.
- Keep current trigger/action discriminator names (`kind`) unless a migration requires otherwise.
- Keep current notify action field name (`body`) for compatibility.
- Use `SQLitePresenter` table/migration conventions for scheduler tables.
- Use `utilityProcess.fork` and `process.parentPort` conventions already present in the repo.
- Do not add cron parsing, OS scheduler integration, remote sync, pipeline tasks, or a broad UI
  redesign in this pass.
- Do not split the implementation into separate PRs.
- Technical strings, schema names, and code comments stay in English.
- Keep scheduled agent runs inside the main process execution path; the utility process only queues
  due runs.
- Permission profiles are stored as product policy. P0 maps them to current session permission modes
  conservatively instead of adding new runtime permission states.

## UI Target

Before:

```txt
+-- Scheduled Tasks --------------------------+
| Task list and editor                         |
| Per-task enabled toggle and Fire Now action  |
+----------------------------------------------+
```

After:

```txt
+-- Scheduled Tasks ------------------------------------+
| Scheduler: Running | Utility Process | pid 18421       |
| Enabled tasks: 3 | Next run: 2026-07-03 09:00          |
| [Reconcile now] [Restart scheduler]                    |
+--------------------------------------------------------+
| Task list and editor                                   |
| Latest run: success | 2026-07-02 09:00                 |
+--------------------------------------------------------+
```

No enabled tasks:

```txt
+-- Scheduled Tasks ------------------------------------+
| Scheduler: Stopped                                    |
| Create or enable a task to start scheduled execution.  |
+--------------------------------------------------------+
```

## Non-goals

- Standalone daemon.
- launchd, systemd, Windows Task Scheduler, or per-task OS triggers.
- Cron UI or cron parser.
- Natural-language task creation.
- Multi-device task sync.
- Moving agent runtime, permission, model, skill, or MCP execution into the scheduler host.
- Reworking scheduled task settings layout beyond status and minimal history.
- Script tasks, pipelines, event triggers, remote continuation, multi-device inbox sync, cron/rrule,
  and Hermes-level distributed orchestration.

## Open Questions

None.
