# State Management Refactoring - Agentic Layer

## Document Purpose

This document specifies the complete refactoring of renderer state management to support the unified agentic layer.

**Status**: Implementation Specification
**Date**: 2026-01-25
**Related**: Research Item 5 from `renderer-analysis-research.md`, Decision 1 (Terminology - Unified sessionId)

---

## Part I: Current State Analysis

### 1.1 Current Architecture

```
useChatStoreService (727 lines)
├── Core State
│   ├── activeThreadId: Ref<string | null>
│   ├── threads: Ref<Array<{ dt, dtThreads: CONVERSATION[] }>>
│   ├── messageIds: Ref<string[]>
│   ├── messageCacheVersion: Ref<number>
│   ├── generatingThreadIds: Ref<Set<string>>
│   ├── generatingMessagesCache: Ref<Map<string, { message, threadId }>>
│   ├── selectedVariantsMap: Ref<Record<string, string>>
│   └── threadsWorkingStatus: Ref<Map<string, WorkingStatus>>
│
├── Composables (10+)
│   ├── useConversationCore - Database operations
│   ├── useChatAdapter - IPC bridge
│   ├── useChatConfig - Configuration management
│   ├── useThreadManagement - Thread CRUD operations
│   ├── useMessageCache - Message caching/prefetching
│   ├── useVariantManagement - Message variants
│   ├── useExecutionAdapter - Message execution
│   │   └── useMessageStreaming - Stream processing
│   ├── useChatEvents - Event listeners
│   ├── useChatAudio - Audio feedback
│   ├── useThreadExport - Export functionality
│   └── useDeeplink - Deeplink handling
│
└── Issues
    ├── Agent-type branching (isAcpMode checks)
    ├── threadId terminology (should be sessionId)
    ├── No unified event system (uses STREAM_EVENTS, ACP_WORKSPACE_EVENTS)
    └── Tightly coupled composables
```

### 1.2 Key Issues Identified

| Issue | Impact | Location |
|-------|--------|----------|
| **Terminology** | `threadId` everywhere, should be `sessionId` | All composables |
| **Agent branching** | `isAcpMode` computed that returns `false` (ACP mode removed) | `useChatStoreService.ts:103` |
| **Tight coupling** | Composables pass many refs to each other | `useChatStoreService.ts:78-84` |
| **Event fragmentation** | Multiple event systems (STREAM_EVENTS, ACP_WORKSPACE_EVENTS) | `useChatEvents.ts` |
| **No SessionInfo** | No unified session metadata | Missing |
| **Message cache key** | Uses `threadId` in cache key | `generatingMessagesCache` |

### 1.3 State Dependencies

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    State Dependency Graph                               │
└─────────────────────────────────────────────────────────────────────────┘

activeThreadId
  ├── threads (filtered by active)
  ├── messageIds (for active thread)
  ├── generatingThreadIds (contains active)
  ├── selectedVariantsMap (indexed by messageId)
  ├── generatingMessagesCache (contains threadId)
  └── threadsWorkingStatus (contains active)

Composables Dependencies:
  - useThreadManagement: activeThreadId, threads, messageIds, ...
  - useMessageCache: messageIds, messageCacheVersion
  - useExecutionAdapter: activeThreadId, selectedVariantsMap, ...
  - useChatConfig: activeThreadId, threads, selectedVariantsMap
  - useVariantManagement: activeThreadId, selectedVariantsMap, ...
```

---

## Part II: Terminology Migration

### 2.1 Migration Map

| Old Terminology | New Terminology | Files Affected |
|-----------------|-----------------|----------------|
| `threadId` | `sessionId` | All composables, state refs |
| `conversationId` | `sessionId` (renderer only) | All renderer code |
| `activeThreadId` | `activeSessionId` | All state refs |
| `threads` | `sessions` | State refs |
| `getActiveThreadId()` | `getActiveSessionId()` | All API surfaces |
| `setActiveThreadId()` | `setActiveSessionId()` | All API surfaces |
| `threadManagementComposable` | `sessionManagementComposable` | Variable names |

### 2.2 Renaming Strategy

**Decision D-031**: Direct find-and-replace with validation

```bash
# Phase 1: State refs
activeThreadId → activeSessionId
generatingThreadIds → generatingSessionIds
threadsWorkingStatus → sessionsWorkingStatus
threads → sessions

