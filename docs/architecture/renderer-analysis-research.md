# Renderer Integration - Analysis & Research Propositions

## Document Purpose

This document captures:
1. **Confirmed Decisions** - Architectural decisions already made
2. **Open Research Items** - Topics requiring deeper analysis
3. **Exploration Propositions** - Specific questions to investigate

**Status**: Active Analysis Phase
**Last Updated**: 2026-01-25

---

## Part I: Confirmed Decisions

### Decision 1: Terminology - Unified `sessionId`

**Rationale**: Eliminate terminology inconsistency across layers

**Decision**:
- ✅ Renderer uses **`sessionId`** exclusively
- ✅ Database (`SQLite`) keeps **`conversationId`** unchanged
- ✅ Presenter layer handles `sessionId` ↔ `conversationId` mapping
- ❌ No `conversationId` or `threadId` exposed to renderer

**Terminology Mapping**:
```
Renderer Layer:
  - activeSessionId (was activeThreadId)
  - sessionId (was conversationId/threadId)

Presenter Layer (Internal):
  - sessionId → conversationId mapping
  - For DeepChat: sessionId = conversationId
  - For ACP: sessionId maps to conversationId + session tracking

Database:
  - conversations table keeps conversationId
```

**Impact Scope**:
- ~200 files with `threadId` references
- ~150 files with `conversationId` references
- All state management composables
- All UI components

**Implementation Approach**:
- Direct replacement (no aliases, no gradual migration)
- Update all references in single effort
- Search-and-replace with validation

---

### Decision 2: Event System - Complete `AgenticEventType` Coverage

**Rationale**: Single unified event format for all agent types

**Decision**:
- ✅ Extend `AgenticEventType` to cover all current events
- ✅ No backward compatibility with `STREAM_EVENTS` / `ACP_WORKSPACE_EVENTS`
- ✅ Direct replacement of event listeners

**Event Coverage Analysis**:

| Current Event | Target AgenticEventType | Status |
|---------------|-------------------------|--------|
| `STREAM_EVENTS.RESPONSE` | `MESSAGE_DELTA` | ✅ Defined |
| `STREAM_EVENTS.END` | `MESSAGE_END` | ✅ Defined |
| `STREAM_EVENTS.ERROR` | `ERROR` | ✅ Defined |
| `ACP_WORKSPACE_EVENTS.SESSION_MODES_READY` | `SESSION_UPDATED` | ✅ Specified (D-011) |
| `ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY` | `SESSION_UPDATED` | ✅ Specified (D-011) |
| `ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE` | `SESSION_UPDATED` | ✅ Specified (D-010, D-011, D-012) |

**Required Research**:
- [x] How to represent modes/models/commands in `SessionUpdatedEvent` → See `event-payload-specification.md` Part III
- [x] Should these be separate event types? → **Decision**: Use `SESSION_UPDATED` for all (D-011)
- [x] Payload structure for ACP-specific data → See `event-payload-specification.md` Part III.1

---

### Decision 3: Component Strategy - New Components Only

**Rationale**: Clean break from legacy patterns

**Decision**:
- ✅ Create new components with unified interface
- ✅ Only use new components (no gradual migration)
- ❌ Do not patch existing components
- ❌ Do not maintain dual component versions

**New Components Required** (specs needed):
1. **AgentHeader** - Display agent info (name, icon, status, capabilities)
2. **UnifiedModelSelector** - Model selection for all agent types
3. **UnifiedModeSelector** - Mode/permission policy selection
4. **WorkspaceSelector** - Workspace/workdir selection (unified)

**Old Components to Deprecate**:
- `AcpModeSelector.vue`
- `AcpSessionModelSelector.vue`
- `ModelSelector.vue` (current)
- Branching logic in `ChatInput.vue`, `ChatConfig.vue`

**Component Spec Requirements**:
- Each component needs detailed spec before implementation
- Spec must cover: props, events, capabilities query, agent-agnostic rendering

---

### Decision 4: No Backward Compatibility

**Rationale**: Green-field redesign, cleaner architecture

**Decision**:
- ✅ Direct replacement of old patterns
- ❌ No feature flags for old/new behavior
- ❌ No gradual migration path
- ❌ No compatibility layer

**Risk Mitigation**:
- Comprehensive testing before merge
- Single atomic change if possible
- Rollback plan for entire integration

---

### Decision 5: ACP Session-Workspace Relationship

**Clarification**: In ACP, all sessions belong to a workspace/workdir

**Implication**:
- ACP sessions are scoped to a specific workdir
- Session lifecycle tied to workspace lifecycle
- Multiple sessions can exist per workspace

**Integration Requirement**:
- Unified `workspace` concept must encompass:
  - DeepChat: `agentWorkspacePath` (optional, for file tools)
  - ACP: `workdir` (required, session-scoped)

---

## Part II: Open Research Items

### Research Item 1: Workspace Integration

**Status**: ✅ Complete → `workspace-integration-analysis.md`, `workspace-implementation-plan.md`

**Problem Statement**:
How do we unify the workspace concept across DeepChat agents and ACP agents, given:
- DeepChat: Optional workspace path, used when file tools are invoked
- ACP: Required workdir, all sessions are workdir-scoped

**Research Completed**:
- [x] Analyze ACP session-workdir lifecycle in detail → `workspace-integration-analysis.md` Part I.2
- [x] Analyze DeepChat workspace usage patterns → `workspace-integration-analysis.md` Part I.1
- [x] Design unified workspace data model → `workspace-integration-analysis.md` Part IV
- [x] Define workspace selection UX flow → `workspace-implementation-plan.md` Part V.5
- [x] Specify workspace change handling → `workspace-implementation-plan.md` Part II.2.3

