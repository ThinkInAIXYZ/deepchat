# Cron Agent Jobs Phase 4: Fresh Session Runs

## User Need

Users need every scheduled run to produce an inspectable DeepChat session with the job prompt,
agent response, tool calls, permissions, and final output tied back to the job run.

## Goal

Replace phase 1's mock execution with real agent execution:

- Each `RUN_DUE` creates a fresh session.
- The first user message is the job prompt.
- The bound agent runs through the normal DeepChat runtime.
- The run row records lifecycle status, `sessionId`, output preview, and failure details.
- Manual `Run Now` uses the same execution path.

## Run Model

```ts
type CronJobRun = {
  id: string
  jobId: string
  sessionId: string | null

  scheduledAt: number
  startedAt: number | null
  completedAt: number | null

  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'waiting_permission'

  outputMessageId?: string
  outputPreview?: string
  error?: string
}
```

## Session Metadata

Add a maintained metadata shape for sessions created by Cron Jobs:

```ts
type SessionMetadata = {
  source: 'cron_job'
  cronJobId: string
  cronJobRunId: string
  scheduledAt: number
}
```

If the current `new_sessions` table cannot store this cleanly, add a generic session metadata column
or side table rather than overloading `subagent_meta_json`.

## Acceptance Criteria

- Every due run creates a new session before sending the job prompt.
- `cron_job_runs.session_id` is set as soon as session creation succeeds.
- The session contains the job prompt, assistant response, and tool calls.
- Multiple runs of the same job create multiple sessions.
- Run status transitions are persisted: `queued -> running -> completed|failed|waiting_permission`.
- A failed run keeps `sessionId` if session creation already happened.
- Duplicate `RUN_DUE` events for the same run do not start duplicate sessions.
- Manual `Run Now` follows the same queued-run execution path.
- The job editor shows compact run history by timestamp.

## UX Shape

```text
+---------------------------------------------------------+
| Job Run                                                 |
| Daily Issue Triage                                      |
| Run: 2026-07-03 09:00 | completed | 2m 14s                |
| Session: #cron-run-8f31                                 |
|                                                         |
| Result                                                  |
| - 3 new issues need triage                              |
| - 1 regression likely related to provider routing       |
|                                                         |
| Session: created for internal run inspection             |
+---------------------------------------------------------+
```

## Non-Goals

- No remote delivery.
- No inbound remote continuation.
- No `cronjob` agent tool.
- No multi-run catch-up UI beyond history list.

## Constraints

- Reuse `SessionService` and `ChatService`; do not create a second agent runtime path.
- Respect agent permission behavior. Jobs must not bypass user approval flows.
- Enforce `runtime.maxDurationMs`, `maxTurns`, and `concurrencyPolicy`.
- Use run-level locking to prevent duplicate starts.

## Open Questions

None. If a provider requires UI interaction, the run enters `waiting_permission` rather than being
silently skipped.