# Phase 2: Functions
getActiveThreadId → getActiveSessionId
setActiveThreadId → setActiveSessionId
loadThreadMessages → loadSessionMessages

# Phase 3: Composables
useThreadManagement → useSessionManagement
useThreadExport → useSessionExport
```

---

## Part III: New State Structure

### 3.1 Unified Session State

```typescript
// src/renderer/src/composables/chat/types.ts

export interface SessionState {
  // Core session info
  activeSessionId: string | null
  sessions: SessionInfo[]  // Flattened, no dt/dtThreads structure

  // Messages
  messageIds: string[]
  messageCacheVersion: number

  // Generation state
  generatingSessionIds: Set<string>
  generatingMessagesCache: Map<string, { message: Message; sessionId: string }>

  // Variants
  selectedVariantsMap: Record<string, string>

  // Status
  sessionsWorkingStatus: Map<string, WorkingStatus>

  // Agent-specific state (NEW)
  sessionMetadata: Map<string, SessionMetadata>
}

export interface SessionMetadata {
  sessionId: string
  agentId: string
  status: 'idle' | 'generating' | 'paused' | 'error'
  workspace?: string
  currentModelId?: string
  currentModeId?: string
  availableModes?: AgentMode[]
  availableModels?: AgentModel[]
  availableCommands?: AgentCommand[]
  capabilities: {
    supportsVision: boolean
    supportsTools: boolean
    supportsModes: boolean
    supportsCommands?: boolean
  }
}
```

### 3.2 State Reorganization

**Before** (Current):
```typescript
const activeThreadId = ref<string | null>(null)
const threads = ref<{ dt: string; dtThreads: CONVERSATION[] }[]>([])
const generatingThreadIds = ref(new Set<string>())
const threadsWorkingStatus = ref<Map<string, WorkingStatus>>(new Map())
```

**After** (Target):
```typescript
const activeSessionId = ref<string | null>(null)
const sessions = ref<SessionInfo[]>([])  // Flat array
const generatingSessionIds = ref(new Set<string>())
const sessionsWorkingStatus = ref<Map<string, WorkingStatus>>(new Map())
const sessionMetadata = ref<Map<string, SessionMetadata>>(new Map())
```

### 3.3 Message Cache Key Update

**Before**:
```typescript
generatingMessagesCache: Map<string, { message: Message; threadId: string }>
```

**After**:
```typescript
generatingMessagesCache: Map<string, { message: Message; sessionId: string }>
```

---

## Part IV: Composable Reorganization

### 4.1 New Composable Structure

```
useAgenticSessionStore (NEW - replaces useChatStoreService)
├── Core State
│   ├── activeSessionId
│   ├── sessions (flat array)
│   ├── sessionMetadata (Map<sessionId, SessionMetadata>)
│   ├── messageIds
│   ├── generatingSessionIds
│   └── ...
│
├── Core Composables (unchanged functionality, renamed)
│   ├── useConversationCore → unchanged
│   ├── useAgenticAdapter (NEW - replaces useChatAdapter)
│   │   └── Bridges to AgenticPresenter
│   ├── useSessionConfig (replaces useChatConfig)
│   │   └── Uses SessionInfo from SessionMetadata
│   ├── useSessionManagement (renamed from useThreadManagement)
│   │   └── sessionId-based operations
│   ├── useMessageCache → unchanged
│   ├── useVariantManagement → unchanged
│   ├── useAgenticExecution (replaces useExecutionAdapter)
│   │   └── Uses AgenticPresenter
│   ├── useMessageStreaming → unchanged
│   ├── useAgenticEvents (replaces useChatEvents)
│   │   └── Listens to AgenticEventType
│   └── ...
│
└── Agent-Agnostic
    ├── No isAcpMode checks
    ├── No agent-type branching
    └── SessionInfo-driven behavior
