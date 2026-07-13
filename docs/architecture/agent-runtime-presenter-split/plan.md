# AgentRuntimePresenter Split — Plan

> Completed implementation sequence. The slices remain independently testable and reviewable.

## Sequencing (risk-ascending)

1. **Audit & state map** (no code): enumerate every private field of the presenter and which
   method cluster reads/writes it. Produces the ownership table that resolves the spec's
   first open question. Deliverable: `state-map.md` in this folder.
2. **Shared runtime state**: introduce a single `RuntimeSharedState` container for cross-cutting
   maps and sets before extracting any stateful service. This is a structural move only.
3. **`sessionSettingsService`**: permission mode, model selection, generation-settings cache,
   persistence mapping, defaults, and capability-aware normalization. Project-dir and full
   agent-context orchestration remain in the facade until session lifecycle is extracted.
4. **`generationControlService`**: active-generation registry + cancellation. Depends on the
   state map for token/registry ownership.
5. **Pending-input consolidation**: move queue-facing orchestration into `pendingInputService`
   while retaining `pendingInputCoordinator`/`pendingInputStore` as persistence transition layers.
6. **Message/tape facade methods**: keep pure message reads as `messageStore` delegates; move
   cross-store history mutations into `MessageHistoryService`, and move tape-ready query/replay
   orchestration into `AgentTapeAccessService` over `messageStore`/`tapeService`.
7. **Turn execution, in reviewable slices**:
   - `TurnPreparationService`: normalize the request and prepare settings, tools, skills, prompt,
     context budget, and initial tape view.
   - `StreamLifecycleService`: own provider attempts, rate-limit markers, context-pressure recovery,
     trace/tape-view persistence, outcome accounting, cancellation, and terminal hooks.
   - `InteractionResumeService`: own question/permission resolution, deferred tools, resume-budget
     fitting, normalized tool results, and assistant-message resume.
8. **Remaining ownership boundaries**:
   - `SessionLifecycleService`: init/destroy/readiness plus agent/project-dir ownership.
   - Move memory extraction/injection and compaction orchestration behind the dedicated
     `MemoryCompactionService`; do not put it into a generic turn runner.
9. **Façade cleanup**: `index.ts` keeps construction wiring + delegation only after every extracted
   boundary has direct tests.

## Testing approach

- Retain presenter-level characterization tests for the public-method clusters across the refactor.
- Give every extracted service focused unit tests with mocked collaborators.
- Run the complete main-process suite and native-Agent eval in the final unified repository gates.

## Result

- `index.ts` is 768 lines and contains construction, recovery/listener wiring, and public delegates.
- Turn preparation, stream lifecycle, interaction resume, session lifecycle, and memory/compaction
  are separate collaborators with explicit ports and owned mutable state.
- Presenter-level characterization coverage remains in place; every extracted service also has a
  direct unit-test suite.
- Callback-bound service constructors retain their ports without accessing them during composition;
  a fail-on-access construction suite protects this ordering contract.

# Tasks

See [tasks.md](tasks.md).
