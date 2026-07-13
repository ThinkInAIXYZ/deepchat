# Cron Agent Jobs Phase 3: Agent Binding

## User Need

Users need a scheduled job to run as a specific DeepChat agent, with model, tools, MCP servers,
skills, permission mode, and workspace behavior resolved from that agent.

## Goal

Turn a scheduled cron job into an agent-bound job definition:

- Every enabled job must reference a valid `agentId`.
- Runtime settings default to following the current agent config.
- Snapshot policies preserve a stable runtime when requested.
- Deleted or disabled agents make affected jobs invalid instead of silently running a fallback.

## Job Model

```ts
type AgentCronJob = {
  id: string
  name: string
  description?: string
  enabled: boolean
  status: 'ready' | 'disabled' | 'invalid_agent'

  schedule: {
    cronExpr: string
    timezone: string
    misfirePolicy: 'skip' | 'run_once'
  }

  agent: {
    agentId: string
    agentVersion?: string
    modelPolicy: 'follow_agent' | 'pin_current'
    toolPolicy: 'follow_agent' | 'snapshot'
    permissionPolicy: 'follow_agent' | 'snapshot'
  }

  task: {
    prompt: string
    systemInstruction?: string
    outputMode: 'final_message' | 'structured_json' | 'artifact'
  }

  runtime: {
    maxDurationMs: number
    maxTurns: number
    concurrencyPolicy: 'skip' | 'queue'
  }

  nextRunAt: number | null
}
```

## Acceptance Criteria

- Creating or enabling a job requires a valid enabled agent.
- Job execution planning resolves model/tools/MCP/skills/permissions from the bound agent.
- In `follow_agent` mode, agent config updates affect the next job run.
- In snapshot mode, the job uses the captured runtime snapshot.
- Deleting or disabling an agent moves related jobs to `invalid_agent` and prevents enqueueing.
- The job editor clearly shows which runtime parts follow the agent and which are pinned.
- The task content field grows only up to 10 text rows and scrolls internally beyond that.
- Scheduler status excludes invalid jobs from enabled runnable counts.

## UX Shape

```text
+---------------------------------------------------------+
| Agent Binding                                           |
| Agent: [DeepChat Issue Triage v]                        |
|                                                         |
| Runtime follows agent                                   |
| [x] Model                                               |
| [x] Tools / MCP / Skills                                |
| [x] Permission mode                                     |
|                                                         |
| Advanced                                                |
| [ ] Pin current model/tools/permissions                 |
+---------------------------------------------------------+
```

## Non-Goals

- No fresh session creation yet.
- No remote delivery.
- No `cronjob` agent tool.
- No support for running without an agent.

## Constraints

- Use `AgentRepository` and existing agent config normalization.
- Keep `deepchat` as an explicit agent selection, not an invisible fallback.
- Snapshot JSON must be versioned so later migrations can identify the captured shape.
- Do not expose raw provider credentials in snapshots.

## Open Questions

None. Snapshot support is required for model/tools/permissions at the level available through the
current agent config; unavailable runtime internals should remain follow-mode only.
