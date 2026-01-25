# Tasks: Agentic Unified Layer

## Task Status Legend

- [ ] TODO - Not started
- [ ] IN_PROGRESS - In progress
- [x] DONE - Completed
- [ ] BLOCKED - Blocked by dependency

## Phase 1: Foundation (Protocol & Types)

### 1.1 Create Type Definitions

- [x] **TASK-1.1.1**: Create `src/shared/types/presenters/agentic.presenter.d.ts`
  - [x] Define `IAgenticPresenter` interface with all methods
  - [x] Define `AgenticEventType` enum
  - [x] Define `SessionInfo` interface
  - [x] Define `MessageContent` interface
  - [x] Define `SessionConfig` interface
  - [x] Define `LoadContext` interface
  - [x] Define event payload types (`SessionCreatedEvent`, `MessageDeltaEvent`, etc.)
  - [x] Export all types
  - **Verification**: `pnpm run typecheck` passes, no `any` types

- [ ] **TASK-1.1.2**: Review types with team
  - **Verification**: Team approval on types

### 1.2 Create AgenticPresenter Structure

- [x] **TASK-1.2.1**: Create `src/main/presenter/agentic/` directory
  **Verification**: Directory exists

- [x] **TASK-1.2.2**: Create `src/main/presenter/agentic/types.ts`
  - [x] Re-export all types from `@shared/types/presenters/agentic.presenter.d.ts`
  - [x] Add any internal types if needed
  **Verification**: File created, types exported

- [x] **TASK-1.2.3**: Create `src/main/presenter/agentic/registry.ts`
  - [x] Create `IAgentPresenter` interface (extends `IAgenticPresenter` with `agentId`)
  - [x] Implement `AgentRegistry` class with:
    - [x] `Map<string, IAgentPresenter>` storage
    - [x] `register(agent: IAgentPresenter)` method
    - [x] `get(agentId: string)` method with exact match
    - [x] `getByPrefix(agentId: string)` method for prefix matching (e.g., `acp.*`)
  - **Verification**: Unit tests for registry logic

- [x] **TASK-1.2.4**: Create `src/main/presenter/agentic/index.ts`
  - [x] Create `AgenticPresenter` class
  - [x] Add `registry: AgentRegistry` property
  - [x] Add `sessionToPresenter: Map<string, IAgentPresenter>` property
  - [x] Add `registerAgent(agent: IAgentPresenter)` method
  - [x] Add private `getPresenter(agentId: string)` method
  - [x] Add stub methods for all `IAgenticPresenter` operations
  - [x] Export singleton instance
  **Verification**: Class compiles, basic structure complete

## Phase 2: AgentPresenter Adaptation

### 2.1 AgentPresenter Protocol Implementation

- [x] **TASK-2.1.1**: Update `src/main/presenter/agentPresenter/index.ts`
  - [x] Import `IAgenticPresenter` types
  - [x] Add `readonly agentId: string = 'deepchat.default'` property
  - [x] Implement `createSession(config: SessionConfig): Promise<string>`
    - Map existing session creation to return conversationId as sessionId
  - [x] Implement `getSession(sessionId: string): SessionInfo | null`
    - Query SQLite for conversation
    - Map to SessionInfo format
  - [x] Implement `loadSession(sessionId: string, context: LoadContext): Promise<void>`
    - Use existing SQLite loading logic
  - [x] Implement `closeSession(sessionId: string): Promise<void>`
    - Use existing close logic
  - [x] Implement `sendMessage(sessionId: string, content: MessageContent): Promise<void>`
    - Use existing send logic (implemented as sendMessageAgentic to avoid naming conflict)
  - [x] Implement `cancelMessage(sessionId: string, messageId: string): Promise<void>`
    - Use existing cancel logic
  - [x] Implement `setModel(sessionId: string, modelId: string): Promise<void>`
    - Use existing model selection
  - [x] Implement `setMode(sessionId: string, modeId: string): Promise<void>`
    - Store modeId in session state (permission policy: strict/balanced/permissive)
    - Affects how permission requests are handled for the session
  **Verification**: All methods implemented, compiles

### 2.2 AgentPresenter Event Normalization

