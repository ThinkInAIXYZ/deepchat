# Agent Runtime Presenter Thinning — Spec

> Status: implemented
> Baseline: `dev@868241322`, 2026-07-14

## Problem

The layered runtime migration moved session-owned mutable state into
`DeepChatAgentInstance` and split direct ACP from the DeepChat backend, but
`src/main/presenter/agentRuntimePresenter/index.ts` is still an implementation owner rather than a
thin presenter boundary:

- 8,167 lines;
- 211 class methods;
- 29 class fields;
- prompt assembly, generation-setting normalization, permission review, tool-result adaptation,
  interaction projection, compaction projection, and turn orchestration remain in one file.

The latest reliability work increased the file by 557 net lines. The backend split was real, but it
did not finish the presenter split.

## Goal

Reduce `AgentRuntimePresenter` to the remaining turn/session façade and wiring by moving cohesive,
independently testable policies to their existing owners or focused modules. This goal must remove
responsibilities from the class, not move the entire class behind a new name.

## Acceptance Criteria

- `agentRuntimePresenter/index.ts` is at most 5,000 lines.
- The class has at most 150 methods.
- Public presenter and session-application contracts remain unchanged.
- Extracted modules do not receive the presenter instance or a generic service locator.
- Generation settings, auto-approve review, system prompt/resources, and tool-result normalization
  have focused tests that do not construct the full presenter graph.
- Existing provider round, Tape, compaction, pending input, permission, tool, Memory, and terminal
  ordering remains unchanged.
- A repository check prevents the presenter from silently growing past the accepted ceiling.

## Constraints

- No new runtime dependency.
- No IPC, event payload, database schema, renderer, or user-facing behavior change.
- Preserve cancellation and stale-instance checks at their current boundaries.
- Keep `DeepChatAgentInstance` as the owner of per-session mutable runtime state.
- Keep `ToolPresenter`, `SkillPresenter`, `McpPresenter`, Memory, message, and Tape ownership intact.

## Non-goals

- Rewriting the provider/tool loop.
- Moving the 8,000-line implementation unchanged into a `TurnRunner` class.
- Introducing a DI container, plugin lifecycle, base presenter, mixin, or inheritance hierarchy.
- Forcing `index.ts` below 1,000 lines in one high-risk change. The remaining turn runner can be
  extracted separately once these collaborators are stable.
- Fixing unrelated behavior found during extraction.

## Outcome

- `agentRuntimePresenter/index.ts`: 8,167 → 4,905 lines.
- `AgentRuntimePresenter`: 211 → 135 methods.
- Generation policy, prompt/resource assembly, permission review, tool normalization, interaction
  projection, session settings, tool resolution, deferred execution, ACP compatibility, compaction
  projection, and provider permission settlement now have focused owners with explicit dependencies.
- `scripts/agent-cleanup-guard.mjs` rejects growth beyond 5,000 lines.
- Follow-up [turn preparation deduplication](../agent-turn-preparation-deduplication/spec.md) reduced
  the current boundary further to 4,874 lines / 136 methods without adding a runtime entity.
