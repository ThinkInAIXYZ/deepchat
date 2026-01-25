# Plan: Agentic Presenter Renderer Integration

## Overview

This plan details the implementation strategy for integrating the unified `AgenticPresenter` layer into the renderer process. It defines the phased approach, technical specifications, and integration points for each component of the renderer.

## Implementation Strategy

### Phased Migration Approach

The integration will be executed in **6 phases** to minimize risk and ensure each step can be validated independently:

```
Phase 1: Foundation           New composables alongside old ones
         │
         ▼
Phase 2: Terminology         Global find-replace threadId → sessionId
         │
         ▼
Phase 3: Event System        Migrate to AgenticEventType listeners
         │
         ▼
Phase 4: Components          Implement and integrate new components
         │
         ▼
Phase 5: Composables         Replace old composables with new ones
         │
         ▼
Phase 6: Store & Cleanup     Replace store, remove old code
```

### Risk Mitigation Strategy

| Phase | Risk | Mitigation |
|-------|------|------------|
| Phase 1 | New code doesn't match patterns | Reference existing composable patterns |
| Phase 2 | Find-replace breaks references | Run typecheck after each batch |
| Phase 3 | Event handling gaps | Event mapping validation script |
| Phase 4 | Component behavior changes | Manual testing per component |
| Phase 5 | Composable interface mismatches | Incremental replacement |
| Phase 6 | State corruption | Backup state before store replacement |

## Phase 1: Foundation

### Goal

Create new composables alongside existing ones, with no breaking changes.

### Tasks

#### 1.1 Create `useAgenticSession` Composable

**Location**: `src/renderer/src/composables/agentic/useAgenticSession.ts`

```typescript
import { computed, ref, type Ref } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { SessionInfo } from '@shared/types/agentic'

export function useAgenticSession(sessionId: () => string | null) {
  const agenticP = usePresenter().agenticPresenter

  const sessionInfo = ref<SessionInfo | null>(null)

  // Computed properties from SessionInfo
  const agentId = computed(() => sessionInfo.value?.agentId)
  const status = computed(() => sessionInfo.value?.status)
  const availableModes = computed(() => sessionInfo.value?.availableModes)
  const currentModeId = computed(() => sessionInfo.value?.currentModeId)
  const availableModels = computed(() => sessionInfo.value?.availableModels)
  const currentModelId = computed(() => sessionInfo.value?.currentModelId)
  const availableCommands = computed(() => sessionInfo.value?.availableCommands)
  const workspace = computed(() => sessionInfo.value?.workspace)

  const capabilities = computed(() => sessionInfo.value?.capabilities ?? {
    supportsVision: false,
    supportsTools: false,
    supportsModes: false
  })

  // Convenience computed
  const hasWorkspace = computed(() => !!workspace.value)
  const supportsModes = computed(() => capabilities.value.supportsModes)
  const supportsCommands = computed(() => capabilities.value.supportsCommands ?? false)
  const isGenerating = computed(() => status.value === 'generating')
  const hasError = computed(() => status.value === 'error')

  // Load session info
  async function loadSessionInfo() {
    const id = sessionId()
    if (!id) return
    sessionInfo.value = agenticP.getSession(id)
  }

  // Watch for session changes and reload
  watch(sessionId, loadSessionInfo, { immediate: true })

  return {
    sessionInfo,
    agentId,
    status,
    availableModes,
    currentModeId,
    availableModels,
    currentModelId,
    availableCommands,
    workspace,
    capabilities,
    hasWorkspace,
    supportsModes,
    supportsCommands,
    isGenerating,
    hasError,
    loadSessionInfo
  }
}
```

**Integration Points**:
- Uses `AgenticPresenter` from preload bridge
- Returns reactive computed values from `SessionInfo`
- Auto-loads session info when `sessionId` changes

#### 1.2 Create `useAgenticEvents` Composable

**Location**: `src/renderer/src/composables/agentic/useAgenticEvents.ts`

