# AgentRuntimePresenter Split — Plan

> Proposal only. Each step below is one PR against `dev`.

## Sequencing (risk-ascending)

1. **Audit & state map** (no code): enumerate every private field of the presenter and which
   method cluster reads/writes it. Produces the ownership table that resolves the spec's
   first open question. Deliverable: `state-map.md` in this folder.
2. **`sessionSettingsService`**: permission mode, model selection, project dir, generation
   settings. Mostly self-contained reads/writes through `configPresenter`/`sqlitePresenter`.
3. **`generationControlService`**: active-generation registry + cancellation. Depends on the
   state map for token/registry ownership.
4. **Pending-input consolidation**: move the queue-facing public methods next to the existing
   `pendingInputCoordinator`/`pendingInputStore` modules.
5. **Message/tape facade methods**: delegate `getMessages`/`retryMessage`/`deleteMessage`/
   `clearMessages` bodies into `messageStore`/`tapeService` where the logic mostly already
   lives.
6. **`turnRunner`** (the agent loop): everything that remains. By this point its collaborators
   are injectable and the extraction is mechanical.
7. **Façade cleanup**: `index.ts` keeps construction wiring + delegation only.

## Testing approach

- Before each extraction: characterization tests for the cluster's public methods at the
  presenter level (they survive the refactor unchanged).
- After each extraction: unit tests for the new service with mocked collaborators.
- `test:main` must stay at baseline after every PR.

## Estimated effort

7 PRs, roughly 1–2 weeks elapsed. Steps 2–5 are independent enough to interleave with normal
feature work; step 6 should land in a quiet window.

# Tasks

See [tasks.md](tasks.md).