**Key Findings**:

1. **Semantic Mapping**:
   - ✅ **Decision (D-007)**: Use `workspace` as unified term
   - For ACP: Can have multiple workdirs active simultaneously (one process per workdir)
   - For DeepChat: Different conversations can have different workspaces

2. **Session-Workspace Relationship**:
   - ACP: Session belongs to workdir → Workdir is immutable for session lifetime
   - DeepChat: Conversation has optional workspace → Can be changed anytime
   - ✅ **Decision (D-009)**: Agent-type specific handling

3. **UI/UX Implications**:
   - Workspace selected at session creation via `SessionConfig.workspace`
   - Workspace appears in `SessionInfo` returned from `getSession()`
   - Workspace shown in both SessionInfo header and ChatConfig panel

4. **Data Model**:
```typescript
// Unified (SessionConfig & SessionInfo)
interface SessionConfig {
  modelId?: string
  modeId?: string
  workspace?: string  // NEW: Unified workspace/workdir field
}

interface SessionInfo {
  sessionId: string
  agentId: string
  status: 'idle' | 'generating' | 'paused' | 'error'
  workspace?: string  // NEW: For DeepChat = agentWorkspacePath, for ACP = workdir
  // ... modes, models, capabilities
}
```

**Decisions Made**:
| ID | Decision | Reference |
|----|----------|-----------|
| D-007 | Session-scoped workspace (unified model) | `workspace-integration-analysis.md` Part IV |
| D-008 | Workspace is part of SessionConfig | `workspace-integration-analysis.md` Part IV.2 |
| D-009 | Agent-type specific workspace handling | `workspace-implementation-plan.md` Part II |

**Deliverables**:
- `workspace-integration-analysis.md` - Deep analysis of current state and proposed design
- `workspace-implementation-plan.md` - Detailed implementation phases and code specifications

---

### Research Item 2: ACP Commands Representation

**Status**: ✅ Complete → `event-payload-specification.md` Part II, III, `acp-commands-specification.md`

**Problem Statement**:
ACP agents expose commands (available tools/actions) that update during execution. How should this be represented in unified events?

**Current State**:
```typescript
// ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE
{
  sessionId: string
  commands: Array<{
    name: string
    description: string
    schema?: unknown
  }>
}
```

**Key Questions**:

1. **Event Type**:
   - Use `SESSION_UPDATED` with commands in `SessionInfo`?
   - Create new `COMMANDS_UPDATED` event?
   - Include in `MESSAGE_BLOCK` with command updates?

2. **SessionInfo Structure**:
```typescript
interface SessionInfo {
  // Current fields...

  // Option A: Include commands
  availableCommands?: Array<{ name: string; description: string }>

  // Option B: Commands as separate entity
  commands?: Command[]

  // Option C: Commands in capabilities
  capabilities: {
    supportsVision: boolean
    supportsTools: boolean
    supportsModes: boolean
    commands?: Command[]  // Here?
  }
}
```

3. **Update Frequency**:
   - Commands update during agent execution
   - Should this trigger `SESSION_UPDATED` event?
   - How does renderer distinguish full session update vs commands-only update?

**Research Completed**:
- [x] Analyze ACP command lifecycle and update patterns → See Part II of `acp-commands-specification.md`
- [x] Design commands representation in SessionInfo → See Part III of `acp-commands-specification.md`
- [x] Specify event payload for command updates → See Part IV of `acp-commands-specification.md`
- [x] Define UI component for displaying commands → See Part VI of `acp-commands-specification.md`

**Key Findings**:

1. **Command Lifecycle**:
   - Commands are session-scoped (not persistent)
   - Can update dynamically during agent execution
   - Cleared on session close or agent change
   - No IPC query for initial load (event-driven only)

2. **Data Model** (Decision D-010, D-012):
```typescript
interface AgentCommand {
  name: string            // Command identifier
  description?: string    // Human-readable description
  inputHint?: string      // Flattened from input.hint
}

interface SessionInfo {
  // ... other fields
  availableCommands?: AgentCommand[]

  capabilities: {
    supportsVision: boolean
    supportsTools: boolean
    supportsModes: boolean
    supportsCommands?: boolean  // Type-safe check
  }
}
```

3. **Event Mapping** (Decision D-011):
   - `ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE` → `AgenticEventType.SESSION_UPDATED`
   - Payload: `{ availableCommands: AgentCommand[] }`
   - Single unified event for all session metadata

4. **Implementation Gaps Identified**:
   - Command update handler not yet implemented in `AcpProcessManager`
   - `inputHint` field missing from main process command type
   - No UI component for displaying commands

5. **UI Component Design**:
   - `CommandsDisplay.vue` - Shows available commands with icons, descriptions, hints
   - Collapsible list (max 5 visible before collapse)
   - Click handler to insert command invocation into chat input
   - Integration: `ChatConfig` panel, compact badge in session header

**Decisions Made**:
| ID | Decision | Reference |
|----|----------|-----------|
| D-010 | Include `availableCommands` in SessionInfo | Consistent with modes/models pattern |
| D-011 | Use `SESSION_UPDATED` for command updates | Single event for all session changes |
| D-012 | Flatten `input.hint` to `inputHint` | Simpler property structure |
| D-013 | Add `capabilities.supportsCommands` | Type-safe command capability check |
| D-014 | Create dedicated `CommandsDisplay` component | Better UX than inline rendering |
| D-015 | Commands are session-scoped, not persistent | Matches ACP protocol design |

**Deliverables**:
- `event-payload-specification.md` - Event payload specification (Part II, III)
- `acp-commands-specification.md` - Complete command lifecycle, data model, UI component spec

---