```typescript
import { onUnmounted } from 'vue'
import { eventBus } from '@/eventBus'
import { AgenticEventType } from '@shared/constants/events'
import type {
  SessionCreatedEvent,
  SessionReadyEvent,
  SessionUpdatedEvent,
  SessionClosedEvent,
  MessageDeltaEvent,
  MessageBlockEvent,
  MessageEndEvent,
  ToolStartEvent,
  ToolRunningEvent,
  ToolEndEvent,
  StatusChangedEvent,
  ErrorEvent
} from '@shared/types/agenticEvents'

export function useAgenticEvents(handlers: {
  onSessionCreated?: (event: SessionCreatedEvent) => void
  onSessionReady?: (event: SessionReadyEvent) => void
  onSessionUpdated?: (event: SessionUpdatedEvent) => void
  onSessionClosed?: (event: SessionClosedEvent) => void
  onMessageDelta?: (event: MessageDeltaEvent) => void
  onMessageBlock?: (event: MessageBlockEvent) => void
  onMessageEnd?: (event: MessageEndEvent) => void
  onToolStart?: (event: ToolStartEvent) => void
  onToolRunning?: (event: ToolRunningEvent) => void
  onToolEnd?: (event: ToolEndEvent) => void
  onStatusChanged?: (event: StatusChangedEvent) => void
  onError?: (event: ErrorEvent) => void
}) {
  const unsubscribers: Array<() => void> = []

  // Subscribe to provided events
  if (handlers.onSessionCreated) {
    unsubscribers.push(
      eventBus.on(AgenticEventType.SESSION_CREATED, handlers.onSessionCreated)
    )
  }
  // ... similar pattern for other event types

  // Cleanup on unmount
  onUnmounted(() => {
    unsubscribers.forEach(unsub => unsub())
  })

  return {
    // Optional: expose manual unsubscribe
    unsubscribe: () => unsubscribers.forEach(unsub => unsub())
  }
}
```

**Integration Points**:
- Subscribes to `AgenticEventType` events only
- Auto-cleanup on component unmount
- Type-safe event handlers

#### 1.3 Create `useAgenticAdapter` Composable

**Location**: `src/renderer/src/composables/agentic/useAgenticAdapter.ts`

**Purpose**: Provides full message execution interface via `AgenticPresenter`

**Interface Specification**:
```typescript
interface AgenticAdapter {
  // Agent Discovery
  agents: Computed<AgentInfo[]>
  deepchatAgents: Computed<AgentInfo[]>
  acpAgents: Computed<AgentInfo[]>
  getAgent(agentId: string): AgentInfo | undefined

  // Message Execution
  sendMessage(sessionId: string, content: MessageContent, selectedVariants?: Record<string, string>): Promise<AssistantMessage>
  continueLoop(sessionId: string, messageId: string, selectedVariants?: Record<string, string>): Promise<AssistantMessage>
  cancelLoop(sessionId: string, messageId: string): Promise<void>
  retryMessage(sessionId: string, messageId: string, selectedVariants?: Record<string, string>): Promise<AssistantMessage>
  regenerateFromUserMessage(sessionId: string, userMessageId: string, selectedVariants?: Record<string, string>): Promise<AssistantMessage>
}
```

**Integration Points**:
- Replaces `useChatAdapter` and `useExecutionAdapter`
- Provides agent listing, filtering, and full message execution interface
- All methods delegate to `AgenticPresenter`

### Acceptance Criteria

- [ ] New composables created at specified locations
- [ ] Existing composables unchanged
- [ ] TypeScript compiles without errors
- [ ] No runtime errors in existing functionality

## Phase 2: Terminology Migration

### Goal

Replace all instances of `threadId` and `conversationId` with `sessionId` in renderer code.

### Scope

Based on `renderer-analysis-research.md`, approximately **350 files** contain these references:

| Pattern | Approx. Files | Notes |
|---------|--------------|-------|
| `threadId` | ~200 | Variable names, function parameters, type definitions |
| `conversationId` | ~150 | Database queries, type mappings |

### Migration Batches

Execute find-replace in **ordered batches** to minimize conflicts:

#### Batch 1: Type Definitions

**Files**: `src/shared/types/`, `src/renderer/src/types/`

```bash
# Type aliases
threadId → sessionId
conversationId → sessionId  # in renderer types only
```

**Example**:
```typescript
// Before
interface ThreadSummary {
  threadId: string
  title: string
}

// After
interface SessionSummary {
  sessionId: string
  title: string
}
```

#### Batch 2: State Variables

