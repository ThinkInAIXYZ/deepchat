# Implementation Plan

## Phase Boundary

This phase depends on phases 1 through 5. It should be the last slice because it exposes the full
domain surface to agents.

## Tool Placement

Add:

- `src/main/presenter/toolPresenter/agentTools/cronJobTool.ts`
- Shared tool schemas near the Cron Jobs domain or tool handler.
- Tests under `test/main/presenter/toolPresenter/agentTools/cronJobTool.test.ts`.

Register the tool in `AgentToolManager` alongside other local agent tools.

Default-disable `cronjob` in new DeepChat agent/session defaults. The tool definition should still
be discoverable in the tool picker so users can opt in explicitly.

## Action Routing

Read actions:

- `preview_schedule` -> `CronExpressionService.preview`
- `list` -> Cron Jobs service list
- `show` -> Cron Jobs service get
- `history` -> Cron Jobs run repository

Write actions:

- Build a confirmation card payload.
- Return `confirmationRequired: true`.
- On confirmed execution, call Cron Jobs service methods.

Write actions must never mutate state during preview.

## Confirmation Flow

Reuse the existing agent tool confirmation infrastructure used by other local tools. The card should
carry enough structured data for the renderer to display a safe confirmation and enough opaque data
for the tool handler to execute after confirmation without trusting model text.

## Schema And Validation

Use zod schemas for:

- Input discriminated by `action`.
- Create input.
- Update patch.
- Filters.
- Confirmation payload.
- Structured result.

The schema should intentionally exclude scheduler internals.

## UI/Card Plan

Cards must be compact and action-oriented:

```text
+---------------------------------------------------------+
| Update Cron Job                                         |
| Schedule: 0 0 9 * * * -> 0 0 10 * * *                   |
| Agent: Issue Triage Agent                               |
| Next runs after change                                  |
| 2026-07-03 10:00 | 2026-07-04 10:00 | 2026-07-05 10:00 |
|                                                         |
| [Apply] [Edit] [Cancel]                                 |
+---------------------------------------------------------+
```

## Compatibility

- The UI and tool call the same service layer.
- The tool result shape must remain stable enough for model prompts and tests.
- If a job was created before phase 6, it is manageable by the tool as long as it passes current
  validation.

## Test Strategy

- Unit tests for every action.
- Confirmation tests proving write actions do not mutate before confirmation.
- Permission tests for denied confirmation or invalid payloads.
- Integration tests with mocked Cron Jobs service.
- Tool registry test proving `cronjob` appears exactly once and is excluded when listed in
  disabled agent tools.

## Validation Commands

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm test -- test/main/presenter/toolPresenter/agentTools/cronJobTool.test.ts`
- `pnpm test -- test/main/presenter/cronJobs`