```

### 4.2 New Composable: useAgenticSession

```typescript
// src/renderer/src/composables/chat/useAgenticSession.ts

import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { SessionInfo, AgentCommand, AgentMode, AgentModel } from '@shared/types/presenters/agentic.presenter.d'

export function useAgenticSession(sessionId: () => string) {
  const sessionInfo = ref<SessionInfo | null>(null)

  // Core session properties
  const agentId = computed(() => sessionInfo.value?.agentId)
  const status = computed(() => sessionInfo.value?.status ?? 'idle')

  // Modes
  const availableModes = computed<AgentMode[]>(
    () => sessionInfo.value?.availableModes ?? []
  )
  const currentModeId = computed(() => sessionInfo.value?.currentModeId)
  const supportsModes = computed(
    () => sessionInfo.value?.capabilities.supportsModes === true
  )
  const hasModes = computed(() => availableModes.value.length > 0)

  // Models
  const availableModels = computed<AgentModel[]>(
    () => sessionInfo.value?.availableModels ?? []
  )
  const currentModelId = computed(() => sessionInfo.value?.currentModelId)

  // Commands
  const availableCommands = computed<AgentCommand[]>(
    () => sessionInfo.value?.availableCommands ?? []
  )
  const supportsCommands = computed(
    () => sessionInfo.value?.capabilities.supportsCommands === true
  )
  const hasCommands = computed(() => availableCommands.value.length > 0)

  // Workspace
  const workspace = computed(() => sessionInfo.value?.workspace)
  const hasWorkspace = computed(() => !!workspace.value)

  // Capabilities
  const capabilities = computed(() => sessionInfo.value?.capabilities)

  // Event handler
  const handleSessionUpdated = (event: SessionUpdatedEvent) => {
    if (event.sessionId !== sessionId.value) return

    // Update session info
    sessionInfo.value = {
      ...sessionInfo.value,
      ...event.sessionInfo
    }
  }

  // Initial load
  const loadSessionInfo = async () => {
    const agenticPresenter = window.api.agenticPresenter
    sessionInfo.value = await agenticPresenter.getSession(sessionId.value)
  }

  onMounted(() => {
    loadSessionInfo()

    // Listen to session updates
    window.electron.ipcRenderer.on(
      'agentic.session.updated',
      handleSessionUpdated
    )
  })

  onUnmounted(() => {
    window.electron.ipcRenderer.off(
      'agentic.session.updated',
      handleSessionUpdated
    )
  })

  return {
    sessionInfo,
    agentId,
    status,
    availableModes,
    currentModeId,
    supportsModes,
    hasModes,
    availableModels,
    currentModelId,
    availableCommands,
    supportsCommands,
    hasCommands,
    workspace,
    hasWorkspace,
    capabilities,
    loadSessionInfo
  }
}
```

### 4.3 Renamed Composables

| Old Name | New Name | Changes |
|----------|----------|---------|
| `useChatStoreService` | `useAgenticSessionStore` | Complete rewrite |
| `useChatAdapter` | `useAgenticAdapter` | Uses AgenticPresenter |
| `useChatConfig` | `useSessionConfig` | SessionInfo-driven |
| `useThreadManagement` | `useSessionManagement` | sessionId-based |
| `useThreadExport` | `useSessionExport` | sessionId-based |
| `useChatEvents` | `useAgenticEvents` | AgenticEventType |
| `useExecutionAdapter` | `useAgenticExecution` | Uses AgenticPresenter |
| `useMessageStreaming` | (unchanged) | No changes needed |
| `useMessageCache` | (unchanged) | No changes needed |
| `useVariantManagement` | (unchanged) | No changes needed |

### 4.4 useAgenticAdapter Specification

```typescript
// src/renderer/src/composables/chat/useAgenticAdapter.ts

import { usePresenter } from '@/composables/usePresenter'