**Files**: `src/renderer/src/composables/chat/useChatStoreService.ts`

```typescript
// Before
const activeThreadId = ref<string | null>(null)
const threads = ref<{ dt: string; dtThreads: CONVERSATION[] }[]>([])
const generatingThreadIds = ref(new Set<string>())
const threadsWorkingStatus = ref<Map<string, WorkingStatus>>(new Map())

// After
const activeSessionId = ref<string | null>(null)
const sessions = ref<SessionInfo[]>([])  // Phase 6: flat array
const generatingSessionIds = ref(new Set<string>())
const sessionsWorkingStatus = ref<Map<string, WorkingStatus>>(new Map())
```

#### Batch 3: Composable Names and Parameters

**Files**: `src/renderer/src/composables/`

```bash
# Composable functions
useThreadManagement → useSessionManagement
useChatAdapter → useAgenticAdapter
useChatEvents → useAgenticEvents
useExecutionAdapter → useAgenticExecution
```

#### Batch 4: Component Props and Emits

**Files**: `src/renderer/src/components/`

```vue
<!-- Before -->
<ThreadList
  :activeThreadId="activeThreadId"
  @thread-select="handleThreadSelect"
/>

<!-- After -->
<SessionList
  :activeSessionId="activeSessionId"
  @session-select="handleSessionSelect"
/>
```

#### Batch 5: Event Payloads

**Files**: `src/shared/constants/events.ts`

```typescript
// Only if event payloads use threadId/conversationId
// Update payload interfaces to use sessionId
```

#### Batch 6: Remaining References

**Files**: All other renderer files

```bash
# Global find-replace for remaining occurrences
```

### Validation

After each batch:

1. Run `pnpm run typecheck` - fix type errors
2. Run `pnpm run lint` - fix linting issues
3. Manual smoke test - verify no runtime errors

### Acceptance Criteria

- [ ] Zero `threadId` references in renderer code
- [ ] Zero `conversationId` references in renderer code (except comments)
- [ ] All TypeScript compiles
- [ ] All linting passes
- [ ] App runs without errors

## Phase 3: Event System Migration

### Goal

Replace all event listeners with `AgenticEventType` listeners.

### Event Mapping

Based on `event-payload-specification.md`:

| Old Event | New Event | Mapping Notes |
|-----------|-----------|---------------|
| `STREAM_EVENTS.RESPONSE` | `AgenticEventType.MESSAGE_DELTA` | Content in delta |
| `STREAM_EVENTS.END` | `AgenticEventType.MESSAGE_END` | Message complete |
| `STREAM_EVENTS.ERROR` | `AgenticEventType.ERROR` | Error payload |
| `ACP_WORKSPACE_EVENTS.SESSION_MODES_READY` | `AgenticEventType.SESSION_UPDATED` | Modes in SessionInfo |
| `ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY` | `AgenticEventType.SESSION_UPDATED` | Models in SessionInfo |
| `ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE` | `AgenticEventType.SESSION_UPDATED` | Commands in SessionInfo |

### Migration Steps

#### 3.1 Identify Event Listeners

Search for all event listeners in renderer:

```bash
# Find all eventBus.on() calls
grep -r "eventBus.on\|on(" src/renderer/src/composables/ --include="*.ts"
```

#### 3.2 Replace with AgenticEventType

**Before**:
```typescript
// useChatEvents.ts
eventBus.on(STREAM_EVENTS.RESPONSE, handleResponse)
eventBus.on(STREAM_EVENTS.END, handleEnd)
eventBus.on(ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE, handleCommandsUpdate)
```

**After**:
```typescript
// useAgenticEvents.ts
eventBus.on(AgenticEventType.MESSAGE_DELTA, handleDelta)
eventBus.on(AgenticEventType.MESSAGE_END, handleEnd)
eventBus.on(AgenticEventType.SESSION_UPDATED, handleSessionUpdated)
```

#### 3.3 Update Event Handlers

**Before**:
```typescript
function handleCommandsUpdate(event: { sessionId: string; commands: Command[] }) {
  // Update commands state
}
```

**After**:
```typescript
function handleSessionUpdated(event: SessionUpdatedEvent) {
  if (event.availableCommands) {
    // Update commands state
  }
  if (event.availableModes) {
    // Update modes state
  }
  if (event.availableModels) {
    // Update models state
  }
}
```