### Research Item 3: ACP Modes and Models Representation

**Status**: ✅ Complete → `event-payload-specification.md` Part II, III, `acp-modes-models-specification.md`

**Problem Statement**:
ACP agents have dynamic modes (permission policies) and models (available within session). How are these represented in `SessionInfo`?

**Current State**:
```typescript
// ACP_WORKSPACE_EVENTS.SESSION_MODES_READY
{
  sessionId: string
  current: string  // current mode ID
  available: Array<{ id: string; name: string; description: string }>
}

// ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY
{
  sessionId: string
  current: string  // current model ID
  available: Array<{ id: string; name: string; description: string }>
}
```

**Key Questions**:

1. **SessionInfo Structure**:
```typescript
interface SessionInfo {
  currentModeId?: string
  availableModes?: Array<{ id: string; name: string; description: string }>

  currentModelId?: string
  availableModels?: Array<{ id: string; name: string; description?: string }>

  // Are these sufficient for ACP's dynamic nature?
  // How do we handle updates during session?
}
```

2. **Update Events**:
   - Are modes/models set at session creation only?
   - Can they change during session lifetime?
   - If they change, what event is emitted?

3. **DeepChat Modes**:
   - DeepChat has modes: strict, balanced, permissive (permission policies)
   - Are these represented the same way?
   - Or are they different concepts?

**Research Completed**:
- [x] Analyze ACP mode/model lifecycle → See Part II of `acp-modes-models-specification.md`
- [x] Analyze DeepChat mode implementation → See Part II.3-II.4 of `acp-modes-models-specification.md`
- [x] Design unified modes/models representation → See Part III of `acp-modes-models-specification.md`
- [x] Specify update event handling → See Part IV of `acp-modes-models-specification.md`

**Key Findings**:

1. **Mode Concepts** (Decision D-019):
   - **DeepChat**: Static permission policies (strict, balanced, permissive)
   - **ACP**: Dynamic modes declared by agent (e.g., "default", "high-security")
   - **Unified**: Same `SessionInfo` structure, presenter abstracts differences

2. **Model Concepts**:
   - **DeepChat**: Config-based provider models (format: `providerId:modelId`)
   - **ACP**: Agent-declared session-scoped models (format: plain `modelId`)
   - **Unified**: Same `SessionInfo.availableModels` structure

3. **Lifecycle Patterns**:

| Property | DeepChat | ACP |
|----------|----------|-----|
| `availableModes` | Static (3 hardcoded) | Dynamic (fetched from agent) |
| `currentModeId` | Stored in `sessionModes` Map | Fetched from agent state |
| `availableModels` | Static (from provider config) | Dynamic (fetched from agent) |
| `currentModelId` | From `conversation.settings` | From agent state |

4. **ACP Lifecycle**:
```
Before Session Created:
  1. User selects workdir
  2. Load warmup modes/models: getAcpProcessModes/Models()
  3. Display selectors

Session Created:
  4. Send first message → Session created
  5. Load session modes/models: getAcpSessionModes/Models()
  6. Listen for SESSION_MODES/MODELS_READY events

During Session:
  7. Agent emits update → SESSION_UPDATED event
```

5. **Event Mapping** (Decision D-011):
   - `ACP_WORKSPACE_EVENTS.SESSION_MODES_READY` → `AgenticEventType.SESSION_UPDATED`
   - `ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY` → `AgenticEventType.SESSION_UPDATED`
   - DeepChat emits `SESSION_UPDATED` on `setMode()`/`setModel()` (Decision D-018)

6. **Data Model** (Decision D-016):
```typescript
// Both agent types use same structure
interface SessionInfo {
  availableModes?: Array<{ id: string; name: string; description: string }>
  currentModeId?: string
  availableModels?: Array<{ id: string; name: string; description?: string }>
  currentModelId?: string
  capabilities: {
    supportsModes: boolean  // true if agent has modes
    // ...
  }
}
```

7. **Implementation Gaps**:
   - DeepChat doesn't emit `SESSION_UPDATED` on mode/model change
   - ACP normalizer doesn't handle modes/models events yet
   - No unified composables for mode/model selection

**Decisions Made**:
| ID | Decision | Reference |
|----|----------|-----------|
| D-011 | Use `SESSION_UPDATED` for modes/models | Single event for all session metadata |
| D-016 | Unified SessionInfo structure | Same structure for all agent types |
| D-017 | DeepChat model ID format with providerId prefix | Ensures uniqueness across providers |
| D-018 | DeepChat emits SESSION_UPDATED on mode/model change | Notify renderer of changes |
| D-019 | ACP modes/models are session-scoped | Matches ACP protocol design |
| D-020 | DeepChat modes are static (hardcoded) | Permission policies don't change |

**Deliverables**:
- `event-payload-specification.md` - Event payload specification (Part II, III)
- `acp-modes-models-specification.md` - Complete lifecycle, data model, UI components spec

---

### Research Item 4: Component Specifications

**Status**: ✅ Complete → `unified-components-specification.md`

**Problem Statement**:
New unified components need detailed specifications before implementation.

**Research Completed**:
- [x] Analyze existing component patterns (`AcpModeSelector`, `AcpSessionModelSelector`, `ModelSelector`)
- [x] Specify `AgentHeader` component → See Part II of `unified-components-specification.md`
- [x] Specify `UnifiedModelSelector` component → See Part III of `unified-components-specification.md`
- [x] Specify `UnifiedModeSelector` component → See Part IV of `unified-components-specification.md`
- [x] Specify `WorkspaceSelector` component → See Part V of `unified-components-specification.md`

**Key Findings**:

