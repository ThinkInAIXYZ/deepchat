# AgentRuntimePresenter Split — Tasks

> Status: **superseded; do not continue these tasks**. Active task IDs are maintained in
> [Agent System Layered Runtime tasks](../agent-system-layered-runtime/tasks.md). Checked items below
> only describe work completed for the historical proposal.

- [x] T1: State-ownership audit → `state-map.md` (resolves shared-state question)
- [ ] T2: Extract `sessionSettingsService` (+ unit tests)
- [ ] T3: Extract `generationControlService` (+ unit tests)
- [ ] T4: Consolidate pending-input public methods into `pendingInputCoordinator`
- [ ] T5: Delegate message/tape facade methods into `messageStore`/`tapeService`
- [ ] T6: Extract `turnRunner` (agent loop)
- [ ] T7: Reduce `index.ts` to wiring + delegation (< 1000 lines)
- [x] T8: Decide sequencing for `agentSessionPresenter` split (follow-up goal)