### Acceptance Criteria

- [ ] No listeners for `STREAM_EVENTS` in renderer
- [ ] No listeners for `ACP_WORKSPACE_EVENTS` in renderer
- [ ] All events use `AgenticEventType`
- [ ] Event handlers updated for new payloads
- [ ] All event flows tested manually

## Phase 4: Components

### Goal

Implement and integrate new unified components.

### Component Specifications

Based on `unified-components-specification.md`:

#### 4.1 AgentHeader Component

**Location**: `src/renderer/src/components/chat-input/AgentHeader.vue`

**Props**:
```typescript
interface Props {
  sessionId: string
  compact?: boolean           // Default: false
  showStatus?: boolean        // Default: true
  showCapabilities?: boolean  // Default: true
  showWorkspace?: boolean     // Default: true
}
```

**Emits**:
```typescript
interface Emits {
  (e: 'config-click'): void
  (e: 'workspace-click'): void
  (e: 'retry-click'): void
}
```

**Visual Design**:
```
┌──────────────────────────────────────────────────────────┐
│  [Agent Icon]  Agent Name              [Status: ●]      │
│  workspace: ~/project                               [⚙]  │
└──────────────────────────────────────────────────────────┘

Compact mode:
┌────────────────────────────────────────────┐
│  [Agent] ●                        [⚙]     │
└────────────────────────────────────────────┘
```

**Integration**:
```vue
<template>
  <AgentHeader
    :session-id="activeSessionId"
    :show-status="true"
    @config-click="openConfig"
    @workspace-click="openWorkspaceSelector"
  />
</template>
```

#### 4.2 UnifiedModelSelector Component

**Location**: `src/renderer/src/components/chat/UnifiedModelSelector.vue`

**Props**:
```typescript
interface Props {
  sessionId: string
  disabled?: boolean
  showProvider?: boolean  // Show provider prefix for DeepChat
}
```

**Emits**:
```typescript
interface Emits {
  (e: 'model-select', modelId: string): void
}
```

**Behavior**:
- Shows dropdown of `availableModels` from session
- For DeepChat: shows `providerId:modelId` format
- For ACP: shows plain `modelId`
- Emits `model-select` with selected model ID

#### 4.3 UnifiedModeSelector Component

**Location**: `src/renderer/src/components/chat/UnifiedModeSelector.vue`

**Props**:
```typescript
interface Props {
  sessionId: string
  showDescription?: boolean  // Show mode description in tooltip
}
```

**Emits**:
```typescript
interface Emits {
  (e: 'mode-select', modeId: string): void
}
```

**Behavior**:
- Only visible when `capabilities.supportsModes === true`
- Shows dropdown of `availableModes`
- Description shown in tooltip (D-030)

#### 4.4 WorkspaceSelector Component

**Location**: `src/renderer/src/components/chat/WorkspaceSelector.vue`

**Props**:
```typescript
interface Props {
  sessionId: string
  editable?: boolean   // Can workspace be changed
  compact?: boolean
}
```

**Emits**:
```typescript
interface Emits {
  (e: 'workspace-change', workspace: string): void
}
```

**Behavior**:
- **DeepChat**: Editable, workspace can be changed anytime
- **ACP**: Not editable, shows error on change attempt (D-028)
- Path truncated with `~` substitution (D-029)

#### 4.5 CommandsDisplay Component

**Location**: `src/renderer/src/components/chat/CommandsDisplay.vue`

**Props**:
```typescript
interface Props {
  sessionId: string
}
```

**Emits**:
```typescript
interface Emits {
  (e: 'command-insert', template: string): void
}
```

**Behavior**:
- Only visible when `availableCommands.length > 0`
- Collapsible list (max 5 visible)
- Click to insert invocation template into chat input

### Component Integration

Replace old components in `ChatInput.vue`:

```vue
<!-- Before -->
<AcpModeSelector v-if="isAcpMode" :session-id="sessionId" />
<ModelSelector v-else :model-id="modelId" />

<!-- After -->
<AgentHeader :session-id="activeSessionId" />
<UnifiedModelSelector :session-id="activeSessionId" />
<UnifiedModeSelector :session-id="activeSessionId" />
<WorkspaceSelector :session-id="activeSessionId" />
<CommandsDisplay :session-id="activeSessionId" />
```

