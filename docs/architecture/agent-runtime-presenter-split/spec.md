# AgentRuntimePresenter Split — Spec

> Status: **implemented; final validation pending** — the presenter is now a 768-line
> construction/delegation facade. Each extracted boundary has direct tests.

## Problem

Before this split, `src/main/presenter/agentRuntimePresenter/index.ts` was 7,642 lines with 219
methods (48 public and 171 private). It is the core of the agent loop and one of the most frequently
modified files in the codebase, which makes it:

- hard to review (any change requires whole-file context),
- prone to merge conflicts (all agent work funnels into one file),
- effectively untestable as a unit (existing tests exercise it end-to-end only; the
  private-method mass cannot be tested in isolation).

The directory already contained numerous extracted collaborator modules (`messageStore`,
`tapeService`, `compactionService`, `contextBuilder`, `dispatch`, `pendingInputStore`,
`accumulator`, …), so the codebase had an established seam pattern to continue.

## Public API clusters (the natural service boundaries)

The 48 public methods cluster into these service boundaries:

| Cluster | Examples | Target module |
| --- | --- | --- |
| Session lifecycle | `initSession`, `destroySession`, readiness, agent/project context | `sessionLifecycleService` |
| Pending input queue | `listPendingInputs`, `steerActiveTurn`, `deletePendingInput`, `resumePendingQueue` | `pendingInputService` over `pendingInputCoordinator` |
| Generation control | `cancelGeneration`, `getActiveGeneration`, `cancelGenerationByEventId` | `generationControlService` |
| Session settings | `setPermissionMode`, `setSessionModel`, `getGenerationSettings` | `sessionSettingsService` |
| Message/tape access | `getMessages`, `getMessage`, `getTapeInfo`, `clearMessages`, `retryMessage`, `deleteMessage` | `messageStore` plus narrow history/tape-access services over `messageStore`/`tapeService` |
| Turn preparation | input/model/tool/prompt/context preparation | `turnPreparationService` |
| Stream lifecycle | provider attempts, rate limits, context recovery, traces, terminal state | `streamLifecycleService` |
| Interaction resume | permission/question handling, deferred tools, resume context | `interactionResumeService` |
| Memory/compaction | injection, extraction, compaction state and orchestration | `memoryCompactionService` |

## Requirements

1. `index.ts` becomes a façade that holds wiring and delegates; the presenter's external
   contract (IPC routes, `IPresenter` typing, event emissions) must not change.
2. Each extracted service gets focused unit tests without requiring full-presenter construction.
3. Extraction proceeds in service-sized review slices, smallest/least-coupled first. Closely coupled
   slices may land together when their typed ports and shared-state move must remain coherent. Turn
   execution is split by lifecycle responsibility rather than moved wholesale into another
   monolith.
4. Structural moves preserve public behavior. Reliability fixes discovered during extraction use
   their own issue specs and focused tests, even when they share the implementation branch.
5. Callback-bound service constructors must only retain injected ports and callbacks. They must not
   invoke or dereference them until after facade composition completes.

## Resolved questions

- Shared mutable state audit: see `state-map.md`. Cross-cutting turn state should live in one
  explicit shared runtime-state object before extracting stateful services.
- `agentSessionPresenter` sequencing: split it after this presenter, not in the same effort.
- Project-directory, readiness, and agent-context ownership moved together in the final
  `SessionLifecycleService` slice, after the narrower generation-settings extraction.
- The original single `turnRunner` target is rejected: preparation, streaming, interaction resume,
  session lifecycle, and memory/compaction have distinct state and test boundaries. Memory and
  compaction remain a dedicated follow-up boundary instead of being folded into a turn service.

## Success criteria

- [x] `index.ts` < 1000 lines (768 lines, wiring + delegation only), enforced by
  `lint:agent-cleanup`.
- [x] Each new service is importable and unit-tested without constructing the full presenter.
- [x] Callback-bound service constructors are covered by a fail-on-access construction test.
- [ ] Presenter regression and native-agent eval baselines are maintained with no IPC contract
  changes.
