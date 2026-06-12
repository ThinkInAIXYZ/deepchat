# AgentRuntimePresenter Split — Tasks

> Proposal only — implementation not started. Resolve the spec's
> `[NEEDS CLARIFICATION]` items in T1 before any code moves.

- [ ] T1: State-ownership audit → `state-map.md` (resolves shared-state question)
- [ ] T2: Extract `sessionSettingsService` (+ unit tests)
- [ ] T3: Extract `generationControlService` (+ unit tests)
- [ ] T4: Consolidate pending-input public methods into `pendingInputCoordinator`
- [ ] T5: Delegate message/tape facade methods into `messageStore`/`tapeService`
- [ ] T6: Extract `turnRunner` (agent loop)
- [ ] T7: Reduce `index.ts` to wiring + delegation (< 1000 lines)
- [ ] T8: Decide sequencing for `agentSessionPresenter` split (follow-up goal)