### Acceptance Criteria

- [ ] All 5 components implemented
- [ ] Components work for DeepChat agents
- [ ] Components work for ACP agents
- [ ] Old components removed
- [ ] No agent-type branching in component usage
- [ ] Visual design matches specifications

## Phase 5: Composables

### Goal

Replace old composables with new unified composables.

### Composable Mapping

| Old Composable | New Composable | Changes |
|----------------|----------------|---------|
| `useChatStoreService` | `useAgenticSessionStore` | Complete rewrite |
| `useChatAdapter` | `useAgenticAdapter` | Full message execution interface |
| `useChatConfig` | `useSessionConfig` | SessionInfo-driven configuration |
| `useThreadManagement` | `useSessionManagement` | sessionId-based |
| `useThreadExport` | `useSessionExport` | sessionId-based export |
| `useChatEvents` | `useAgenticEvents` | AgenticEventType |
| `useExecutionAdapter` | `useAgenticExecution` | Uses AgenticPresenter |
| `useMessageStreaming` | *(unchanged)* | Already agent-agnostic |
| `useMessageCache` | *(unchanged)* | Already agent-agnostic |
| `useVariantManagement` | *(unchanged)* | Already agent-agnostic |

### Replacement Strategy

Replace composables incrementally:

1. Add new composable alongside old one
2. Update one consumer to use new composable
3. Test
4. Repeat for all consumers
5. Remove old composable

### Example: `useSessionManagement`

**Location**: `src/renderer/src/composables/agentic/useSessionManagement.ts`

```typescript
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { SessionConfig, LoadContext } from '@shared/types/agentic'

export function useSessionManagement() {
  const agenticP = usePresenter().agenticPresenter

  const activeSessionId = ref<string | null>(null)

  async function createSession(agentId: string, config: SessionConfig) {
    const sessionId = await agenticP.createSession(agentId, config)
    return sessionId
  }

  async function loadSession(sessionId: string, context: LoadContext) {
    await agenticP.loadSession(sessionId, context)
    activeSessionId.value = sessionId
  }

  async function closeSession(sessionId: string) {
    await agenticP.closeSession(sessionId)
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null
    }
  }

  function setActiveSession(sessionId: string) {
    activeSessionId.value = sessionId
  }

  return {
    activeSessionId,
    createSession,
    loadSession,
    closeSession,
    setActiveSession
  }
}
```

### Acceptance Criteria

- [ ] All old composables replaced
- [ ] All consumers updated
- [ ] No agent-type branching in composables
- [ ] TypeScript compiles
- [ ] All functionality preserved

## Phase 6: Store & Cleanup

### Goal

Replace the store with unified structure and remove all old code.

### New Store Structure

**Location**: `src/renderer/src/composables/agentic/useAgenticSessionStore.ts`

```typescript
import { ref, computed } from 'vue'
import type { SessionInfo } from '@shared/types/agentic'

export function useAgenticSessionStore() {
  // Active session
  const activeSessionId = ref<string | null>(null)

  // All sessions (flat array)
  const sessions = ref<SessionInfo[]>([])

  // Session metadata Map for efficient lookup
  const sessionMetadata = ref<Map<string, SessionInfo>>(new Map())

  // Generating sessions
  const generatingSessionIds = ref(new Set<string>())

  // Working status
  const sessionsWorkingStatus = ref<Map<string, WorkingStatus>>(new Map())

  // Computed
  const activeSession = computed(() => {
    if (!activeSessionId.value) return null
    return sessions.value.find(s => s.sessionId === activeSessionId.value)
  })

  const isGenerating = computed(() =>
    activeSessionId.value ? generatingSessionIds.value.has(activeSessionId.value) : false
  )

  // Actions
  function addSession(session: SessionInfo) {
    sessions.value.push(session)
    sessionMetadata.value.set(session.sessionId, session)
  }

  function updateSession(sessionId: string, updates: Partial<SessionInfo>) {
    const index = sessions.value.findIndex(s => s.sessionId === sessionId)
    if (index !== -1) {
      sessions.value[index] = { ...sessions.value[index], ...updates }
      const current = sessionMetadata.value.get(sessionId)
      if (current) {
        sessionMetadata.value.set(sessionId, { ...current, ...updates })
      }
    }
  }

  function removeSession(sessionId: string) {
    sessions.value = sessions.value.filter(s => s.sessionId !== sessionId)
    sessionMetadata.value.delete(sessionId)
  }

  function setGenerating(sessionId: string, generating: boolean) {
    if (generating) {
      generatingSessionIds.value.add(sessionId)
    } else {
      generatingSessionIds.value.delete(sessionId)
    }
  }

  return {
    // State
    activeSessionId,
    sessions,
    sessionMetadata,
    generatingSessionIds,
    sessionsWorkingStatus,

    // Computed
    activeSession,
    isGenerating,

    // Actions
    addSession,
    updateSession,
    removeSession,
    setGenerating
  }
}
```

