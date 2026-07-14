# Agent Turn Preparation Deduplication — Spec

> Status: implemented
> Baseline: `codex/agent-runtime-presenter-thinning@ab716717c`, 2026-07-14

## Problem

`AgentRuntimePresenter.processMessage` and `resumeAssistantMessage` independently perform the same
pre-stream resource sequence:

1. load effective generation settings;
2. resolve model/context budget and interleaved reasoning policy;
3. resolve active skills and tool definitions;
4. estimate tool reserve tokens;
5. assemble the base system prompt.

The duplication keeps cancellation and stale-instance checks in two large methods and makes fixes
to resource preparation easy to apply to only one turn path.

## Goal

Keep one private implementation of shared turn resource preparation while preserving the distinct
initial-turn and resume compaction/context flows.

## Acceptance Criteria

- Initial and resume turns use one shared generation/model/skills/tools/base-prompt preparation
  method.
- Initial turns still merge message-activated skills; resume turns retain their existing session
  skill behavior.
- Existing pre-stream step names, abort handling, stale-instance checks, prompt inputs, tool order,
  and context-budget values remain unchanged.
- No new runtime class, dependency container, source file, public contract, or event/persistence
  change is introduced.
- `agentRuntimePresenter/index.ts` is at most 4,875 lines and the affected production TypeScript
  line count decreases from the checkpoint.

## Constraints

- Reuse the existing presenter helpers, `InputPreparationCoordinator`, and
  `DeepChatContextCoordinator`.
- Do not merge initial and resume compaction or Tape-view semantics.
- Do not change runtime-activated skill lifetime.
- No new dependency.

## Non-goals

- Extracting a `TurnRunner` or another presenter-sized class.
- Rewriting `processMessage`, `runStreamForMessage`, or `respondToolInteraction`.
- Chasing a sub-1,000-line presenter.
- Changing provider, tool, Memory, Tape, permission, or UI behavior.

## Outcome

- `agentRuntimePresenter/index.ts`: 4,905 → 4,874 lines.
- `processMessage`: 578 → 504 lines; `resumeAssistantMessage`: 405 → 351 lines.
- One 96-line `prepareTurnResources` method replaces 128 duplicated caller lines, reducing affected
  production TypeScript by 31 lines.
- `AgentRuntimePresenter` remains the only changed production source file; no new runtime entity or
  dependency was added.
