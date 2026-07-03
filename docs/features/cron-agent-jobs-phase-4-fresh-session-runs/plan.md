# Implementation Plan

## Phase Boundary

This phase depends on agent-bound jobs from phase 3. It is the first phase where Cron Jobs produce
real DeepChat sessions.

## Execution Service

Add `CronJobRunExecutor` in main:

1. Claim a queued run atomically.
2. Load job and resolve runtime through `CronJobRuntimeResolver`.
3. Enforce concurrency policy:
   - `skip`: fail or cancel the new run if another run is active for the same job.
   - `queue`: leave queued until the active run completes.
4. Create a fresh detached session through the existing agent session presenter.
5. Store `sessionId` on the run.
6. Start the job prompt through the existing `sendMessage` path.
7. Capture assistant message id and preview from session updates.
8. Mark run completed or failed when the session reaches a terminal runtime state.
9. Advance `next_run_at`.

## Data Model Changes

Extend `cron_job_runs`:

```sql
ALTER TABLE cron_job_runs ADD COLUMN session_id TEXT;
ALTER TABLE cron_job_runs ADD COLUMN output_message_id TEXT;
ALTER TABLE cron_job_runs ADD COLUMN output_preview TEXT;
ALTER TABLE cron_job_runs ADD COLUMN parent_continuation_session_id TEXT;
ALTER TABLE cron_job_runs ADD COLUMN claimed_at INTEGER;
ALTER TABLE cron_job_runs ADD COLUMN claim_owner TEXT;
```

Add session metadata storage if no generic session metadata exists:

```sql
CREATE TABLE deepchat_session_metadata (
  session_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

## Run Claiming

Use a transactional claim:

```text
UPDATE cron_job_runs
SET status = 'running', started_at = now, claimed_at = now, claim_owner = owner
WHERE id = runId AND status = 'queued'
```

Only the process that changes one row proceeds.

## Run History Routes

Add:

- `cronJobs.listRuns`
- `cronJobs.getRun`
- `cronJobs.openRunSession`
- `cronJobs.continueRun`

`continueRun` activates the existing session and should not create a new one.

## UI Plan

Add run history and run detail:

```text
+---------------------------------------------------------+
| Runs                                                    |
| completed  Daily Issue Triage  2026-07-03 09:00  2m 14s  |
| failed   Daily Issue Triage  2026-07-02 09:00  error    |
| queued   Weekly Release      2026-07-03 18:00  pending  |
+---------------------------------------------------------+
```

Detail view:

```text
+---------------------------------------------------------+
| Cron Run                                                |
| Job: Daily Issue Triage                                 |
| Status: completed | Duration: 2m 14s                      |
| Session: Open                                           |
|                                                         |
| Output                                                  |
| 3 issues need attention...                              |
|                                                         |
| [Continue Session] [Run Again]                          |
+---------------------------------------------------------+
```

## Compatibility

- Legacy auto-send scheduled tasks still use their old session creator until explicitly migrated.
- Cron Job sessions are regular sessions with metadata, not subagent sessions.

## Test Strategy

- Executor tests for queued claim, duplicate run protection, completed, failure, and permission wait.
- Integration-style tests with a mocked agent session presenter port.
- Repository tests for run history pagination and metadata persistence.
- Renderer tests for history list and run detail actions.

## Validation Commands

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm test -- test/main/presenter/cronJobs`
- `pnpm test -- test/main/routes`
- `pnpm test -- test/renderer`