export function useAgenticAdapter() {
  const agenticPresenter = usePresenter('agenticPresenter')

  /**
   * Send a message to the active agent session
   */
  const sendMessage = async (
    sessionId: string,
    content: UserMessageContent | AssistantMessageBlock[],
    selectedVariants?: Record<string, string>
  ): Promise<AssistantMessage> => {
    return agenticPresenter.sendMessage(sessionId, content, selectedVariants)
  }

  /**
   * Continue the agent loop from a message
   */
  const continueLoop = async (
    sessionId: string,
    messageId: string,
    selectedVariants?: Record<string, string>
  ): Promise<AssistantMessage> => {
    return agenticPresenter.continueLoop(sessionId, messageId, selectedVariants)
  }

  /**
   * Cancel an ongoing generation
   */
  const cancelLoop = async (sessionId: string, messageId: string): Promise<void> => {
    return agenticPresenter.cancelLoop(sessionId, messageId)
  }

  /**
   * Retry a message
   */
  const retryMessage = async (
    sessionId: string,
    messageId: string,
    selectedVariants?: Record<string, string>
  ): Promise<AssistantMessage> => {
    return agenticPresenter.retryMessage(sessionId, messageId, selectedVariants)
  }

  /**
   * Regenerate from user message
   */
  const regenerateFromUserMessage = async (
    sessionId: string,
    userMessageId: string,
    selectedVariants?: Record<string, string>
  ): Promise<AssistantMessage> => {
    return agenticPresenter.regenerateFromUserMessage(
      sessionId,
      userMessageId,
      selectedVariants
    )
  }

  return {
    sendMessage,
    continueLoop,
    cancelLoop,
    retryMessage,
    regenerateFromUserMessage
  }
}
```

### 4.5 useAgenticEvents Specification

```typescript
// src/renderer/src/composables/chat/useAgenticEvents.ts

import { onMounted, onUnmounted } from 'vue'
import type { Ref } from 'vue'

