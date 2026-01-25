# Implementation Plan: Agentic Unified Layer

## Overview

This document describes the implementation approach for the Agentic Unified Layer, which provides a unified interface for interacting with different agent types (ACP and DeepChat) in the renderer process.

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Renderer Process                             │
│                                                                      │
│   useAgentic()  ← Unified composable                                 │
│        │                                                            │
│        ▼                                                            │
│   AgentWorkspace UI                                                 │
└────────────────────────────────────┬────────────────────────────────┘
                                     │ IPC (usePresenter)
┌────────────────────────────────────▼────────────────────────────────┐
│                      Main Process                                    │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │           AgenticPresenter (Unified Entry)                  │     │
│  │                                                              │     │
│  │  + registerAgent(presenter)  ← Agent Registration            │     │
│  │  + getPresenter(agentId)     ← Routing                       │     │
│  └───────────────────┬──────────────────────────────────────┘     │
│                      │                                             │
│         ┌────────────┴────────────┐                                │
│         ▼                          ▼                                │
│  ┌──────────────────┐      ┌──────────────────┐                   │
│  │  AgentPresenter  │      │   AcpPresenter   │  ← Implements     │
│  │  (deepchat.*)    │      │   (acp.*)        │     IAgenticPresenter │
│  └────────┬─────────┘      └────────┬─────────┘                   │
│           │                         │                               │
│           ▼                         ▼                               │
│  ┌──────────────────────────────────────────────┐                   │
│  │         Internal Event Normalization → AgenticEventType         │
│  └──────────────────────┬───────────────────────┘                   │
│                         ▼                                           │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │                    EventBus                                  │     │
│  │         AgenticEventType (Unified Event Format)             │     │
│  └────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Foundation (Protocol & Types)

**Goal**: Define the unified protocol and type system.

#### 1.1 Create Type Definitions
- Create `src/shared/types/presenters/agentic.presenter.d.ts`
- Define `IAgenticPresenter` interface
- Define `AgenticEventType` enum
- Define all data models (`SessionInfo`, `MessageContent`, etc.)

**Success Criteria**:
- All types are defined and exported
- No type errors in definitions
- Types match the spec exactly

#### 1.2 Create AgenticPresenter Structure
- Create `src/main/presenter/agentic/` directory
- Create `index.ts` - AgenticPresenter main class
- Create `registry.ts` - Agent registration and routing logic
- Create `types.ts` - Internal types (re-export shared types)

**Success Criteria**:
- Directory structure created
- Basic AgenticPresenter class skeleton
- Registry Map structure for agent_id → Presenter mapping

### Phase 2: AgentPresenter Adaptation

**Goal**: Refactor AgentPresenter to implement IAgenticPresenter.

#### 2.1 AgentPresenter Protocol Implementation
- Update `src/main/presenter/agentPresenter/index.ts`
- Implement `IAgenticPresenter` interface
- Add `agentId = 'deepchat.default'` property
- Map `conversationId` → `sessionId`

**Key Changes**:
- `createSession()` → Use existing session creation, return conversationId as sessionId
- `getSession()` → Query SQLite, return SessionInfo
- `loadSession()` → Load from SQLite (existing behavior)
- `closeSession()` → Use existing close logic
- `sendMessage()` → Use existing send logic
- `setModel()` → Implement model selection
- `setMode()` → Store permission policy (strict/balanced/permissive) in session state

#### 2.2 AgentPresenter Event Normalization
- Create `src/main/presenter/agentPresenter/normalizer.ts`
- Convert `STREAM_EVENTS` → `AgenticEventType`
- Wire into AgentPresenter event emission

**Event Mapping**:
- `STREAM_EVENTS.CONTENT_DELTA` → `AgenticEventType.MESSAGE_DELTA`
- `STREAM_EVENTS.MESSAGE_COMPLETE` → `AgenticEventType.MESSAGE_END`
- etc.

#### 2.3 Register AgentPresenter
- In AgentPresenter constructor/initialization
- Call `agentic.registerAgent(this)`