1. **Design Principles** (Decision D-025):
   - Agent-agnostic interface (works with DeepChat and ACP)
   - SessionInfo-driven (all data from `useAgenticSession`)
   - Presenter-based (state changes through `AgenticPresenter`)
   - No branching logic in components

2. **Component Hierarchy**:
```
ChatInput.vue
├── AgentHeader (NEW) - Agent name, icon, status, capabilities
├── UnifiedModelSelector (NEW) - Model selection for all agents
├── UnifiedModeSelector (NEW) - Mode selection for all agents
├── WorkspaceSelector (NEW) - Workspace selection with agent-specific behavior
└── CommandsDisplay (from acp-commands-specification.md) - ACP commands
```

3. **Agent Type Differences**:

| Aspect | DeepChat | ACP |
|--------|----------|-----|
| **Model ID Format** | `providerId:modelId` | Plain `modelId` |
| **Model Source** | Provider config (static) | Agent declaration (dynamic) |
| **Mode Type** | Permission policies (3 static) | Agent modes (dynamic) |
| **Workspace** | Optional, mutable | Required, immutable |

4. **Component Specs Completed**:

| Component | Props | Visual Design | Integration |
|-----------|-------|---------------|-------------|
| **AgentHeader** | sessionId, compact, showStatus | Status indicator, capability badges | Emits config/workspace/retry clicks |
| **UnifiedModelSelector** | sessionId, disabled, showProvider | Dropdown with model list | Emits model-select event |
| **UnifiedModeSelector** | sessionId, showDescription | Dropdown with mode descriptions | Only visible when supported |
| **WorkspaceSelector** | sessionId, editable, compact | Path display with change button | ACP: immutable, DeepChat: mutable |

5. **Data Source** (Decision D-025):
All components use `useAgenticSession` composable:
```typescript
const { sessionInfo, availableModes, availableModels, currentModelId, currentModeId, hasWorkspace } =
  useAgenticSession(() => props.sessionId)
```

6. **Event Flow** (Decision D-026):
```
User Action → Component emits event → Parent calls presenter → Presenter emits SESSION_UPDATED → Component re-renders
```

7. **Implementation Gaps**:
- `useAgenticSession` composable not yet created
- Old components still in use (AcpModeSelector, AcpSessionModelSelector, ModelSelector)
- ChatInput.vue needs component replacement
- ChatConfig.vue needs component integration

**Decisions Made**:
| ID | Decision | Reference |
|----|----------|-----------|
| D-021 | Create AgentHeader component | Centralized agent info display |
| D-022 | Single UnifiedModelSelector for all agents | Eliminates branching logic |
| D-023 | Single UnifiedModeSelector for all agents | Eliminates branching logic |
| D-024 | Single WorkspaceSelector with agent-specific behavior | Presenter abstracts differences |
| D-025 | All components use useAgenticSession composable | Single data source |
| D-026 | Components emit events, parent calls presenter | Separation of concerns |
| D-027 | Status indicator uses pulse animation | Clear visual feedback |
| D-028 | ACP workdir immutable, show error on change | User education |
| D-029 | Workspace path truncation with ~ substitution | Better UX |
| D-030 | Tooltip for mode descriptions | Better UX without clutter |

**Deliverable**:
- `unified-components-specification.md` - Complete specification for all 4 components (~550 lines)
  - Part I: Component strategy overview
  - Part II: AgentHeader specification
  - Part III: UnifiedModelSelector specification
  - Part IV: UnifiedModeSelector specification
  - Part V: WorkspaceSelector specification
  - Part VI: Implementation checklist
  - Part VII: Architectural decisions

---

### Research Item 5: State Management Refactoring

**Status**: ✅ Complete → `state-management-refactoring-spec.md`

**Problem Statement**:
Current state management (`useChatStoreService`) has ~700 lines with agent-type branching. How to refactor for unified interface?

**Research Completed**:
- [x] Map current state dependencies → See Part I of `state-management-refactoring-spec.md`
- [x] Design new state structure (sessionId-based) → See Part III of `state-management-refactoring-spec.md`
- [x] Define state migration strategy → See Part V of `state-management-refactoring-spec.md`
- [x] Specify composable reorganization → See Part IV of `state-management-refactoring-spec.md`

**Key Findings**:

1. **Current Architecture Issues**:
   - `threadId` terminology everywhere (should be `sessionId`)
   - Agent-type branching (`isAcpMode` computed returns `false`)
   - Tightly coupled composables (10+ dependencies)
   - Event fragmentation (STREAM_EVENTS, ACP_WORKSPACE_EVENTS)
   - No unified SessionInfo in state

2. **New State Structure** (Decision D-033, D-034):
```typescript
// Before
const activeThreadId = ref<string | null>(null)
const threads = ref<{ dt: string; dtThreads: CONVERSATION[] }[]>([])
const generatingThreadIds = ref(new Set<string>())
const threadsWorkingStatus = ref<Map<string, WorkingStatus>>(new Map())

// After
const activeSessionId = ref<string | null>(null)
const sessions = ref<SessionInfo[]>([])  // Flat array
const generatingSessionIds = ref(new Set<string>())
const sessionsWorkingStatus = ref<Map<string, WorkingStatus>>(new Map())
const sessionMetadata = ref<Map<string, SessionMetadata>>(new Map())  // NEW
```

3. **Terminology Migration** (Decision D-031):
| Old | New |
|-----|-----|
| `threadId` | `sessionId` |
| `activeThreadId` | `activeSessionId` |
| `threads` | `sessions` |
| `generatingThreadIds` | `generatingSessionIds` |
| `threadsWorkingStatus` | `sessionsWorkingStatus` |