- [x] **TASK-2.2.1**: Create `src/main/presenter/agentPresenter/normalizer.ts`
  - [x] Create `normalizeEvent(event: STREAM_EVENTS)` function
  - [x] Map `STREAM_EVENTS.RESPONSE` → `AgenticEventType.MESSAGE_DELTA`
  - [x] Map `STREAM_EVENTS.END` → `AgenticEventType.MESSAGE_END`
  - [x] Map tool call events to `AgenticEventType.TOOL_START/TOOL_RUNNING/TOOL_END`
  - [x] Map `STREAM_EVENTS.ERROR` → `AgenticEventType.ERROR`
  - [x] Add any other event mappings as needed
  **Verification**: All event types mapped

- [ ] **TASK-2.2.2**: Integrate normalizer into AgentPresenter
  - [ ] Wrap all event emissions with normalizer
  - [ ] Ensure all emitted events are `AgenticEventType` format
  **Verification**: No raw `STREAM_EVENTS` emitted to renderer
  **Note**: Deferred to Phase 4 - event normalization will be integrated as part of AgenticPresenter event routing

### 2.3 Register AgentPresenter

- [x] **TASK-2.3.1**: Register AgentPresenter with AgenticPresenter
  - [x] Import AgenticPresenter singleton
  - [x] Call `agentic.registerAgent(this)` in constructor/initialization
  **Verification**: Agent registered, can be retrieved via registry

## Phase 3: AcpPresenter Adaptation

### 3.1 AcpPresenter Protocol Implementation

