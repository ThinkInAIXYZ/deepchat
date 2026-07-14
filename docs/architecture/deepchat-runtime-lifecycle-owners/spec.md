# DeepChat Runtime Lifecycle Owners — Spec

> Status: implemented
> Baseline: `codex/agent-runtime-presenter-thinning@4c5c20b0c`, 2026-07-14

## Problem

`AgentRuntimePresenter` is still 4,874 lines because it owns four long-lived control flows:

- initial turn setup in `processMessage`;
- resumed turn setup in `resumeAssistantMessage`;
- provider/tool loop execution in `runStreamForMessage`;
- paused interaction settlement in `respondToolInteraction`.

These are not four independent state owners. Initial and resumed setup are two entries into one turn
lifecycle, while loop execution and interaction settlement have separate invariants. Keeping all four
flows in the presenter hides those three ownership boundaries.

## Goal

Move the lifecycle implementations behind three explicit owners that do not retain session or run
state:

- `TurnCoordinator.start()` and `TurnCoordinator.resume()` own pre-stream turn preparation and
  terminal settlement;
- `DeepChatLoopRunner.run()` owns provider/tool round execution and context-pressure recovery;
- `InteractionCoordinator.respond()` owns paused interaction reconciliation and resume decisions.

`AgentRuntimePresenter` remains the public façade and composition root.

## Acceptance Criteria

- The presenter keeps its existing public API and thin compatibility wrappers used by current tests.
- No extracted owner receives an `AgentRuntimePresenter` instance or a general-purpose service
  locator.
- Owner ports are explicit, owner-specific, and contain no mutable runtime state.
- Per-session and per-run mutable state remains in `DeepChatAgentInstance` and `LoopRun`.
- Initial/resume ordering, cancellation, stale-instance checks, persistence, hooks, Tape, Memory,
  permissions, queue draining, and terminal outcomes remain unchanged.
- `agentRuntimePresenter/index.ts` is at most 3,200 lines.
- Total production TypeScript across the presenter and the three new owner files grows by no more
  than 700 lines over the 4,874-line baseline. The allowed delta is the explicit owner-port
  contracts and composition wiring, not duplicated control flow.
- The architecture guard adopts the new presenter ceiling.

## Constraints

- No new runtime dependency, database schema, IPC contract, event payload, or user-visible change.
- No new shared mutable maps, generic dependency container, inheritance hierarchy, or framework.
- Preserve the existing private wrapper names where tests intentionally replace the loop or resume
  boundary.
- Prefer existing stores, coordinators, and loop primitives over new abstractions.

## Non-goals

- Rewriting the provider/tool algorithm.
- Merging initial and resumed context construction.
- Moving session state out of `DeepChatAgentInstance`.
- Splitting every helper into its own class or forcing the presenter below 1,000 lines.
- Syncing a GitHub issue.

## Outcome

- `agentRuntimePresenter/index.ts`: 4,874 → 2,604 lines; class methods: 136 → 122.
- `TurnCoordinator` owns `start()`/`resume()` in 1,226 lines.
- `DeepChatLoopRunner` owns `run()`, context-pressure recovery, Tape manifests, request traces, and
  rate-limit projection in 967 lines.
- `InteractionCoordinator` owns `respond()` and deferred permission/question/skill-draft settlement
  in 728 lines.
- The four-file production total is 5,525 lines, a 651-line increase for explicit port contracts and
  composition wiring, within the 700-line ceiling.
- The presenter guard is 3,200 lines. Focused runtime validation passes 605 tests with 19 skipped;
  format, i18n, lint, architecture guards, and node/web type checks pass.