4. **Composable Reorganization** (Decision D-035):
| Old Composable | New Composable | Changes |
|----------------|----------------|---------|
| `useChatStoreService` | `useAgenticSessionStore` | Complete rewrite |
| `useChatAdapter` | `useAgenticAdapter` | Uses AgenticPresenter |
| `useChatConfig` | `useSessionConfig` | SessionInfo-driven |
| `useThreadManagement` | `useSessionManagement` | sessionId-based |
| `useChatEvents` | `useAgenticEvents` | AgenticEventType |
| `useExecutionAdapter` | `useAgenticExecution` | Uses AgenticPresenter |
| `useMessageStreaming` | (unchanged) | Already agent-agnostic |
| `useMessageCache` | (unchanged) | Already agent-agnostic |

5. **New Composable: `useAgenticSession`**:
```typescript
// Exposes all session metadata from SessionInfo
const {
  sessionInfo,
  agentId,
  status,
  availableModes,
  currentModeId,
  availableModels,
  currentModelId,
  availableCommands,
  workspace,
  capabilities
} = useAgenticSession(() => activeSessionId.value)
```

6. **Migration Phases**:
   - Phase 1: Create new composables alongside old ones
   - Phase 2: Terminology update (threadId → sessionId)
   - Phase 3: Event system migration (AgenticEventType)
   - Phase 4: Composable replacement
   - Phase 5: Store replacement
   - Phase 6: Cleanup

7. **Component Migration Order** (Decision D-036):
   - Independent components (no state usage)
   - Low-dependency components (MessageList, ChatInput)
   - Medium-dependency components (ThreadList, ChatConfig)
   - High-dependency components (ChatView, App.vue)

8. **State Dependencies**:
```
activeSessionId
  ├── sessions (filtered by active)
  ├── messageIds (for active session)
  ├── generatingSessionIds (contains active)
  ├── selectedVariantsMap (indexed by messageId)
  ├── generatingMessagesCache (contains sessionId)
  └── sessionsWorkingStatus (contains active)
```

**Decisions Made**:
| ID | Decision | Reference |
|----|----------|-----------|
| D-031 | Direct find-and-replace for terminology migration | Consistent with Decision 1 |
| D-032 | No backward compatibility layer | Cleaner code, single atomic change |
| D-033 | Use flat sessions array instead of dt/dtThreads | Simpler data structure |
| D-034 | Add sessionMetadata Map to store SessionInfo | Efficient lookup |
| D-035 | Create new composables alongside old ones then replace | Reduces risk |
| D-036 | Component migration order: low to high dependency | Minimizes cascading changes |
| D-037 | Remove isAcpMode and activeAcpAgentId (always false/null) | ACP mode removed |
| D-038 | Keep useMessageStreaming and useMessageCache unchanged | Already agent-agnostic |

**Deliverable**:
- `state-management-refactoring-spec.md` - Complete refactoring specification (~500 lines)
  - Part I: Current state analysis
  - Part II: Terminology migration
  - Part III: New state structure
  - Part IV: Composable reorganization
  - Part V: Migration strategy
  - Part VI: Implementation checklist
  - Part VII: Architectural decisions
  - Part VIII: Risk mitigation

---

### Research Item 6: Session Lifecycle Management

**Status**: ✅ Complete → `session-lifecycle-specification.md`

**Problem Statement**:
How to handle session creation, loading, and closing in unified interface?

**Research Completed**:
- [x] Analyze current session creation flows → See Part I of `session-lifecycle-specification.md`
- [x] Analyze current session loading flows → See Part I of `session-lifecycle-specification.md`
- [x] Design unified session lifecycle → See Part II of `session-lifecycle-specification.md`
- [x] Specify cleanup procedures → See Part V of `session-lifecycle-specification.md`

**Key Findings**:

1. **Current State Analysis**:

| Aspect | DeepChat | ACP |
|--------|----------|-----|
| **Storage** | SQLite (`chat.db`) | In-memory only |
| **Persistence** | Persistent across app restarts | Lost on app restart |
| **Session ID** | `conversationId` (nanoid) | `sessionId` (nanoid) |
| **Workspace** | Optional (`agentWorkspacePath`) | Required (`workdir`) |
| **Mutability** | Settings can change anytime | Workdir is immutable |
| **Loading** | Always loads from SQLite | Falls back to creation if not in memory |
| **Cleanup** | Just clear active binding | Full cleanup (handlers, connection) |

2. **Unified SessionConfig** (Decision D-039):
```typescript
// Target unified interface
const sessionId = await agenticP.createSession(agentId, {
  modelId?: string
  modeId?: string
  workspace?: string
  title?: string  // DeepChat only
  // Agent-specific config via index signature
})
```

3. **Unified Session Creation Flow**:
```
User creates session
  → Renderer calls agenticP.createSession(agentId, config)
  → AgenticPresenter routes to appropriate presenter
  → Agent presenter handles creation:
    - DeepChat: SQLite INSERT, return conversationId
    - ACP: Get/create process, create session in memory
  → AgenticPresenter tracks session (sessionToPresenter Map)
  → Emit SESSION_CREATED event with SessionInfo
  → Renderer adds session to state, loads messages
```

4. **Unified Session Loading Flow**:
```
User opens existing session
  → Renderer calls agenticP.loadSession(sessionId, { tabId, activate })
  → AgenticPresenter routes to appropriate presenter
  → Agent presenter handles loading:
    - DeepChat: Load from SQLite, set active
    - ACP: Check memory → return existing OR fallback to createSession
  → Renderer updates state, loads messages
```