export function useAgenticEventHandlers(
  activeSessionId: Ref<string | null>,
  sessions: Ref<SessionInfo[]>,
  selectedVariantsMap: Ref<Record<string, string>>,
  sessionsWorkingStatus: Ref<Map<string, WorkingStatus>>,
  // ... other deps
) {
  /**
   * Handle MESSAGE_DELTA event (streaming content)
   */
  const handleMessageDelta = (event: MessageDeltaEvent) => {
    const { sessionId, messageId, content, reasoning } = event

    if (sessionId !== activeSessionId.value) return

    // Update message in cache
    // ... existing logic from handleStreamResponse
  }

  /**
   * Handle MESSAGE_END event (streaming complete)
   */
  const handleMessageEnd = (event: MessageEndEvent) => {
    const { sessionId, messageId } = event

    // Remove from generating cache
    // ... existing logic from handleStreamEnd
  }

  /**
   * Handle ERROR event
   */
  const handleError = (event: ErrorEvent) => {
    const { sessionId, error } = event

    // Update session status
    sessionsWorkingStatus.value.set(sessionId, 'error')
  }

  /**
   * Handle SESSION_CREATED event
   */
  const handleSessionCreated = (event: SessionCreatedEvent) => {
    const { sessionId, sessionInfo } = event

    // Add to sessions array
    sessions.value.push(sessionInfo)
  }

  /**
   * Handle SESSION_UPDATED event
   */
  const handleSessionUpdated = (event: SessionUpdatedEvent) => {
    const { sessionId, sessionInfo } = event

    // Update session metadata
    const index = sessions.value.findIndex(s => s.sessionId === sessionId)
    if (index !== -1) {
      sessions.value[index] = { ...sessions.value[index], ...sessionInfo }
    }
  }

  /**
   * Handle SESSION_CLOSED event
   */
  const handleSessionClosed = (event: SessionClosedEvent) => {
    const { sessionId } = event

    // Remove from sessions array
    sessions.value = sessions.value.filter(s => s.sessionId !== sessionId)

    // Clear generating state
    sessionsWorkingStatus.value.delete(sessionId)
  }

  /**
   * Initialize all event listeners
   */
  const initializeEventListeners = () => {
    window.electron.ipcRenderer.on('agentic.message.delta', handleMessageDelta)
    window.electron.ipcRenderer.on('agentic.message.end', handleMessageEnd)
    window.electron.ipcRenderer.on('agentic.error', handleError)
    window.electron.ipcRenderer.on('agentic.session.created', handleSessionCreated)
    window.electron.ipcRenderer.on('agentic.session.updated', handleSessionUpdated)
    window.electron.ipcRenderer.on('agentic.session.closed', handleSessionClosed)
  }

  /**
   * Cleanup event listeners
   */
  const cleanupEventListeners = () => {
    window.electron.ipcRenderer.off('agentic.message.delta', handleMessageDelta)
    window.electron.ipcRenderer.off('agentic.message.end', handleMessageEnd)
    window.electron.ipcRenderer.off('agentic.error', handleError)
    window.electron.ipcRenderer.off('agentic.session.created', handleSessionCreated)
    window.electron.ipcRenderer.off('agentic.session.updated', handleSessionUpdated)
    window.electron.ipcRenderer.off('agentic.session.closed', handleSessionClosed)
  }

  onMounted(() => {
    initializeEventListeners()
  })

  onUnmounted(() => {
    cleanupEventListeners()
  })

  return {
    initializeEventListeners,
    cleanupEventListeners
  }
}
```

---

## Part V: Migration Strategy

### 5.1 Migration Phases

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Migration Phases                                │
└─────────────────────────────────────────────────────────────────────────┘

Phase 1: Preparation (No Breaking Changes)
  ├─ Create new composables alongside old ones
  ├─ Add useAgenticSession composable
  ├─ Add useAgenticAdapter composable
  └─ Add type definitions for SessionMetadata

Phase 2: Terminology Update (Breaking Changes)
  ├─ Rename state refs (threadId → sessionId)
  ├─ Rename composable functions
  ├─ Update all internal references
  └─ Run tests to validate changes

Phase 3: Event System Migration
  ├─ Add useAgenticEvents alongside useChatEvents
  ├─ Subscribe to both event systems temporarily
  ├─ Route events to appropriate handlers
  └─ Validate event flow

Phase 4: Composable Replacement
  ├─ Replace useChatAdapter with useAgenticAdapter
  ├─ Replace useChatEvents with useAgenticEvents
  ├─ Replace useChatConfig with useSessionConfig
  ├─ Rename useThreadManagement → useSessionManagement
  └─ Remove old composables

Phase 5: Store Replacement
  ├─ Create useAgenticSessionStore
  ├─ Migrate components one by one
  ├─ Validate each component migration
  └─ Remove useChatStoreService

Phase 6: Cleanup
  ├─ Remove old event subscriptions
  ├─ Remove unused imports
  ├─ Update type definitions
  └─ Final testing
```

### 5.2 Component Migration Order

**Order of Migration** (lowest dependency to highest):

1. **Independent Components** (no direct state usage)
   - Message rendering components
   - Input components

2. **Low-Dependency Components**
   - MessageList (uses messageIds)
   - ChatInput (uses sendMessage)

3. **Medium-Dependency Components**
   - ThreadList → SessionList
   - ChatConfig

4. **High-Dependency Components**
   - ChatView (main container)
   - App.vue

### 5.3 Backward Compatibility Strategy

**Decision D-032**: No backward compatibility layer

- Direct replacement (as per Decision 5 from `renderer-analysis-research.md`)
- Single atomic change if possible
- Comprehensive testing before merge

### 5.4 Testing Strategy