**Success Criteria**:
- AgentPresenter implements IAgenticPresenter fully
- All events emit in AgenticEventType format
- Registered with AgenticPresenter

### Phase 3: AcpPresenter Adaptation

**Goal**: Refactor AcpPresenter to implement IAgenticPresenter.

#### 3.1 AcpPresenter Protocol Implementation
- Update `src/main/presenter/acpPresenter/index.ts`
- Implement `IAgenticPresenter` interface
- Add `agentId` property (dynamic, based on agent config)
- Keep existing sessionId generation

**Key Changes**:
- `createSession()` → Use existing SessionManager
- `getSession()` → Return SessionInfo from SessionManager
- `loadSession()` → Trigger agent's `loadSession` (streams history)
- `closeSession()` → Use existing close logic
- `sendMessage()` → Use existing send logic
- `setModel()` → Forward to agent
- `setMode()` → Forward to agent

#### 3.2 AcpPresenter Event Normalization
- Create `src/main/presenter/acpPresenter/normalizer.ts`
- Convert `ACP_EVENTS` → `AgenticEventType`
- Wire into AcpPresenter event emission

**Event Mapping**:
- `ACP_EVENTS.CONTENT_CHUNK` → `AgenticEventType.MESSAGE_DELTA`
- `ACP_EVENTS.MESSAGE_END` → `AgenticEventType.MESSAGE_END`
- etc.

#### 3.3 Register AcpPresenter
- In AcpPresenter initialization
- Call `agentic.registerAgent(this)` for each ACP agent

**Success Criteria**:
- AcpPresenter implements IAgenticPresenter fully
- All events emit in AgenticEventType format
- Registered with AgenticPresenter

### Phase 4: AgenticPresenter Integration

**Goal**: Complete the unified entry point.

#### 4.1 Implement AgenticPresenter
- Implement all `IAgenticPresenter` methods as routing logic
- `createSession(agentId, config)` → Route to registered presenter
- `sendMessage(sessionId, content)` → Find presenter by sessionId, route
- etc.

**Routing Logic**:
```typescript
private getPresenter(agentId: string): IAgentPresenter {
  // Exact match first
  if (this.agents.has(agentId)) {
    return this.agents.get(agentId)!
  }

  // Prefix match for 'acp.*'
  for (const [registeredId, presenter] of this.agents) {
    if (registeredId.endsWith('*') && agentId.startsWith(registeredId.slice(0, -1))) {
      return presenter
    }
  }

  throw new Error(`No presenter found for agent_id: ${agentId}`)
}
```

#### 4.2 Session-to-Presenter Tracking
- Maintain `sessionId → Presenter` mapping
- Update on `createSession` and `closeSession`

**Success Criteria**:
- All routing works correctly
- sessionId tracking accurate
- Error handling for unknown agent_id

### Phase 5: Unified Event Emission

**Goal**: Implement `AgenticEventEmitter` - the unified event sending mechanism.

> **Critical**: This phase ensures all events sent to the renderer are in `AgenticEventType` format.

#### 5.1 Create AgenticEventEmitter Interface

- Add `AgenticEventEmitter` interface to `agentic.presenter.d.ts`
- Define type-safe event emission methods:
  - `messageDelta(messageId, content, isComplete)`
  - `messageEnd(messageId)`
  - `messageBlock(messageId, blockType, content)`
  - `toolStart(toolId, toolName, arguments)`
  - `toolRunning(toolId, status)`
  - `toolEnd(toolId, result, error)`
  - `toolPermissionRequired(toolId, toolName, request)`
  - `toolPermissionGranted(toolId)`
  - `toolPermissionDenied(toolId)`
  - `sessionReady(sessionId, messageCount)`
  - `sessionUpdated(info)`
  - `statusChanged(status, error)`
- Add `PermissionRequestPayload` interface
- Add missing event types to `AgenticEventType` enum:
  - `SESSION_READY`
  - `TOOL_PERMISSION_REQUIRED`
  - `TOOL_PERMISSION_GRANTED`
  - `TOOL_PERMISSION_DENIED`