5. **Unified Session Closing Flow**:
```
User closes session
  → Renderer calls agenticP.closeSession(sessionId)
  → AgenticPresenter routes to appropriate presenter
  → Agent presenter handles closing:
    - DeepChat: Clear active binding, data persists
    - ACP: Remove from memory, detach handlers, cancel connection
  → AgenticPresenter cleans up (remove from Map, clean emitter)
  → Emit SESSION_CLOSED event
  → Renderer updates state, clears messages
```

6. **Cleanup Differences** (Decision D-044):
   - **DeepChat**: Minimal cleanup - data persists in SQLite
   - **ACP**: Complete cleanup - data is lost, must clean handlers, cancel connection
   - **App shutdown**: Close ACP sessions first (they need cleanup), DeepChat persists

7. **Error Handling**:
   - **Creation failures**: Both throw errors, renderer shows user-facing message
   - **Loading failures**:
     - DeepChat: Throws error if conversation not found
     - ACP: Falls back to createSession() if session not in memory
   - **Closing failures**: Log warning, continue (non-critical operation)

**Decisions Made**:
| ID | Decision | Reference |
|----|----------|-----------|
| D-039 | SessionConfig as unified interface | Single createSession() for all agents |
| D-040 | Agent-specific session persistence | DeepChat persists, ACP doesn't |
| D-041 | ACP workdir is immutable | Matches ACP protocol design |
| D-042 | ACP session loading falls back to creation | No persistence in ACP protocol |
| D-043 | Unified SESSION_CREATED/SESSION_CLOSED events | Single event system for all agents |
| D-044 | App shutdown closes ACP sessions first | ACP needs cleanup, DeepChat persists |
| D-045 | sessionId → presenter mapping in AgenticPresenter | Efficient routing for session operations |
| D-046 | LoadContext excludes tabId (derived from IPC) | Chat windows use single WebContents, windowId derived from IPC context |

**Deliverable**:
- `session-lifecycle-specification.md` - Complete session lifecycle specification (~400 lines)
  - Part I: Current state analysis (DeepChat vs ACP)
  - Part II: Unified session lifecycle flows
  - Part III: Agent presenter implementations
  - Part IV: Renderer session management
  - Part V: Cleanup procedures
  - Part VI: Error handling
  - Part VII: Implementation checklist
  - Part VIII: Architectural decisions

---

## Part III: Exploration Propositions

### Proposition 1: Workspace Concept Deep Dive

**Research Question**: What IS a workspace in the DeepChat context?

**Exploration Tasks**:
1. **Workspace Semantics**:
   - Interview stakeholders: What does "workspace" mean to users?
   - Is workspace a project root? A codebase directory? A working directory?
   - How do users currently think about workspaces?

2. **Current Usage Analysis**:
   - Search all workspace-related code
   - Map workspace usage patterns in DeepChat agents
   - Map workdir usage patterns in ACP agents
   - Find all workspace-related UI components

3. **ACP Workspace Model**:
   - Read ACP documentation on workspace/workdir
   - Understand ACP session-workdir lifecycle
   - Document all ACP workspace operations

4. **User Scenarios**:
   - Scenario 1: User switches workspace during active session
   - Scenario 2: User has multiple conversations with different workspaces
   - Scenario 3: User opens ACP agent without workspace selected
   - Scenario 4: User loads historical session with old workspace

**Deliverable**: Workspace concept analysis document with recommendations

---

### Proposition 2: Event Payload Specification

**Research Question**: What should `AgenticEventType` payloads contain for ACP-specific data?

**Exploration Tasks**:
1. **Current Event Analysis**:
   - Document all `ACP_WORKSPACE_EVENTS` payloads
   - Document all `STREAM_EVENTS` payloads
   - Identify missing event types

2. **SessionInfo Structure**:
   - What fields are required for all agents?
   - What fields are agent-specific?
   - How to handle agent-specific extensions?

3. **Event Payload Design**:
   - Design `SESSION_UPDATED` payload for modes update
   - Design `SESSION_UPDATED` payload for models update
   - Design `SESSION_UPDATED` payload for commands update
   - Consider separate events vs unified

**Deliverable**: Complete `AgenticEventType` payload specification

---

### Proposition 3: Component UX Patterns

**Research Question**: How should unified components behave from user perspective?

**Exploration Tasks**:
1. **UX Audit**:
   - Document current `ModelSelector` UX flow
   - Document current `AcpSessionModelSelector` UX flow
   - Document current `AcpModeSelector` UX flow
   - Identify pain points and inconsistencies

2. **User Scenarios**:
   - Scenario: User selects model for new conversation
   - Scenario: User switches model mid-conversation
   - Scenario: User selects mode for ACP agent
   - Scenario: User changes workspace

3. **UI Mockups**:
   - Create mockups for `AgentHeader`
   - Create mockups for `UnifiedModelSelector`
   - Create mockups for `UnifiedModeSelector`
   - Create mockups for `WorkspaceSelector`

4. **Accessibility**:
   - Keyboard navigation for model/mode selection
   - Screen reader support
   - High contrast mode support

**Deliverable**: Component UX specification with mockups

---

### Proposition 4: Error Handling & Recovery

**Research Question**: How should errors be handled in unified system?

**Exploration Tasks**:
1. **Error Types**:
   - Document all current error scenarios
   - Categorize errors by severity and recoverability
   - Identify agent-specific errors

2. **Error Events**:
   - How is `AgenticEventType.ERROR` structured?
   - What context is included?
   - How are errors displayed to users?

3. **Recovery Strategies**:
   - Session creation failure → retry? fallback?
   - Message send failure → retry? cancel?
   - Workspace access failure → prompt for new workspace?

**Deliverable**: Error handling specification

---

### Proposition 5: Performance Considerations

**Research Question**: What performance impacts will the integration have?