```typescript
// tests/unit/composables/chat/useAgenticSession.spec.ts
describe('useAgenticSession', () => {
  it('should load session info on mount', async () => {
    const { sessionInfo, loadSessionInfo } = useAgenticSession(() => 'test-session-id')
    await loadSessionInfo()
    expect(sessionInfo.value).not.toBeNull()
    expect(sessionInfo.value?.sessionId).toBe('test-session-id')
  })

  it('should update on SESSION_UPDATED event', async () => {
    const { sessionInfo } = useAgenticSession(() => 'test-session-id')

    // Simulate event
    window.electron.ipcRenderer.emit('agentic.session.updated', {
      sessionId: 'test-session-id',
      sessionInfo: { currentModelId: 'new-model' }
    })

    await nextTick()
    expect(sessionInfo.value?.currentModelId).toBe('new-model')
  })

  it('should expose computed properties for capabilities', () => {
    const { hasModes, hasCommands, hasWorkspace } = useAgenticSession(() => 'test-session-id')
    // Test computed properties
  })
})
```

---

## Part VI: Implementation Checklist

### Phase 1: Type Definitions

- [ ] Add `SessionMetadata` interface to shared types
- [ ] Add `SessionState` interface to renderer types
- [ ] Update `WorkingStatus` type (if needed)
- [ ] Export new types from `@shared/types/presenters/agentic.presenter.d.ts`

### Phase 2: New Composables

- [ ] Create `useAgenticSession` composable
  - [ ] SessionInfo loading
  - [ ] Event subscription (SESSION_UPDATED)
  - [ ] Computed properties for all session fields
  - [ ] Type guards for capabilities

- [ ] Create `useAgenticAdapter` composable
  - [ ] sendMessage
  - [ ] continueLoop
  - [ ] cancelLoop
  - [ ] retryMessage
  - [ ] regenerateFromUserMessage

- [ ] Create `useAgenticEventHandlers` composable
  - [ ] handleMessageDelta
  - [ ] handleMessageEnd
  - [ ] handleError
  - [ ] handleSessionCreated
  - [ ] handleSessionUpdated
  - [ ] handleSessionClosed

### Phase 3: Rename Existing

- [ ] Rename `useChatStoreService` → `useAgenticSessionStore`
- [ ] Rename `useChatAdapter` → `useAgenticAdapter`
- [ ] Rename `useChatConfig` → `useSessionConfig`
- [ ] Rename `useThreadManagement` → `useSessionManagement`
- [ ] Rename `useThreadExport` → `useSessionExport`
- [ ] Rename `useChatEvents` → `useAgenticEvents`
- [ ] Rename `useExecutionAdapter` → `useAgenticExecution`

### Phase 4: State Ref Updates

- [ ] `activeThreadId` → `activeSessionId`
- [ ] `threads` → `sessions`
- [ ] `generatingThreadIds` → `generatingSessionIds`
- [ ] `threadsWorkingStatus` → `sessionsWorkingStatus`
- [ ] `generatingMessagesCache` value type: `threadId` → `sessionId`
- [ ] Add `sessionMetadata` Map ref

### Phase 5: Function Updates

- [ ] `getActiveThreadId()` → `getActiveSessionId()`
- [ ] `setActiveThreadId()` → `setActiveSessionId()`
- [ ] `loadThreadMessages()` → `loadSessionMessages()`
- [ ] `createNewEmptyThread()` → `createNewEmptySession()`
- [ ] `setActiveThread()` → `setActiveSession()`
- [ ] `clearActiveThread()` → `clearActiveSession()`
- [ ] `renameThread()` → `renameSession()`
- [ ] `forkThread()` → `forkSession()`

### Phase 6: Event Migration

- [ ] Replace `STREAM_EVENTS.RESPONSE` with `AgenticEventType.MESSAGE_DELTA`
- [ ] Replace `STREAM_EVENTS.END` with `AgenticEventType.MESSAGE_END`
- [ ] Replace `STREAM_EVENTS.ERROR` with `AgenticEventType.ERROR`
- [ ] Remove `ACP_WORKSPACE_EVENTS` subscriptions

### Phase 7: Component Updates

- [ ] Update ChatInput.vue
  - [ ] Import from `useAgenticSessionStore`
  - [ ] Update all `threadId` references to `sessionId`
  - [ ] Update event handlers

- [ ] Update MessageList.vue
  - [ ] Update `threadId` references to `sessionId`
  - [ ] Update message loading calls

