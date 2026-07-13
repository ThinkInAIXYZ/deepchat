# AgentRuntimePresenter Split — Tasks

> Implementation complete. The final facade is 768 lines; final unified validation is pending.

- [x] T1: State-ownership audit → `state-map.md` (resolves shared-state question)
- [x] T2: Introduce `RuntimeSharedState` and move cross-cutting maps/sets without behavior changes
- [x] T3: Extract generation/permission `sessionSettingsService` (+ direct unit tests)
- [x] T4: Extract `generationControlService` (+ unit tests)
- [x] T5: Consolidate pending-input orchestration into `pendingInputService` above the store-focused
  `pendingInputCoordinator` (+ direct unit tests)
- [x] T6: Delegate message/tape facade methods into `messageStore`/`tapeService` through narrow
  history and tape-access orchestration services (+ direct unit tests)
- [x] T7a: Extract `TurnPreparationService` (+ direct tests)
- [x] T7b: Extract `StreamLifecycleService` (+ direct tests)
- [x] T7c: Extract `InteractionResumeService` (+ direct tests)
- [x] T8a: Extract `SessionLifecycleService` (+ direct tests)
- [x] T8b: Isolate memory/compaction orchestration in `MemoryCompactionService` (+ direct tests)
- [x] T8c: Reduce `index.ts` to wiring + delegation (768 lines)
- [x] T8d: Guard callback-bound service constructor purity with fail-on-access fixtures
- [x] T9: Decide sequencing for `agentSessionPresenter` split (follow-up goal)
- [ ] T10: Run final unified formatting, i18n, lint, typecheck, tests, eval, and build gates