- Update `MessageBlockEvent.blockType` to include:
  - `image`
  - `action`
  - `search`
  - `mcp_ui_resource`

**Success Criteria**:
- Interface defined with all event types
- Type-safe method signatures
- Exported from shared types
- All new event types added to enum

#### 5.2 Implement AgenticPresenter Event Emission

- Add `createEventEmitter(sessionId): AgenticEventEmitter` to AgenticPresenter
- Add `emitAgenticEvent(eventType, sessionId, payload)` low-level method
- Create internal `AgenticEventEmitterImpl` class

**Implementation**:
```typescript
// src/main/presenter/agentic/index.ts
class AgenticPresenter {
  // ... existing methods ...

  createEventEmitter(sessionId: string): AgenticEventEmitter {
    return new AgenticEventEmitterImpl(sessionId, this)
  }

  emitAgenticEvent(
    eventType: AgenticEventType,
    sessionId: string,
    payload: unknown
  ): void {
    eventBus.sendToRenderer(eventType, SendTarget.ALL_WINDOWS, {
      sessionId,
      ...payload
    })
  }
}

class AgenticEventEmitterImpl implements AgenticEventEmitter {
  constructor(
    private sessionId: string,
    private agentic: AgenticPresenter
  ) {}

  messageDelta(messageId: string, content: string, isComplete: boolean): void {
    this.agentic.emitAgenticEvent(
      AgenticEventType.MESSAGE_DELTA,
      this.sessionId,
      { messageId, content, isComplete }
    )
  }

  messageEnd(messageId: string): void {
    this.agentic.emitAgenticEvent(
      AgenticEventType.MESSAGE_END,
      this.sessionId,
      { messageId }
    )
  }

  // ... other methods
}
```

**Success Criteria**:
- AgenticPresenter has event emission methods
- Internal emitter implementation created
- All events go through `emitAgenticEvent()`

#### 5.3 Integrate Normalizers with Emitter

**AgentPresenter**:
- Update `normalizer.ts` to accept `AgenticEventEmitter` parameter
- Change from `normalizeEvent(event)` to `normalizeAndEmit(event, sessionId, emitter)`
- Replace all `eventBus.sendToRenderer(STREAM_EVENTS, ...)` calls with normalizer

**AcpPresenter**:
- Update `normalizer.ts` to accept `AgenticEventEmitter` parameter
- Change from `normalizeAcpEvent(event)` to `normalizeAndEmit(event, sessionId, emitter)`
- Replace all `eventBus.sendToRenderer(ACP_EVENTS, ...)` calls with normalizer

**Before**:
```typescript
// AgentPresenter - current code
eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
  messageId,
  content: chunk,
  isComplete: false
})
```

**After**:
```typescript
// AgentPresenter - new code
const emitter = agenticPresenter.createEventEmitter(sessionId)
emitter.messageDelta(messageId, chunk, false)
```

**Success Criteria**:
- Normalizers integrated with emitter
- No direct `eventBus.sendToRenderer()` calls with native event types
- All events normalized before emission

#### 5.4 Update AgentPresenter Event Sending

- Find all `eventBus.sendToRenderer(STREAM_EVENTS.*, ...)` calls
- Replace with emitter-based calls
- Update streaming handlers to use emitter
- Update tool execution handlers to use emitter

**Locations to update**:
- `streaming/streamGenerationHandler.ts`
- `streaming/streamUpdateScheduler.ts`
- `streaming/llmEventHandler.ts`
- `loop/agentLoopHandler.ts`
- Any other files with `STREAM_EVENTS` emissions

**Success Criteria**:
- Zero direct `STREAM_EVENTS` emissions
- All events use `AgenticEventEmitter`
- Streaming flow works correctly

#### 5.5 Update AcpPresenter Event Sending

- Find all `eventBus.sendToRenderer(ACP_EVENTS.*, ...)` calls
- Replace with emitter-based calls
- Update session manager to use emitter
- Update process manager to use emitter

