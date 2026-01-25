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

## Phase 5: Testing

### 5.1 Unit Tests

- [ ] **TASK-5.1.1**: Test AgentRegistry
  - [ ] Test exact match lookup
  - [ ] Test prefix match lookup
  - [ ] Test not found error
  **Verification**: All tests pass

- [ ] **TASK-5.1.2**: Test AgenticPresenter routing
  - [ ] Test createSession routes correctly
  - [ ] Test sendMessage routes correctly
  - [ ] Test all methods route correctly
  **Verification**: All tests pass

- [ ] **TASK-5.1.3**: Test AgentPresenter normalizer
  - [ ] Test all event type mappings
  - [ ] Test payload transformation
  **Verification**: All tests pass

- [ ] **TASK-5.1.4**: Test AcpPresenter normalizer
  - [ ] Test all event type mappings
  - [ ] Test payload transformation
  **Verification**: All tests pass

### 5.2 Integration Tests

- [ ] **TASK-5.2.1**: Test DeepChat agent flow
  - [ ] Create session
  - [ ] Send message
  - [ ] Receive events in correct format
  - [ ] Close session
  **Verification**: Full flow works

- [ ] **TASK-5.2.2**: Test ACP agent flow
  - [ ] Create session
  - [ ] Send message
  - [ ] Receive events in correct format
  - [ ] Close session
  **Verification**: Full flow works

- [ ] **TASK-5.2.3**: Test multi-agent scenarios
  - [ ] Create sessions with different agents
  - [ ] Verify isolation
  **Verification**: Agents don't interfere

### 5.3 Manual Testing

- [ ] **TASK-5.3.1**: Manual test - Load DeepChat history
  - [ ] Create DeepChat session
  - [ ] Load existing conversation
  - [ ] Verify history displays
  **Verification**: History loads correctly

- [ ] **TASK-5.3.2**: Manual test - Load ACP history
  - [ ] Create ACP session
  - [ ] Load existing session
  - [ ] Verify history streams in
  **Verification**: History streams correctly

- [ ] **TASK-5.3.3**: Manual test - Model switching
  - [ ] Switch models in DeepChat agent
  - [ ] Switch models in ACP agent
  **Verification**: Model changes apply

- [ ] **TASK-5.3.4**: Manual test - Cancel operations
  - [ ] Send message, then cancel
  - [ ] Verify cancellation works
  **Verification**: Messages cancel cleanly

## Phase 6: Renderer Integration (Optional)

### 6.1 Create useAgentic Composable

- [ ] **TASK-6.1.1**: Create `src/renderer/src/composables/useAgentic.ts`
  - [ ] Create composable with AgenticPresenter methods
  - [ ] Add event listeners for AgenticEventType
  - [ ] Return reactive state
  **Verification**: Composable works

### 6.2 Update AgentWorkspace

- [ ] **TASK-6.2.1**: Refactor AgentWorkspace to use useAgentic
  - [ ] Replace agent-type-specific logic
  - [ ] Use unified interface
  **Verification**: Works with any agent type

## Phase 7: Documentation

### 7.1 Code Documentation

- [ ] **TASK-7.1.1**: Add JSDoc comments to all public interfaces
  - [ ] Document IAgenticPresenter methods
  - [ ] Document types
  **Verification**: All public APIs documented

- [ ] **TASK-7.1.2**: Add inline comments for complex logic
  - [ ] Document routing logic
  - [ ] Document event mapping
  **Verification**: Complex logic explained

### 7.2 User Documentation

- [ ] **TASK-7.2.1**: Update architecture docs if needed
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