- [ ] Update ThreadList.vue → SessionList.vue
  - [ ] Rename component
  - [ ] Update all `threadId` references to `sessionId`
  - [ ] Update navigation calls

- [ ] Update ChatConfig.vue
  - [ ] Use `useAgenticSession` for SessionInfo
  - [ ] Update configuration calls

- [ ] Update ChatView.vue
  - [ ] Import from `useAgenticSessionStore`
  - [ ] Update all state access

### Phase 8: Remove Dead Code

- [ ] Remove `isAcpMode` computed (always returns `false`)
- [ ] Remove `activeAcpAgentId` computed (always `null`)
- [ ] Remove `activeAgentMcpSelections` state
- [ ] Remove old ACP event subscriptions
- [ ] Remove old composables (after validation)

### Phase 9: Testing

- [ ] Unit tests for `useAgenticSession`
- [ ] Unit tests for `useAgenticAdapter`
- [ ] Unit tests for `useAgenticEventHandlers`
- [ ] Integration tests for event flow
- [ ] E2E tests for user scenarios
- [ ] Manual testing checklist

---

## Part VII: Architectural Decisions

| ID | Date | Decision | Rationale | Status |
|----|------|----------|-----------|--------|
| D-031 | 2026-01-25 | Direct find-and-replace for terminology migration | Consistent with Decision 1 (no backward compatibility) | ✅ Confirmed |
| D-032 | 2026-01-25 | No backward compatibility layer during state refactoring | Cleaner code, single atomic change | ✅ Confirmed |
| D-033 | 2026-01-25 | Use flat sessions array instead of dt/dtThreads structure | Simpler data structure, easier to manage | ✅ Confirmed |
| D-034 | 2026-01-25 | Add sessionMetadata Map to store SessionInfo per session | Efficient lookup, supports multiple sessions | ✅ Confirmed |
| D-035 | 2026-01-25 | Create new composables alongside old ones then replace | Reduces risk, allows gradual migration | ✅ Confirmed |
| D-036 | 2026-01-25 | Component migration order: low to high dependency | Minimizes cascading changes | ✅ Confirmed |
| D-037 | 2026-01-25 | Remove isAcpMode and activeAcpAgentId (always false/null) | ACP mode removed from codebase | ✅ Confirmed |
| D-038 | 2026-01-25 | Keep useMessageStreaming and useMessageCache unchanged | Already agent-agnostic, no changes needed | ✅ Confirmed |

---

## Part VIII: Risk Mitigation

### 8.1 Identified Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Cascading refactoring errors** | High | Comprehensive test coverage, component-by-component migration |
| **Event system breakage** | High | Dual subscription period, thorough event testing |
| **State inconsistency** | Medium | Validate state updates at each phase |
| **Performance regression** | Low | Benchmark before/after, optimize if needed |
| **Lost functionality** | Medium | Feature checklist validation |

### 8.2 Rollback Plan

If migration fails at any phase:
1. Revert all changes in current phase
2. Validate previous phase still works
3. Fix issues in isolation
4. Retry migration

### 8.3 Validation Checklist

After each phase:
- [ ] All tests pass
- [ ] Manual smoke test complete
- [ ] No console errors
- [ ] Event flow validated
- [ ] State updates verified

---

## Part IX: Related Documents

- `unified-components-specification.md` - Component specifications using new state
- `event-payload-specification.md` - Unified event system specification
- `acp-modes-models-specification.md` - Modes/models data model
- `workspace-implementation-plan.md` - Workspace handling in sessions
- `renderer-analysis-research.md` - Main research document (Research Item 5)

### Code References

- `src/renderer/src/composables/chat/useChatStoreService.ts` - Current store (727 lines)
- `src/renderer/src/composables/chat/useExecutionAdapter.ts` - Current execution adapter
- `src/renderer/src/composables/chat/useMessageStreaming.ts` - Stream processing
- `src/renderer/src/composables/chat/useChatEvents.ts` - Current event handlers
- `src/renderer/src/composables/chat/useChatAdapter.ts` - Current IPC bridge