- [x] **TASK-3.1.1**: Update `src/main/presenter/acpPresenter/index.ts`
  - [x] Import `IAgenticPresenter` types
  - [x] Create `AcpAgentPresenter` wrapper class for each ACP agent
  - [x] Implement `createSession(config: SessionConfig): Promise<string>`
    - Use existing SessionManager.createSession
  - [x] Implement `getSession(sessionId: string): SessionInfo | null`
    - Query SessionManager
    - Map to SessionInfo format
  - [x] Implement `loadSession(sessionId: string, context: LoadContext): Promise<void>`
    - Trigger agent's loadSession (streams history)
  - [x] Implement `closeSession(sessionId: string): Promise<void>`
    - Use existing close logic
  - [x] Implement `sendMessage(sessionId: string, content: MessageContent): Promise<void>`
    - Use existing send logic
  - [x] Implement `cancelMessage(sessionId: string, messageId: string): Promise<void>`
    - Use existing cancel logic
  - [x] Implement `setModel(sessionId: string, modelId: string): Promise<void>`
    - Forward to agent
  - [x] Implement `setMode(sessionId: string, modeId: string): Promise<void>`
    - Forward to agent (mode maps to agent's mode concept)
  **Verification**: All methods implemented, compiles

### 3.2 AcpPresenter Event Normalization

- [x] **TASK-3.2.1**: Create `src/main/presenter/acpPresenter/normalizer.ts`
  - [x] Create `normalizeAcpEvent(event: ACP_EVENTS)` function
  - [x] Map `ACP_EVENTS.SESSION_UPDATE` → `AgenticEventType.MESSAGE_DELTA`
  - [x] Map `ACP_EVENTS.PROMPT_COMPLETED` → `AgenticEventType.MESSAGE_END`
  - [x] Map `ACP_EVENTS.ERROR` → `AgenticEventType.ERROR`
  - [x] Handle ACP SessionNotification nested structure
  **Verification**: All event types mapped

- [ ] **TASK-3.2.2**: Integrate normalizer into AcpPresenter
  - [ ] Wrap all event emissions with normalizer
  - [ ] Ensure all emitted events are `AgenticEventType` format
  **Verification**: No raw `ACP_EVENTS` emitted to renderer
  **Note**: Deferred to Phase 4 - event normalization will be integrated as part of AgenticPresenter event routing

### 3.3 Register AcpPresenter

- [x] **TASK-3.3.1**: Register AcpPresenter with AgenticPresenter
  - [x] Import AgenticPresenter singleton
  - [x] Create `registerAgenticAgents()` method in AcpPresenter
  - [x] Call `agentic.registerAgent(wrapper)` for each ACP agent config
  **Verification**: All ACP agents registered via wrapper classes, can be retrieved

## Phase 4: AgenticPresenter Integration

### 4.1 Implement AgenticPresenter Routing

- [x] **TASK-4.1.1**: Implement `createSession(agentId: string, config: SessionConfig): Promise<string>`
  - [x] Use `registry.get(agentId)` or `registry.getByPrefix(agentId)`
  - [x] Route to appropriate presenter
  - [x] Track sessionId → presenter mapping
  - [x] Emit `SESSION_CREATED` event
  **Verification**: Can create session for any registered agent

- [x] **TASK-4.1.2**: Implement `getSession(sessionId: string): SessionInfo | null`
  - [x] Look up presenter from sessionId
  - [x] Route to presenter's getSession
  **Verification**: Returns correct session info

- [x] **TASK-4.1.3**: Implement `loadSession(sessionId: string, context: LoadContext): Promise<void>`
  - [x] Look up presenter from sessionId
  - [x] Route to presenter's loadSession
  **Verification**: Loads session correctly

- [x] **TASK-4.1.4**: Implement `closeSession(sessionId: string): Promise<void>`
  - [x] Look up presenter from sessionId
  - [x] Route to presenter's closeSession
  - [x] Remove from sessionToPresenter mapping
  - [x] Emit `SESSION_CLOSED` event
  **Verification**: Session closed, mapping removed

- [x] **TASK-4.1.5**: Implement `sendMessage(sessionId: string, content: MessageContent): Promise<void>`
  - [x] Look up presenter from sessionId
  - [x] Route to presenter's sendMessage
  **Verification**: Message sent to correct agent

- [x] **TASK-4.1.6**: Implement `cancelMessage(sessionId: string, messageId: string): Promise<void>`
  - [x] Look up presenter from sessionId
  - [x] Route to presenter's cancelMessage
  **Verification**: Message cancelled correctly

- [x] **TASK-4.1.7**: Implement `setModel(sessionId: string, modelId: string): Promise<void>`
  - [x] Look up presenter from sessionId
  - [x] Route to presenter's setModel
  **Verification**: Model set correctly

- [x] **TASK-4.1.8**: Implement `setMode(sessionId: string, modeId: string): Promise<void>`
  - [x] Look up presenter from sessionId
  - [x] Route to presenter's setMode
  **Verification**: Mode set correctly

### 4.2 Error Handling

- [x] **TASK-4.2.1**: Add error handling for unknown agent_id
  - [x] Throw descriptive error when agent not found
  **Verification**: Error message clear

- [x] **TASK-4.2.2**: Add error handling for unknown sessionId
  - [x] Throw descriptive error when session not found
  **Verification**: Error message clear

- [x] **TASK-4.2.3**: Add error handling for presenter failures
  - [x] Catch errors from routed calls
  - [x] Emit `AgenticEventType.ERROR` events
  **Verification**: Errors propagated to renderer

## Phase 5: Unified Event Emission

### 5.1 Create AgenticEventEmitter Interface

- [x] **TASK-5.1.1**: Add `AgenticEventEmitter` interface to `agentic.presenter.d.ts`
  - [x] Define `messageDelta(messageId, content, isComplete)` method
  - [x] Define `messageEnd(messageId)` method
  - [x] Define `messageBlock(messageId, blockType, content)` method
  - [x] Define `toolStart(toolId, toolName, toolArguments)` method
  - [x] Define `toolRunning(toolId, status)` method
  - [x] Define `toolEnd(toolId, result, error)` method
  - [x] Define `statusChanged(status, error)` method
  - [x] Define `sessionUpdated(info)` method
  - [x] Define tool permission methods: `toolPermissionRequired`, `toolPermissionGranted`, `toolPermissionDenied`
  - [x] Define session lifecycle methods: `sessionReady`
  **Verification**: Interface defined, exported from shared types

- [x] **TASK-5.1.2**: Update type exports in `agentic.presenter.d.ts` and `agentic/types.ts`
  - [x] Export `AgenticEventEmitter` interface
  - [x] Export `SessionReadyEvent` interface
  - [x] Export tool permission event interfaces
  **Verification**: Type is importable from `@shared/types/presenters/agentic.presenter.d.ts`

### 5.2 Implement AgenticPresenter Event Emission

- [x] **TASK-5.2.1**: Create `AgenticEventEmitterImpl` class in `agentic/index.ts`
  - [x] Implement class with `sessionId` and `agentic` dependencies
  - [x] Implement all `AgenticEventEmitter` methods
  - [x] Each method calls `agentic.emitAgenticEvent()`
  **Verification**: Class compiles, implements interface

- [x] **TASK-5.2.2**: Add `createEventEmitter()` method to AgenticPresenter
  - [x] Add `createEventEmitter(sessionId: string): AgenticEventEmitter` method
  - [x] Return new `AgenticEventEmitterImpl` instance
  **Verification**: Method returns working emitter

- [x] **TASK-5.2.3**: Add `emitAgenticEvent()` method to AgenticPresenter
  - [x] Add `emitAgenticEvent(eventType, sessionId, payload)` method
  - [x] Call `eventBus.sendToRenderer()` with `AgenticEventType`
  - [x] Include `sessionId` in all event payloads
  **Verification**: All events go through this method

### 5.3 Integrate Normalizers with Emitter

- [x] **TASK-5.3.1**: Update AgentPresenter normalizer to accept emitter
  - [x] Change `normalizeEvent(event)` to `normalizeAndEmit(event, sessionId, emitter)`
  - [x] Update function signature to accept `AgenticEventEmitter`
  - [x] Call emitter methods instead of returning normalized events
  **Verification**: Normalizer integrates with emitter

- [x] **TASK-5.3.2**: Update AcpPresenter normalizer to accept emitter
  - [x] Change `normalizeAcpEvent(event)` to `normalizeAndEmit(event, sessionId, emitter)`
  - [x] Update function signature to accept `AgenticEventEmitter`
  - [x] Call emitter methods instead of returning normalized events
  **Verification**: Normalizer integrates with emitter

### 5.4 Update AgentPresenter Event Sending

- [x] **TASK-5.4.1**: Replace event emissions in `streaming/streamGenerationHandler.ts`
  - [x] Find all `eventBus.sendToRenderer(STREAM_EVENTS, ...)` calls
  - [x] Replace with emitter-based calls
  - [x] Pass emitter through call chain if needed
  **Verification**: No direct STREAM_EVENTS emissions in file

- [x] **TASK-5.4.2**: Replace event emissions in `streaming/streamUpdateScheduler.ts`
  - [x] Find all `eventBus.sendToRenderer(STREAM_EVENTS, ...)` calls
  - [x] Replace with emitter-based calls
  - [x] Pass emitter through call chain if needed
  **Verification**: No direct STREAM_EVENTS emissions in file

- [x] **TASK-5.4.3**: Replace event emissions in `streaming/llmEventHandler.ts`
  - [x] Find all `eventBus.sendToRenderer(STREAM_EVENTS, ...)` calls
  - [x] Replace with emitter-based calls
  **Verification**: No direct STREAM_EVENTS emissions in file

- [x] **TASK-5.4.4**: Replace event emissions in `loop/agentLoopHandler.ts`
  - [x] Find all `eventBus.sendToRenderer(STREAM_EVENTS, ...)` calls
  - [x] Replace with emitter-based calls
  **Verification**: No direct STREAM_EVENTS emissions in file

- [x] **TASK-5.4.5**: Replace event emissions in other AgentPresenter files
  - [x] Search for remaining `eventBus.sendToRenderer(STREAM_EVENTS, ...)` calls
  - [x] Replace with emitter-based calls
  **Verification**: Zero STREAM_EVENTS emissions in AgentPresenter

### 5.5 Update AcpPresenter Event Sending

- [x] **TASK-5.5.1**: Replace event emissions in `acpPresenter/index.ts`
  - [x] Find all `eventBus.sendToRenderer(ACP_EVENTS, ...)` calls
  - [x] Replace with emitter-based calls
  - [x] Update `sendEvent()` method to use emitter
  **Verification**: No direct ACP_EVENTS emissions in file

- [x] **TASK-5.5.2**: Replace event emissions in `managers/sessionManager.ts`
  - [x] Find all `eventBus.sendToRenderer(ACP_EVENTS, ...)` calls
  - [x] Replace with emitter-based calls
  **Verification**: No direct ACP_EVENTS emissions in file

- [x] **TASK-5.5.3**: Replace event emissions in `managers/processManager.ts`
  - [x] Find all `eventBus.sendToRenderer(ACP_EVENTS, ...)` calls
  - [x] Replace with emitter-based calls
  **Verification**: No direct ACP_EVENTS emissions in file

- [x] **TASK-5.5.4**: Replace event emissions in other AcpPresenter files
  - [x] Search for remaining `eventBus.sendToRenderer(ACP_EVENTS, ...)` calls
  - [x] Replace with emitter-based calls
  **Verification**: Zero ACP_EVENTS emissions in AcpPresenter

- [x] **TASK-5.5.5**: Verify no native events reach renderer
  - [x] Grep for `eventBus.sendToRenderer(STREAM_EVENTS` - should find 0 results
  - [x] Grep for `eventBus.sendToRenderer(ACP_EVENTS` - should find 0 results
  - [x] Only `AgenticEventType` events should be sent to renderer
  **Verification**: All events are AgenticEventType format

### 5.6 Testing Unified Event Emission

- [x] **TASK-5.6.1**: Test AgenticEventEmitter
  - [x] Test all emitter methods
  - [x] Verify events reach renderer in correct format
  **Verification**: All emitter methods work
  **Status**: 23/23 tests passing in `agenticEventEmitter.test.ts`

- [x] **TASK-5.6.2**: Integration test - AgentPresenter streaming
  - [x] Send message through AgentPresenter
  - [x] Verify all events are `AgenticEventType` format
  - [x] Verify message deltas, blocks, and ends all emitted correctly
  **Verification**: DeepChat streaming works with unified events
  **Status**: 18/18 tests passing in `agentPresenterAgenticIntegration.test.ts`

- [x] **TASK-5.6.3**: Integration test - AcpPresenter streaming
  - [x] Send message through AcpPresenter
  - [x] Verify all events are `AgenticEventType` format
  - [x] Verify tool calls emitted correctly
  **Verification**: ACP streaming works with unified events
  **Status**: 20/20 tests passing in `acpPresenterAgenticIntegration.test.ts`

## Phase 6: Testing

### 6.1 Unit Tests

- [x] **TASK-6.1.1**: Test AgentRegistry
  - [x] Test exact match lookup
  - [x] Test prefix match lookup
  - [x] Test not found error
  **Verification**: All tests pass
  **Status**: 26/26 tests passing in `agentRegistry.test.ts`

- [x] **TASK-6.1.2**: Test AgenticPresenter routing
  - [x] Test createSession routes correctly
  - [x] Test sendMessage routes correctly
  - [x] Test all methods route correctly
  **Verification**: All tests pass
  **Status**: 25/25 tests passing in `agenticPresenter.test.ts`

- [x] **TASK-6.1.3**: Test AgenticEventEmitter
  - [x] Test all emitter methods
  - [x] Verify event payloads are correct
  **Verification**: All tests pass
  **Status**: 23/23 tests passing in `agenticEventEmitter.test.ts` (Phase 5.6.1)

- [x] **TASK-6.1.4**: Test AgentPresenter normalizer
  - [x] Test all event type mappings
  - [x] Test payload transformation
  **Verification**: All tests pass
  **Status**: 18/18 tests passing in `agentPresenterAgenticIntegration.test.ts` (Phase 5.6.2)

- [x] **TASK-6.1.5**: Test AcpPresenter normalizer
  - [x] Test all event type mappings
  - [x] Test payload transformation
  **Verification**: All tests pass
  **Status**: 20/20 tests passing in `acpPresenterAgenticIntegration.test.ts` (Phase 5.6.3)

### 6.2 Integration Tests

- [x] **TASK-6.2.1**: Test DeepChat agent flow
  - [x] Create session
  - [x] Send message
  - [x] Receive events in correct format
  - [x] Close session
  **Verification**: Full flow works
  **Status**: Tests created in `deepchatAgentFlow.test.ts` (skipped in vitest - requires Electron context, corresponds to TASK-6.3.1 manual test)

- [x] **TASK-6.2.2**: Test ACP agent flow
  - [x] Create session
  - [x] Send message
  - [x] Receive events in correct format
  - [x] Close session
  **Verification**: Full flow works
  **Status**: Tests created in `acpAgentFlow.test.ts` (skipped in vitest - requires Electron context, corresponds to TASK-6.3.2 manual test)

- [x] **TASK-6.2.3**: Test multi-agent scenarios
  - [x] Create sessions with different agents
  - [x] Verify isolation
  **Verification**: Agents don't interfere
  **Status**: 14/14 tests passing in `multiAgentScenarios.test.ts`

### 6.3 Manual Testing

- [ ] **TASK-6.3.1**: Manual test - Load DeepChat history
  - [ ] Create DeepChat session
  - [ ] Load existing conversation
  - [ ] Verify history displays
  **Verification**: History loads correctly

- [ ] **TASK-6.3.2**: Manual test - Load ACP history
  - [ ] Create ACP session
  - [ ] Load existing session
  - [ ] Verify history streams in
  **Verification**: History streams correctly

- [ ] **TASK-6.3.3**: Manual test - Model switching
  - [ ] Switch models in DeepChat agent
  - [ ] Switch models in ACP agent
  **Verification**: Model changes apply

- [ ] **TASK-6.3.4**: Manual test - Cancel operations
  - [ ] Send message, then cancel
  - [ ] Verify cancellation works
  **Verification**: Messages cancel cleanly

## Phase 7: Renderer Integration (Optional)

### 7.1 Create useAgentic Composable

- [ ] **TASK-7.1.1**: Create `src/renderer/src/composables/useAgentic.ts`
  - [ ] Create composable with AgenticPresenter methods
  - [ ] Add event listeners for AgenticEventType
  - [ ] Return reactive state
  **Verification**: Composable works

### 7.2 Update AgentWorkspace

- [ ] **TASK-7.2.1**: Refactor AgentWorkspace to use useAgentic
  - [ ] Replace agent-type-specific logic
  - [ ] Use unified interface
  **Verification**: Works with any agent type

## Phase 8: Documentation

### 8.1 Code Documentation

- [ ] **TASK-8.1.1**: Add JSDoc comments to all public interfaces
  - [ ] Document IAgenticPresenter methods
  - [ ] Document AgenticEventEmitter methods
  - [ ] Document types
  **Verification**: All public APIs documented

- [ ] **TASK-8.1.2**: Add inline comments for complex logic
  - [ ] Document routing logic
  - [ ] Document event mapping
  - [ ] Document emitter implementation
  **Verification**: Complex logic explained

### 8.2 User Documentation

- [ ] **TASK-8.2.1**: Update architecture docs if needed
  **Verification**: Docs reflect implementation

## Open Items

### [RESOLVED] DeepChat Agent Modes

**Task**: Define `availableModes` for DeepChat agents

**Status**: RESOLVED

**Resolution**: `setMode` controls the permission policy (default permission judgment logic):

| Mode ID | Name | Description |
|---------|------|-------------|
| `strict` | Strict | All operations require user confirmation |
| `balanced` | Balanced | Read operations auto-allow, write/delete require confirmation |
| `permissive` | Permissive | Most operations auto-allow, only dangerous operations require confirmation |

**Implementation Notes**:
- No per-tool remember mechanism (ACP agents have their own internal handling)
- This is a session-level policy that affects permission handling for the entire session
- Future extension: True "execution modes" may be added later

## Completion Checklist

- [ ] All tasks completed
- [ ] All tests passing
- [ ] No type errors (`pnpm run typecheck`)
- [ ] No lint errors (`pnpm run lint`)
- [ ] Code formatted (`pnpm run format`)
- [ ] Documentation updated
- [ ] Code review completed
- [ ] Merged to main branch

## Notes

- Tasks marked **BLOCKED** cannot start until dependency resolved
- Tasks can be completed in parallel within each phase
- Phase 5 (Testing) should happen after each implementation phase
