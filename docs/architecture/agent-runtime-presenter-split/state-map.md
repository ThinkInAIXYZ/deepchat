# AgentRuntimePresenter Split — State Map

This resolves the first open question in `spec.md`: shared mutable state should be explicit. The
split should use one small shared runtime-state object for cross-cutting turn execution state
instead of letting every extracted service own its own copies.

## Presenter Dependencies

| Field | Owner After Split |
| --- | --- |
| `llmProviderPresenter`, `configPresenter`, `sqlitePresenter`, `toolPresenter` | constructor wiring / facade |
| `sessionStore`, `messageStore`, `tapeService` | constructor wiring; consumed by focused services |
| `pendingInputStore`, `pendingInputCoordinator`, `pendingInputService` | pending-input service |
| `compactionService`, `toolOutputGuard`, `hooksBridge` | constructor wiring for focused services |
| `providerCatalogPort`, `sessionPermissionPort`, `sessionUiPort`, `memoryPort`, `skillPresenter` | injected ports routed to their owning services |

## Shared Runtime State

| Field | Primary Writer | Readers |
| --- | --- | --- |
| `runtimeState` | session lifecycle | preparation, stream, pending input, interaction resume |
| `abortControllers` | generation control | stream lifecycle, deferred tools, cancellation APIs |
| `deferredToolAbortControllers` | generation control | cancellation APIs, deferred tool executor |
| `activeGenerations` | generation control | stream lifecycle, pending queue drain, public status APIs |
| `activeSteerPendingInputIds` | pending-input service | pending queue orchestration |
| `drainingPendingQueues` | pending-input service | queue drain guards |

Use a `RuntimeTurnState`/`RuntimeSharedState` object for these fields before extracting stateful
services. Passing individual maps around would just hide coupling.

## Service-Owned State

| Field | Target Service |
| --- | --- |
| `sessionGenerationSettings` | `sessionSettingsService` |
| `sessionAgentIds`, `sessionProjectDirs` | `sessionLifecycleService` |
| `firstTurnReadySessions`, `firstTurnReadyWaiters` | `sessionLifecycleService` |
| `systemPromptCache`, `toolProfileCache`, `toolRegistryRevision` | `TurnPreparationService` |
| `runtimeActivatedSkillsBySession` | `TurnPreparationService` |
| `interactionLocks`, `activeProviderPermissions`, `resumingMessages` | `InteractionResumeService` |
| `sessionCompactionStates` | `MemoryCompactionService` |
| `memoryExtractionChains`, `memoryExtractionEpochs`, `memoryInjectionAccessByTurn` | `MemoryCompactionService` |

`generationControlService` owns active-run registration and issues opaque, collision-resistant
`${sessionId}:${nanoid()}` run IDs. Consumers must compare or forward run IDs without parsing them.

`pendingInputCoordinator` remains the store-facing transition layer. `pendingInputService` owns the
queue-facing presenter API, steer/drain orchestration, and the shared active-steer/drain guards.

`cacheImage` is an injected immutable callback, not runtime state, and remains constructor wiring.
Project-directory, readiness, and agent-context maps are owned by `SessionLifecycleService`;
`SessionSettingsService` owns permission, model, and generation settings.

Facade composition passes lazy callbacks to services that are assigned later in the constructor.
Every callback-bound service constructor must therefore retain dependencies without invoking or
dereferencing them. `serviceConstruction.test.ts` enforces that ordering contract with fail-on-access
ports and fail-on-call callbacks.

## Sequencing Decision

`agentSessionPresenter` was intentionally left unchanged. Its split is a follow-up goal now that
the runtime facade is below 1000 lines and its service boundaries are stable.