**Exploration Tasks**:
1. **Event Overhead**:
   - Measure current event frequency
   - Estimate unified event frequency
   - Identify potential bottlenecks

2. **State Management**:
   - Measure current state update frequency
   - Estimate unified state update frequency
   - Identify optimization opportunities

3. **Component Rendering**:
   - Identify expensive re-renders
   - Analyze virtual scrolling impact
   - Consider lazy loading strategies

**Deliverable**: Performance analysis document with recommendations

---

## Part IV: Implementation Considerations

### Consideration 1: Atomic Change vs. Incremental

**Question**: Should this be a single atomic change or incremental steps?

**Factors**:
- **Atomic Change**: Single PR, all-or-nothing, high risk if bugs
- **Incremental**: Multiple PRs, can validate each step, but intermediate states may be inconsistent

**Recommendation**: Discuss before implementation

---

### Consideration 2: Testing Strategy

**Question**: How do we test the integration without full system coverage?

**Factors**:
- Unit tests for composables
- Integration tests for event flow
- E2E tests for user scenarios
- Manual testing checklist

**Research Required**:
- [ ] Define test coverage requirements
- [ ] Identify test gaps in current coverage
- [ ] Design test data fixtures

---

### Consideration 3: Documentation Requirements

**Question**: What documentation needs to be created/updated?

**Documentation Types**:
- Architecture diagrams (updated)
- Component specs (new)
- API documentation (updated)
- User documentation (updated)
- Migration guide (if needed)

---

## Part V: Next Steps

### Immediate Actions (This Week)

1. ✅ Create this analysis document
2. ✅ **Workspace Deep Dive** (Proposition 1) - HIGHEST PRIORITY → `workspace-integration-analysis.md`
3. ✅ **Event Payload Specification** (Proposition 2) → `event-payload-specification.md`
4. [ ] **Component Specs** - Start with AgentHeader

### Short-Term Actions (Next 2 Weeks)

5. [ ] Complete all research items marked 🔴 HIGH
6. [ ] Draft component specifications
7. ✅ Design unified workspace data model → `workspace-integration-analysis.md` Part IV

### Medium-Term Actions (Next Month)

8. [ ] Complete all research items
9. [ ] Finalize all component specifications
10. [ ] Create detailed implementation plan
11. [ ] Write implementation tasks to `tasks.md`

---

## Part VI: Decision Log

This section records all architectural decisions made during the research phase.

| ID | Date | Decision | Rationale | Status |
|----|------|----------|-----------|--------|
| D-001 | 2025-01-25 | Use `sessionId` exclusively in renderer | Eliminate terminology inconsistency | ✅ Confirmed |
| D-002 | 2025-01-25 | Keep `conversationId` in SQLite | Database stability, no migration needed | ✅ Confirmed |
| D-003 | 2025-01-25 | Extend `AgenticEventType` to cover all events | Single unified event format | ✅ Confirmed |
| D-004 | 2025-01-25 | Create new components only | Clean break from legacy patterns | ✅ Confirmed |
| D-005 | 2025-01-25 | No backward compatibility layer | Direct replacement, green-field | ✅ Confirmed |
| D-006 | 2025-01-25 | ACP sessions belong to workspace | Clarified ACP session model | ✅ Confirmed |
| D-007 | 2026-01-25 | Use session-scoped workspace (unified model) | Aligns with ACP, presenter abstracts difference | ✅ Confirmed |
| D-008 | 2026-01-25 | Workspace is part of SessionConfig | Specified at session creation, returned in SessionInfo | ✅ Confirmed |
| D-009 | 2026-01-25 | Agent-type specific workspace handling | DeepChat: optional (SQLite fallback), ACP: required (temp fallback) | ✅ Confirmed |
| D-010 | 2026-01-25 | Include `availableCommands` in SessionInfo | Consistent with modes/models pattern | ✅ Confirmed |
| D-011 | 2026-01-25 | Use `SESSION_UPDATED` for all session metadata | Single event for all session changes (modes, models, commands) | ✅ Confirmed |
| D-012 | 2026-01-25 | Flatten command `input.hint` to `inputHint` | Simpler property structure | ✅ Confirmed |
| D-013 | 2026-01-25 | Add `capabilities.supportsCommands` | Type-safe command capability check | ✅ Confirmed |
| D-014 | 2026-01-25 | Create dedicated `CommandsDisplay` component | Better UX than inline rendering | ✅ Confirmed |
| D-015 | 2026-01-25 | Commands are session-scoped, not persistent | Matches ACP protocol design | ✅ Confirmed |
| D-016 | 2026-01-25 | Unified SessionInfo structure for modes/models | Same structure for all agent types | ✅ Confirmed |
| D-017 | 2026-01-25 | DeepChat model ID format with providerId prefix | Ensures uniqueness across providers | ✅ Confirmed |
| D-018 | 2026-01-25 | DeepChat emits SESSION_UPDATED on mode/model change | Notify renderer of changes | ✅ Confirmed |
| D-019 | 2026-01-25 | ACP modes/models are session-scoped | Matches ACP protocol design | ✅ Confirmed |
| D-020 | 2026-01-25 | DeepChat modes are static (hardcoded) | Permission policies don't change | ✅ Confirmed |
| D-021 | 2026-01-25 | Create AgentHeader component | Centralized agent info display, consistent with unified design | ✅ Confirmed |
| D-022 | 2026-01-25 | Single UnifiedModelSelector for all agent types | Eliminates branching logic, consistent UX | ✅ Confirmed |
| D-023 | 2026-01-25 | Single UnifiedModeSelector for all agent types | Eliminates branching logic, consistent UX | ✅ Confirmed |
| D-024 | 2026-01-25 | Single WorkspaceSelector with agent-specific behavior | Presenter abstracts agent differences | ✅ Confirmed |
| D-025 | 2026-01-25 | All components use useAgenticSession composable | Single data source, consistent updates | ✅ Confirmed |
| D-026 | 2026-01-25 | Components emit events, parent calls presenter | Separation of concerns, testability | ✅ Confirmed |
| D-027 | 2026-01-25 | Status indicator in AgentHeader uses pulse animation | Clear visual feedback for generating state | ✅ Confirmed |
| D-028 | 2026-01-25 | ACP workdir immutable, show error on change attempt | User education about ACP constraints | ✅ Confirmed |
| D-029 | 2026-01-25 | Workspace path truncation with ~ substitution | Better UX for long paths | ✅ Confirmed |
| D-030 | 2026-01-25 | Tooltip for mode descriptions | Better UX without cluttering UI | ✅ Confirmed |
| D-031 | 2026-01-25 | Direct find-and-replace for terminology migration | Consistent with Decision 1 (no backward compatibility) | ✅ Confirmed |
| D-032 | 2026-01-25 | No backward compatibility layer during state refactoring | Cleaner code, single atomic change | ✅ Confirmed |
| D-033 | 2026-01-25 | Use flat sessions array instead of dt/dtThreads structure | Simpler data structure, easier to manage | ✅ Confirmed |
| D-034 | 2026-01-25 | Add sessionMetadata Map to store SessionInfo per session | Efficient lookup, supports multiple sessions | ✅ Confirmed |
| D-035 | 2026-01-25 | Create new composables alongside old ones then replace | Reduces risk, allows gradual migration | ✅ Confirmed |
| D-036 | 2026-01-25 | Component migration order: low to high dependency | Minimizes cascading changes | ✅ Confirmed |
| D-037 | 2026-01-25 | Remove isAcpMode and activeAcpAgentId (always false/null) | ACP mode removed from codebase | ✅ Confirmed |
| D-038 | 2026-01-25 | Keep useMessageStreaming and useMessageCache unchanged | Already agent-agnostic, no changes needed | ✅ Confirmed |
| D-039 | 2026-01-25 | SessionConfig as unified interface | Single createSession() for all agents | ✅ Confirmed |
| D-040 | 2026-01-25 | Agent-specific session persistence | DeepChat persists, ACP doesn't | ✅ Confirmed |
| D-041 | 2026-01-25 | ACP workdir is immutable | Matches ACP protocol design | ✅ Confirmed |
| D-042 | 2026-01-25 | ACP session loading falls back to creation | No persistence in ACP protocol | ✅ Confirmed |
| D-043 | 2026-01-25 | Unified SESSION_CREATED/SESSION_CLOSED events | Single event system for all agents | ✅ Confirmed |
| D-044 | 2026-01-25 | App shutdown closes ACP sessions first | ACP needs cleanup, DeepChat persists | ✅ Confirmed |
| D-045 | 2026-01-25 | sessionId → presenter mapping in AgenticPresenter | Efficient routing for session operations | ✅ Confirmed |
| D-046 | 2026-01-25 | LoadContext excludes tabId (derived from IPC) | Chat windows use single WebContents, windowId derived from IPC context | ✅ Updated 2026-01-25 |