**Locations to update**:
- `index.ts` - main event sending methods
- `managers/sessionManager.ts`
- `managers/processManager.ts`
- Any other files with `ACP_EVENTS` emissions

**Success Criteria**:
- Zero direct `ACP_EVENTS` emissions
- All events use `AgenticEventEmitter`
- ACP flow works correctly

### Phase 6: Renderer Integration (Optional/Future)

**Goal**: Create `useAgentic()` composable for renderer.

> **Note**: This phase can be deferred. The main process changes can be tested directly first.

#### 6.1 Create useAgentic Composable
- Create `src/renderer/src/composables/useAgentic.ts`
- Provide unified API for renderer
- Handle AgenticEventType events

#### 5.2 Update AgentWorkspace
- Refactor to use `useAgentic()`
- Remove agent-type-specific logic

**Success Criteria**:
- `useAgentic()` works with any agent type
- AgentWorkspace no longer has agent-type branching

## File Structure

```
src/main/presenter/
├── agentic/
│   ├── index.ts                    # AgenticPresenter main class
│   ├── types.ts                    # Internal types
│   └── registry.ts                 # Agent registration logic
│
├── agentPresenter/
│   ├── index.ts                    # Implements IAgenticPresenter
│   └── normalizer.ts               # STREAM_EVENTS → Agentic events
│
└── acpPresenter/
    ├── index.ts                    # Implements IAgenticPresenter
    └── normalizer.ts               # ACP_EVENTS → Agentic events

src/shared/types/presenters/
└── agentic.presenter.d.ts          # IAgenticPresenter interface
```

## Risk Mitigation

### Risk 1: Breaking Existing Functionality
**Mitigation**:
- Implement behind feature flag initially
- Comprehensive testing of existing flows
- Gradual rollout with fallback

### Risk 2: Event Translation Bugs
**Mitigation**:
- Write unit tests for normalizers
- Compare old vs new event payloads
- Manual testing of complex scenarios

### Risk 3: sessionId Conflicts
**Mitigation**:
- Use namespacing for different agent types
- Validation in AgenticPresenter
- Clear error messages for conflicts

## Testing Strategy

### Unit Tests
- AgenticPresenter routing logic
- AgentPresenter/AcpPresenter protocol implementation
- Event normalizers

### Integration Tests
- End-to-end agent creation and messaging
- Multi-agent scenarios
- Error handling

### Manual Tests
- Load DeepChat conversation history
- Load ACP session history
- Switch between agent types
- Cancel operations
- Model/mode switching

## Rollout Plan

1. **Phase 1-2**: Implement foundation and AgentPresenter
2. **Internal Testing**: Test with DeepChat agents only
3. **Phase 3**: Implement AcpPresenter adaptation
4. **Internal Testing**: Test with ACP agents
5. **Phase 4**: Complete AgenticPresenter integration
6. **Beta Testing**: Enable for beta users
7. **Phase 5**: Renderer integration (deferred if needed)

## Dependencies

### Must Complete First
- None (green-field design)

### Parallel Work Possible
- Phase 2 (AgentPresenter) and Phase 3 (AcpPresenter) can be done in parallel

## Success Metrics

1. All existing ACP and DeepChat functionality preserved
2. Renderer can interact with any agent via single interface
3. No performance regression
4. Test coverage > 80% for new code
5. Zero type errors

## Open Items

### [RESOLVED] DeepChat Agent Modes
DeepChat agent `availableModes` defined as permission policies.

**Resolution**: `setMode` controls the session-level permission policy:

| Mode ID | Description |
|---------|-------------|
| `strict` | All operations require user confirmation |
| `balanced` | Read operations auto-allow, write/delete require confirmation |
| `permissive` | Most operations auto-allow, only dangerous operations require confirmation |

**Implementation**: Store modeId in session state, affect permission request handling for the session. No per-tool remember mechanism (ACP agents have their own internal handling).

## Related Documents

- Specification: `docs/specs/agentic-unified-layer/spec.md`
- Task Breakdown: `docs/specs/agentic-unified-layer/tasks.md`
- Architecture: `docs/architecture/agent-abstraction-layer.md`
