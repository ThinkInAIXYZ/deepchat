# Implementation Plan

## Phase Boundary

This phase depends on phase 1 and phase 2. It updates job definitions and validation, but still does
not run the agent loop. Main can continue to mock execution after resolving runtime.

## Data Model Changes

Extend `cron_jobs`:

```sql
ALTER TABLE cron_jobs ADD COLUMN description TEXT;
ALTER TABLE cron_jobs ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE cron_jobs ADD COLUMN task_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE cron_jobs ADD COLUMN task_system_instruction TEXT;
ALTER TABLE cron_jobs ADD COLUMN task_output_mode TEXT NOT NULL DEFAULT 'final_message';
ALTER TABLE cron_jobs ADD COLUMN model_policy TEXT NOT NULL DEFAULT 'follow_agent';
ALTER TABLE cron_jobs ADD COLUMN tool_policy TEXT NOT NULL DEFAULT 'follow_agent';
ALTER TABLE cron_jobs ADD COLUMN permission_policy TEXT NOT NULL DEFAULT 'follow_agent';
ALTER TABLE cron_jobs ADD COLUMN runtime_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE cron_jobs ADD COLUMN agent_snapshot_json TEXT;
```

`agent_id` remains nullable at the database level for upgrade compatibility, but service validation
rejects enabling jobs without a valid agent.

## Runtime Resolver

Add `CronJobRuntimeResolver`:

1. Load job.
2. Load `AgentRepository.getAgent(job.agentId)`.
3. Reject missing or disabled agent with `invalid_agent`.
4. Resolve current config through `resolveDeepChatAgentConfig()` or ACP config paths.
5. Apply job policies:
   - `follow_agent`: use current agent config.
   - `pin_current` / `snapshot`: use `agent_snapshot_json`.
6. Return a sanitized runtime plan for later phase 4 execution.

## Agent Change Handling

When agent CRUD changes occur:

- Revalidate affected jobs.
- Mark jobs `invalid_agent` if their agent no longer exists or is disabled.
- Reconcile scheduler if runnable enabled counts changed.

Use typed events only if renderer needs immediate refresh.

## UI Plan

Add an Agent section to the job editor:

```text
+---------------------------------------------------------+
| Agent                                                   |
| [Issue Triage Agent v]                                  |
| Runtime: follows agent                                  |
| Model: follows | Tools: follows | Permissions: follows  |
|                                                         |
| [Advanced] Pin current runtime snapshot                 |
+---------------------------------------------------------+
```

Invalid jobs in the list:

```text
! Daily Issue Triage
  Agent missing or disabled
  [Choose Agent] [Disable]
```

## Compatibility

- Jobs created in phases 1 and 2 without an agent are disabled or marked `invalid_agent`.
- Legacy scheduled prompt tasks are not migrated here because phase 4 owns real session creation.

## Test Strategy

- Resolver tests for valid agent, missing agent, disabled agent, follow mode, and snapshot mode.
- Repository tests for status transitions and migration defaults.
- UI tests for agent selector, invalid agent state, and snapshot toggles.
- Scheduler tests proving invalid jobs are not counted as runnable.

## Validation Commands

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm test -- test/main/presenter/cronJobs`
- `pnpm test -- test/renderer`
