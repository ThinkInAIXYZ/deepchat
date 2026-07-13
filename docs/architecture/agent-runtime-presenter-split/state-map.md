# AgentRuntimePresenter Split — State Map

This resolves the first open question in `spec.md`: shared mutable state should be explicit. The
split should use one small shared runtime-state object for cross-cutting turn execution state
instead of letting every extracted service own its own copies.

## Presenter Dependencies

| Field | Owner After Split |
| --- | --- |
| `llmProviderPresenter`, `configPresenter`, `sqlitePresenter`, `toolPresenter` | constructor wiring / facade |
| `sessionStore`, `messageStore`, `tapeService` | message/tape facade services |
| `pendingInputStore`, `pendingInputCoordinator` | pending-input service |
| `compactionService`, `toolOutputGuard`, `hooksBridge` | injected collaborators retained by facade |
| `providerCatalogPort`, `sessionPermissionPort`, `sessionUiPort`, `memoryPort`, `skillPresenter` | injected ports retained by facade |

## Shared Runtime State

| Field | Primary Writer | Readers |
| --- | --- | --- |
| `runtimeState` | session lifecycle / turn runner | turn runner, pending input, message/tape helpers |
| `abortControllers` | generation control | turn runner, deferred tools, cancellation APIs |
| `deferredToolAbortControllers` | deferred tool service | cancellation APIs, deferred tool executor |
| `activeGenerations` | generation control | turn runner, pending queue drain, public status APIs |
| `activeSteerPendingInputIds` | pending-input service | turn runner, rollback/release helpers |
| `interactionLocks` | turn runner / interaction resolver | provider permission and question handlers |
| `activeProviderPermissions` | provider permission service | deferred tool execution, interaction completion |
| `resumingMessages` | message/tape facade | retry/resume flows |
| `drainingPendingQueues` | pending-input service | queue drain guards |

Use a `RuntimeTurnState`/`RuntimeSharedState` object for these fields before extracting stateful
services. Passing individual maps around would just hide coupling.

## Service-Owned State

| Field | Target Service |
| --- | --- |
| `sessionGenerationSettings` | `sessionSettingsService` |
| `sessionAgentIds`, `sessionProjectDirs` | `sessionLifecycleService` |
| `firstTurnReadySessions`, `firstTurnReadyWaiters` | `sessionLifecycleService` |
| `systemPromptCache`, `toolProfileCache`, `toolRegistryRevision` | `contextBuilder` / `toolProfileService` |
| `runtimeActivatedSkillsBySession` | `skillRuntimeService` |
| `sessionCompactionStates` | `compactionService` wrapper |
| `memoryExtractionChains`, `memoryExtractionEpochs` | `memoryExtractionService` |
| `nextRunSequence` | `turnRunner` |

## Sequencing Decision

Do not split `agentSessionPresenter` in the same effort. Its shape is related, but coupling it to
this split would double the review surface. Sequence it after the runtime facade is below 1000
lines and the turn-runner boundary is stable.
