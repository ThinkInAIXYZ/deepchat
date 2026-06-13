# AgentRuntimePresenter Split — Spec

> Status: **proposal only** — no code change in this goal. Implementation is a separate effort
> that must resolve the open questions below first.

## Problem

`src/main/presenter/agentRuntimePresenter/index.ts` is 5656 lines with 209 methods
(42 public, ~167 private). It is the core of the agent loop and the most frequently modified
file in the codebase, which makes it:

- hard to review (any change requires whole-file context),
- prone to merge conflicts (all agent work funnels into one file),
- effectively untestable as a unit (existing tests exercise it end-to-end only; the
  private-method mass cannot be tested in isolation).

The directory already contains 16 extracted collaborator modules (`messageStore`,
`tapeService`, `compactionService`, `contextBuilder`, `dispatch`, `pendingInputStore`,
`accumulator`, …), so the codebase has an established seam pattern to continue.

## Public API clusters (the natural service boundaries)

From the 42 public methods:

| Cluster | Examples | Target module |
| --- | --- | --- |
| Session lifecycle | `destroySession`, `getSessionState`, `getSessionListState` | `sessionLifecycleService` |
| Pending input queue | `listPendingInputs`, `steerActiveTurn`, `deletePendingInput`, `resumePendingQueue` | extend `pendingInputCoordinator` |
| Generation control | `cancelGeneration`, `getActiveGeneration`, `cancelGenerationByEventId` | `generationControlService` |
| Session settings | `setPermissionMode`, `setSessionModel`, `setSessionProjectDir`, `getGenerationSettings` | `sessionSettingsService` |
| Message/tape access | `getMessages`, `getMessage`, `getTapeInfo`, `clearMessages`, `retryMessage`, `deleteMessage` | extend `messageStore`/`tapeService` |
| Turn execution (the agent loop itself) | the `build*`/`resolve*`/`dispatch*` private mass | `turnRunner` (largest, last) |

## Requirements

1. `index.ts` becomes a façade that holds wiring and delegates; the presenter's external
   contract (IPC routes, `IPresenter` typing, event emissions) must not change.
2. Each extracted service gets unit tests as it is extracted (test-first per service).
3. Extraction proceeds one service per PR, smallest/least-coupled first; the turn runner moves
   last, after its dependencies are already out.
4. No behavior changes. Any bug found during extraction is fixed in a separate commit/PR.

## Open questions (resolve before implementation)

- [NEEDS CLARIFICATION] Shared mutable state audit: which private fields are touched by more
  than one cluster (e.g. generation tokens vs. pending-input state)? The split boundary may
  need a small shared `runtimeState` object instead of per-service ownership.
- [NEEDS CLARIFICATION] `agentSessionPresenter` (3898 lines) holds a parallel structure; decide
  whether to split it in the same effort or sequence it after.

## Success criteria

- `index.ts` < 1000 lines (wiring + delegation only).
- Each new service importable and unit-tested without constructing the full presenter.
- `test:main` baseline maintained throughout; no IPC contract diffs.