---

## Part VII: Open Questions for Discussion

This section tracks questions that arise during research and require team discussion.

| ID | Question | Raised By | Status | Resolution |
|----|----------|-----------|--------|------------|
| Q-001 | How to represent ACP commands in `SessionInfo`? | Research | ✅ Resolved | **D-010**: Include `availableCommands` in SessionInfo |
| Q-002 | Should workspace be a separate entity or part of session config? | Research | ✅ Resolved | **D-008**: Workspace is part of SessionConfig |
| Q-003 | How to handle workspace change during active session? | Research | ✅ Resolved | Agent-specific: DeepChat mutable, ACP immutable |
| Q-004 | What's the UX for model selection with ACP session models? | Research | 🟡 Open | - |
| Q-005 | Should modes/models be in `SessionInfo` or separate query? | Research | ✅ Resolved | **D-011**: Use `SESSION_UPDATED` for all session metadata |

---

## Appendix: File Reference

### Created Documents
- `agentic-unified-presenter.md` - Presenter layer achievements
- `renderer-investigation.md` - Current renderer architecture
- `renderer-integration-design.md` - Initial design proposal
- `renderer-analysis-research.md` - **THIS DOCUMENT**
- `workspace-integration-analysis.md` - Workspace concept deep dive (Research Item 1)
- `workspace-implementation-plan.md` - Workspace implementation specification (Research Item 1)
- `event-payload-specification.md` - Event payload specification (Decision 2, Research Items 2-3)
- `acp-commands-specification.md` - ACP commands lifecycle and UI component spec (Research Item 2)
- `acp-modes-models-specification.md` - ACP modes/models lifecycle and UI components spec (Research Item 3)
- `unified-components-specification.md` - Unified components specification (Research Item 4)
- `state-management-refactoring-spec.md` - State management refactoring specification (Research Item 5)
- `session-lifecycle-specification.md` - Session lifecycle management specification (Research Item 6)

### Related Documents
- `agent-abstraction-layer.md` - Original unified layer design
- `agent-system.md` - Agent system details
- `event-system.md` - Event system architecture
- `session-management.md` - Session management details

### Key Investigation Files
- `src/main/presenter/agenticPresenter/` - Unified presenter implementation
- `src/renderer/src/composables/chat/useChatStoreService.ts` - Main state management
- `src/renderer/src/composables/chat/useExecutionAdapter.ts` - Message execution
- `src/renderer/src/composables/chat/useMessageStreaming.ts` - Stream processing