### Cleanup Tasks

1. Remove `useChatStoreService.ts`
2. Remove old component files:
   - `AcpModeSelector.vue`
   - `AcpSessionModelSelector.vue`
   - `ModelSelector.vue` (old version)
3. Remove old composables:
   - `useThreadManagement.ts`
   - `useThreadExport.ts`
   - `useChatAdapter.ts`
   - `useChatConfig.ts`
   - `useChatEvents.ts`
   - `useExecutionAdapter.ts`
4. Remove unused event constants (if safe):
   - `STREAM_EVENTS` from renderer
   - `ACP_WORKSPACE_EVENTS` from renderer

### Acceptance Criteria

- [ ] Old store removed
- [ ] Old components removed
- [ ] Old composables removed
- [ ] No unused code remaining
- [ ] TypeScript compiles
- [ ] App runs without errors

## Testing Strategy

### Unit Tests

**Target**: New composables

```typescript
// useAgenticSession.spec.ts
describe('useAgenticSession', () => {
  it('should expose session info', () => {
    // Test session info exposure
  })

  it('should update when sessionId changes', () => {
    // Test reactivity
  })

  it('should handle null sessionId', () => {
    // Test edge case
  })
})
```

### Integration Tests

**Target**: Component behavior with different agent types

```typescript
// UnifiedModelSelector.spec.ts
describe('UnifiedModelSelector', () => {
  it('should show DeepChat models with provider prefix', () => {
    // Test DeepChat agent
  })

  it('should show ACP models without prefix', () => {
    // Test ACP agent
  })

  it('should emit model-select event', () => {
    // Test interaction
  })
})
```

### E2E Tests

**Target**: Critical user flows

1. Create session with DeepChat agent
2. Create session with ACP agent
3. Switch between sessions
4. Change model
5. Change mode
6. Change workspace (DeepChat only)
7. Send message and receive response
8. Close session

### Manual Testing Checklist

| Scenario | Steps | Expected Result |
|----------|-------|-----------------|
| DeepChat session creation | Select agent, create session | Session created, model selector shows models |
| ACP session creation | Select ACP agent, select workspace, create | Session created, workspace required |
| Model selection (DeepChat) | Select model from dropdown | Model updated in session |
| Model selection (ACP) | Select model from dropdown | Model updated in session |
| Mode selection | Select mode from dropdown | Mode updated in session |
| Workspace change (DeepChat) | Change workspace in session | Workspace updated |
| Workspace change (ACP) | Attempt to change workspace | Error shown, workspace unchanged |
| Commands display | ACP session with commands | Commands shown, click inserts template |
| Agent status | Send message | Status changes to generating, then idle |
| Session switching | Switch between multiple sessions | Active session updated, messages loaded |

## Rollback Plan

If critical issues arise:

1. **Revert commit** to pre-integration state
2. **Document issues** in integration spec
3. **Fix issues** in integration branch
4. **Re-test** with manual checklist
5. **Re-apply** integration

## Related Documents

- Spec: `docs/specs/agentic-renderer-integration/spec.md`
- Tasks: `docs/specs/agentic-renderer-integration/tasks.md`
- Component Specs: `docs/architecture/unified-components-specification.md`
- State Refactoring: `docs/architecture/state-management-refactoring-spec.md`
- Session Lifecycle: `docs/architecture/session-lifecycle-specification.md`
- Event Payloads: `docs/architecture/event-payload-specification.md`
