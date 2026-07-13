# Cron Agent Jobs Phase 6: cronjob Agent Tool

## User Need

Users need agents to create, inspect, update, pause, resume, run, and review Cron Jobs through one
tool without exposing scheduler internals or bypassing user confirmation.

## Goal

Add one local agent tool named `cronjob` that manages the Cron Jobs module:

- Read actions execute directly.
- Write actions return confirmation cards before applying changes.
- The tool calls the same Cron Jobs service routes used by the UI.
- Tool results are structured and safe for model consumption.
- The tool is visible in the tool list but disabled by default for every new DeepChat agent/session.

## Tool Input

```ts
type CronJobToolInput =
  | { action: 'create'; job: CronJobCreateInput }
  | { action: 'list'; filter?: CronJobFilter }
  | { action: 'show'; jobId: string }
  | { action: 'update'; jobId: string; patch: CronJobPatch }
  | { action: 'pause'; jobId: string }
  | { action: 'resume'; jobId: string }
  | { action: 'delete'; jobId: string }
  | { action: 'run_now'; jobId: string }
  | { action: 'history'; jobId: string; limit?: number }
  | { action: 'preview_schedule'; cronExpr: string; timezone: string; count?: number }
```

## Create Input

```ts
type CronJobCreateInput = {
  name: string
  description?: string
  cronExpr: string
  timezone: string
  agentId: string
  prompt: string

  delivery?: JobDelivery
  runtime?: Partial<JobRuntime>
}
```

## Tool Result

```ts
type CronJobToolResult = {
  ok: boolean
  job?: AgentCronJob
  jobs?: AgentCronJob[]
  runs?: CronJobRun[]
  previewRuns?: string[]
  confirmationRequired?: boolean
  confirmationCard?: unknown
  error?: string
}
```

## Acceptance Criteria

- `preview_schedule` returns parser-backed upcoming runs.
- `list`, `show`, and `history` execute without confirmation.
- `create`, `update`, `delete`, `pause`, `resume`, and `run_now` return confirmation cards first.
- Confirming a write executes through the Cron Jobs service and returns the updated result.
- Confirmation cards show schedule, agent, prompt summary, delivery targets, and next runs.
- The tool never exposes utility-process pid, DB paths, scheduler protocol, or low-level locks.
- Tool schemas reject unknown actions and invalid payloads.
- Tool tests cover every action.
- Users must explicitly enable `cronjob` before agents can call it.

## Confirmation Card Shape

```text
+---------------------------------------------------------+
| Create Cron Job                                         |
| Name: Daily DeepChat Issue Triage                       |
| Schedule: 0 0 9 * * * | Asia/Tokyo                      |
| Agent: Issue Triage Agent                               |
| Delivery: Remote channel                                |
| Next runs:                                              |
| - 2026-07-03 09:00                                      |
| - 2026-07-04 09:00                                      |
| - 2026-07-05 09:00                                      |
|                                                         |
| [Create Job] [Edit] [Cancel]                            |
+---------------------------------------------------------+
```

## Non-Goals

- No second scheduling API.
- No direct utility-process controls.
- No write action without confirmation.
- No remote delivery implementation; phase 5 owns delivery.
- No automatic enablement for existing or new agents.

## Constraints

- Register the tool through `AgentToolManager`.
- Use existing local agent tool permission and confirmation patterns.
- Keep user-facing card strings in i18n.
- Redact long prompts and delivery payload internals in model-facing summaries.

## Open Questions

None. Tool write confirmation is mandatory even when the current permission mode is permissive.
