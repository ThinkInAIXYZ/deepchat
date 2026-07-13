# Cron Agent Jobs — Maintained Feature Contract

> Status: implemented. This document consolidates the maintained contracts from the original
> scheduler, cron trigger, agent binding, detached-run, delivery, tool, expression-editor, and
> timezone slices. Current runtime flow is also summarized in [FLOWS.md](../../FLOWS.md#8-scheduled-tasks).

## User Need

Users need scheduled agent work that runs independently of renderer lifetime, produces an
inspectable DeepChat session for every run, and can optionally deliver a notification through an
existing Remote binding.

## Current Ownership

- `CronJobsService` owns scheduling orchestration, job/run state, runtime resolution, execution, and
  delivery coordination under `src/main/presenter/cronJobs/`.
- SQLite owns `cron_jobs`, `cron_job_runs`, and delivery receipts.
- The `deepchat-scheduler` Electron utility process only discovers due jobs and reports `RUN_DUE`;
  it never executes models, tools, notifications, or Remote delivery.
- Typed `cronJobs.*` routes and `CronJobsClient` serve the settings UI.
- A run creates a detached app session through the normal agent session façade and typed backend
  router. DeepChat and direct ACP jobs therefore use the same backend selection rules as interactive
  sessions.
- `RemoteControlPresenter` is the delivery boundary. Delivery is notification-only and does not
  join normal Remote conversation context.

```text
settings / cronjob tool
  -> typed Cron Jobs service operations
  -> SQLite job and run state
  -> scheduler utility discovers due slot
  -> main process claims run
  -> create fresh detached app session
  -> send task prompt through the selected agent backend
  -> persist terminal run output
  -> optional Remote notification and delivery receipt
```

## Scheduler Contract

- With no enabled runnable jobs, the scheduler is stopped or idle and consumes no per-job timer.
- Creating or enabling a runnable job starts or reconciles the scheduler after app readiness.
- Due discovery is based on persisted `nextRunAt`; queueing the same job and scheduled slot is
  idempotent.
- Startup, job changes, explicit restart, and OS resume reconcile scheduler state.
- Utility-process failure is surfaced in scheduler status and uses bounded restart behavior while
  runnable jobs remain.
- The utility process receives only the narrow scheduler protocol and database access required for
  due discovery.

## Schedule Contract

- The persisted schedule is one cron expression plus one IANA timezone.
- The raw cron expression is the only editable schedule representation. The UI may show read-only
  common examples, but it does not maintain a second visual-picker or preset state.
- New jobs default to `* * * * *`; the timezone uses the selected IANA identifier and defaults to
  `UTC` when omitted by a lower-level caller.
- Validation and next-run preview use the same main-process cron parser as execution.
- Invalid schedules cannot become runnable and expose a schedule error.
- Misfire behavior remains explicit: `skip` advances past missed slots, while `run_once` queues a
  bounded catch-up according to the persisted policy.
- Changing the expression or timezone recomputes `nextRunAt` and the preview.

## Agent Binding And Runtime Contract

- A runnable job resolves an enabled agent. Missing, disabled, or malformed agents produce
  `invalid_agent`; they never silently fall back to the built-in DeepChat agent.
- Runtime settings include maximum duration, maximum turns, and `skip | queue` concurrency policy.
- Model, tool, and permission policies can follow the current agent or use the persisted snapshot
  shape supported by the current contract.
- Agent configuration changes affect the next run when the corresponding policy follows the agent.
- Agent deletion or availability changes reconcile affected jobs before they run.

## Run Contract

- Scheduled and manual `Run Now` operations use the same persisted queue and execution path.
- Every claimed run creates a fresh detached session before sending the task prompt; repeated runs
  of one job create separate sessions.
- `cron_job_runs.sessionId` is persisted as soon as session creation succeeds, so failed runs remain
  inspectable when a session already exists.
- Run transitions use the maintained states `queued`, `running`, `completed`, `failed`, and
  `cancelled`.
- Duplicate scheduler events cannot execute the same run twice.
- Timeout and cancellation use the normal agent cancellation boundary and retain a terminal run
  record.
- Run history exposes output preview, output message identity, timestamps, and errors without
  copying provider credentials or raw internal runtime state.

## Remote Delivery Contract

- A job may target zero or more enabled Remote bindings in `summary` or `full` mode.
- Each target produces an independent success or failure receipt.
- Delivery failure is recorded without rewriting a completed agent result.
- Scheduled output is an outbound notification only. It does not become inbound Remote context and
  cannot continue the detached session through a channel reply.
- Delivery records never persist provider or channel secrets.

## `cronjob` Agent Tool Contract

- The local tool exposes `create`, `list`, `show`, `update`, `pause`, `resume`, `delete`, `run_now`,
  `history`, and `preview_schedule`.
- Read actions (`list`, `show`, `history`, and `preview_schedule`) execute without confirmation through
  the same Cron Jobs service ports as the UI.
- Every write action (`create`, `update`, `delete`, `pause`, `resume`, and `run_now`) first returns a
  confirmation request and performs no mutation until the user confirms it. This mandatory action
  confirmation remains in force even when the session uses a permissive tool-permission mode.
- The confirmation presents the schedule and timezone, selected agent, bounded prompt summary,
  delivery targets, and upcoming run times applicable to the action. Rejection or an unanswered
  confirmation leaves persisted job and run state unchanged.
- Confirmed writes still pass through the existing tool-permission review before mutation.
- Tool schemas reject unknown actions and invalid payloads, and model-facing results omit scheduler
  process details, database paths, locks, and full task text beyond bounded previews.
- The `cronjob` tool is visible in tool selection but disabled by default. It requires explicit user
  enablement and is never enabled automatically by a migration, agent profile, or permissive
  permission setting. Once enabled, availability follows the normal agent-tool selection and
  disabled-tool policy; it does not bypass session configuration.

## User-Facing Acceptance Criteria

- Settings can list, create, update, enable, pause, delete, and run jobs immediately.
- The editor provides one cron expression field, an IANA timezone selector, validation feedback,
  common expression references, and upcoming-run previews.
- Users can bind a valid agent, enter the task prompt, configure runtime limits, and select existing
  Remote delivery targets.
- Scheduler status and recent run history remain inspectable without restarting the app.
- A completed run opens as an ordinary stored session with its user prompt, assistant response, tool
  activity, and terminal status.
- All user-visible labels and errors use i18n keys.

## Non-Goals

- No second visual cron builder or UI-only schedule mode.
- No model/tool execution inside the scheduler utility process.
- No fallback to an unrelated agent when the bound agent is unavailable.
- No new Remote protocol and no inbound Remote continuation of a scheduled run.
- No provider-specific execution path outside the typed agent backend router.

## Regression Evidence

The maintained behavior is covered by:

- `test/main/presenter/cronJobs.test.ts`
- `test/main/routes/dispatcher.test.ts`
- `test/main/presenter/toolPresenter/toolPresenter.test.ts`
- `test/renderer/api/cronJobsClient.test.ts`
- the scheduled-task renderer component tests
