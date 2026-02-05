# Renderer-Presenter Integration Design Report

## Executive Summary

This report provides a comprehensive design for integrating the **Agentic Unified Layer** into the renderer layer. It addresses the architectural gaps identified in the investigation report and provides a phased approach to migrating from the current dual-presenter pattern to the unified `AgenticPresenter` interface.

**Date**: 2026-01-25
**Status**: Design Phase
**Dependencies**: Agentic Unified Layer (Presenter) - Complete

---

## Table of Contents

1. [Design Goals](#1-design-goals)
2. [Current State Analysis](#2-current-state-analysis)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Terminology Migration Strategy](#4-terminology-migration-strategy)
5. [Event System Unification](#5-event-system-unification)
6. [Configuration Consolidation](#6-configuration-consolidation)
7. [Component Refactoring](#7-component-refactoring)
8. [Phase 1: Foundation](#8-phase-1-foundation)
9. [Phase 2: Composable Creation](#9-phase-2-composable-creation)
10. [Phase 3: Event Migration](#10-phase-3-event-migration)
11. [Phase 4: State Migration](#11-phase-4-state-migration)
12. [Phase 5: Component Migration](#12-phase-5-component-migration)
13. [Testing Strategy](#13-testing-strategy)
14. [Rollout Plan](#14-rollout-plan)

---

## 1. Design Goals

### 1.1 Primary Goals

| Goal | Description | Success Metric |
|------|-------------|----------------|
| **Unified Interface** | Single presenter for all agent types | Zero agent-type branching |
| **Terminology Consistency** | Use `sessionId` everywhere | No `conversationId` references |
| **Event Unification** | Single event format | Only `AgenticEventType` events |
| **Configuration Consolidation** | Single config structure | No ACP-specific fields |
| **Backward Compatibility** | No breaking changes | Gradual migration path |

### 1.2 Non-Goals

| Non-Goal | Rationale |
|----------|-----------|
| **Model Configuration** | Handled by each agent |
| **Permission Policy Implementation** | Agent-specific logic |
| **Session Storage Strategy** | Remains agent-specific |
| **ACP Workspace Refactoring** | Separate concern |

---

## 2. Current State Analysis

### 2.1 Presenter Usage

**Current Pattern** (Dual Presenter):
```typescript
// For ALL message sending
const agentP = usePresenter('agentPresenter')
await agentP.sendMessage(threadId, content, tabId, variants)

// For ACP-specific operations
const acpP = usePresenter('acpPresenter') as IAcpPresenter
await acpP.setSessionMode(sessionId, modeId)
```

**Target Pattern** (Unified):
```typescript
// For ALL operations
const agenticP = useAgenticPresenter()
await agenticP.sendMessage(sessionId, content)
await agenticP.setMode(sessionId, modeId)
```

### 2.2 Event Handling

**Current Pattern** (Dual Event Types):
```typescript
// STREAM_EVENTS (shared)
window.api.on(STREAM_EVENTS.RESPONSE, handleStreamResponse)

// ACP_WORKSPACE_EVENTS (ACP-specific)
window.api.on(ACP_WORKSPACE_EVENTS.SESSION_MODES_READY, handleModes)
```

**Target Pattern** (Unified):
```typescript
// AgenticEventType only
window.api.on(AgenticEventType.MESSAGE_DELTA, handleMessageDelta)
window.api.on(AgenticEventType.SESSION_UPDATED, handleSessionUpdated)
```

### 2.3 Terminology Gap

| Current | Target | Files Affected |
|---------|--------|----------------|
| `threadId` | `sessionId` | ~150 files |
| `conversationId` | `sessionId` | ~200 files |
| `agentId` (model) | `agentId` | ~50 files |
| `isAcpMode` | `agent.capabilities` | ~20 files |

---

## 3. Proposed Architecture

### 3.1 Layer Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Renderer Process                             │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │              useAgenticPresenter() Composable                 │  │
│   │                                                               │  │
│   │  + createSession(agentId, config)                            │  │
│   │  + sendMessage(sessionId, content)                           │  │
│   │  + cancelMessage(sessionId, messageId)                       │  │
│   │  + setModel(sessionId, modelId)                              │  │
│   │  + setMode(sessionId, modeId)                                │  │
│   │  + getSession(sessionId)                                     │  │
│   │  + loadSession(sessionId, context)                           │  │
│   │  + closeSession(sessionId)                                   │  │
│   └───────────────────────────────┬───────────────────────────────┘  │
│                                 │                                   │
│   ┌──────────────────────────────▼───────────────────────────────┐  │
│   │           Agentic Event Handler (Unified)                     │  │
│   │                                                               │  │
│   │  - Listens to AgenticEventType.* events                      │  │
│   │  - Routes to appropriate handlers                            │  │
│   │  - Updates chat state                                        │  │
│   └───────────────────────────────┬───────────────────────────────┘  │
│                                 │                                   │
│   ┌──────────────────────────────▼───────────────────────────────┐  │
│   │                   Chat State (Unified)                        │  │
│   │                                                               │  │
│   │  - activeSessionId (was activeThreadId)                      │  │
│   │  - sessions (Map<sessionId, SessionState>)                   │  │
│   │  - messageCache (Map<messageId, Message>)                     │  │
│   └───────────────────────────────────────────────────────────────┘  │
│                                 │                                   │
│   ┌──────────────────────────────▼───────────────────────────────┐  │
│   │              UI Components (Agent-Agnostic)                   │  │
│   │                                                               │  │
│   │  - ChatInput, MessageList, ModelSelector                     │  │
│   │  - No agent-type branching                                   │  │
│   └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ IPC (usePresenter)
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Main Process                                    │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │              AgenticPresenter (Complete)                      │  │
│   │                                                               │  │
│   │  - Routes to AgentPresenter/AcpPresenter                     │  │
│   │  - Emits AgenticEventType events                              │  │
│   └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow Comparison

**Current Flow**:
```
User sends message
    ↓
chatStore.sendMessage()
    ↓
executionAdapter.sendMessage()
    ↓
agentPresenter.sendMessage(threadId, content)
    ↓
STREAM_EVENTS.RESPONSE → useChatEvents → executionAdapter → messageStreaming
```

**Target Flow**:
```
User sends message
    ↓
chatStore.sendMessage()
    ↓
useAgenticPresenter().sendMessage(sessionId, content)
    ↓
agenticPresenter.sendMessage(sessionId, content) [IPC]
    ↓
AgenticEventType.MESSAGE_DELTA → agenticEventHandler → messageStreaming
```

---

## 4. Terminology Migration Strategy

### 4.1 Mapping Table

| Current | Target | Semantic Meaning |
|---------|--------|------------------|
| `threadId` | `sessionId` | Active conversation/session |
| `conversationId` | `sessionId` | Database/conversation ID |
| `activeThreadId` | `activeSessionId` | Currently active session |
| `isAcpMode` | (agent capability check) | Deprecated |

### 4.2 Migration Approach

**Option A: Search-and-Replace (Risky)**
- Find all `threadId` → Replace with `sessionId`
- Find all `conversationId` → Replace with `sessionId`
- **Risk**: May break existing functionality

**Option B: Aliases (Recommended)**
- Create computed aliases during migration
- Maintain backward compatibility
- Phase out old names gradually

**Implementation**:
```typescript
// Phase 1: Create aliases
const activeThreadId = ref<string | null>(null)
const activeSessionId = computed({
  get: () => activeThreadId.value,
  set: (val) => { activeThreadId.value = val }
})

// Phase 2: Switch to new names
// Phase 3: Remove old aliases
```

### 4.3 Database Terminology

**Decision**: Keep `conversationId` in SQLite, map to `sessionId` in API

```typescript
// Internal mapping (in presenter layer)
sessionId (AgenticPresenter)
    ↓ maps to
conversationId (SQLite)

// Renderer sees only sessionId
// Presenter handles the mapping
```

---

## 5. Event System Unification

### 5.1 Event Mapping Table

| Current Event | Target Event | Payload Changes |
|---------------|--------------|-----------------|
| `STREAM_EVENTS.RESPONSE` | `AgenticEventType.MESSAGE_DELTA` | Add `sessionId` |
| `STREAM_EVENTS.END` | `AgenticEventType.MESSAGE_END` | Add `sessionId` |
| `STREAM_EVENTS.ERROR` | `AgenticEventType.ERROR` | Add `sessionId` |
| `ACP_WORKSPACE_EVENTS.SESSION_MODES_READY` | `AgenticEventType.SESSION_UPDATED` | Include in `SessionInfo` |
| `ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY` | `AgenticEventType.SESSION_UPDATED` | Include in `SessionInfo` |
| `ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE` | `AgenticEventType.SESSION_UPDATED` | Include in `SessionInfo` |

### 5.2 Unified Event Handler

**New File**: `src/renderer/src/composables/useAgenticEvents.ts`

```typescript
export function useAgenticEvents() {
  const chatStore = useChatStore()

  const setupEventListeners = () => {
    // Session lifecycle
    window.api.on(AgenticEventType.SESSION_CREATED, handleSessionCreated)
    window.api.on(AgenticEventType.SESSION_READY, handleSessionReady)
    window.api.on(AgenticEventType.SESSION_UPDATED, handleSessionUpdated)
    window.api.on(AgenticEventType.SESSION_CLOSED, handleSessionClosed)

    // Message flow
    window.api.on(AgenticEventType.MESSAGE_DELTA, handleMessageDelta)
    window.api.on(AgenticEventType.MESSAGE_BLOCK, handleMessageBlock)
    window.api.on(AgenticEventType.MESSAGE_END, handleMessageEnd)

    // Tool calls
    window.api.on(AgenticEventType.TOOL_START, handleToolStart)
    window.api.on(AgenticEventType.TOOL_RUNNING, handleToolRunning)
    window.api.on(AgenticEventType.TOOL_END, handleToolEnd)

    // Tool permissions
    window.api.on(AgenticEventType.TOOL_PERMISSION_REQUIRED, handlePermissionRequired)
    window.api.on(AgenticEventType.TOOL_PERMISSION_GRANTED, handlePermissionGranted)
    window.api.on(AgenticEventType.TOOL_PERMISSION_DENIED, handlePermissionDenied)

    // Status
    window.api.on(AgenticEventType.STATUS_CHANGED, handleStatusChanged)
    window.api.on(AgenticEventType.ERROR, handleError)
  }

  return { setupEventListeners }
}
```

### 5.3 Migration Strategy

**Phase 1**: Dual event listeners (both old and new)
**Phase 2**: Route all new events through unified handler
**Phase 3**: Remove old event listeners

---

## 6. Configuration Consolidation

### 6.1 Current Structure

```typescript
interface CONVERSATION_SETTINGS {
  providerId: string        // 'acp' or other
  modelId: string           // agentId for ACP, modelId for others
  chatMode?: 'acp agent'    // ACP-specific
  acpWorkdirMap?: Record<string, string>  // ACP-specific
  agentWorkspacePath?: string | null  // Shared
  temperature: number
  // ... other fields
}
```

### 6.2 Proposed Structure

```typescript
interface UnifiedSessionConfig {
  // Agent identification
  agentId: string           // e.g., 'deepchat.default', 'acp.anthropic.claude-code'

  // Selection
  modelId?: string          // Optional model override
  modeId?: string           // Optional mode override

  // Workspace
  workspacePath?: string    // Unified workspace path

  // LLM parameters
  temperature?: number
  maxTokens?: number
  contextLength?: number
  systemPrompt?: string

  // Agent-specific (passed through)
  [key: string]: any
}
```

### 6.3 Migration Approach

**Phase 1**: Add conversion utilities
```typescript
function toUnifiedConfig(settings: CONVERSATION_SETTINGS): UnifiedSessionConfig {
  const agentId = settings.providerId === 'acp'
    ? settings.modelId  // ACP: modelId is agentId
    : 'deepchat.default'

  return {
    agentId,
    modelId: settings.providerId === 'acp' ? undefined : settings.modelId,
    modeId: settings.chatMode === 'acp agent' ? undefined : settings.modeId,
    workspacePath: settings.agentWorkspacePath ?? settings.acpWorkdirMap?.[settings.modelId],
    temperature: settings.temperature,
    // ... map other fields
  }
}
```

**Phase 2**: Use unified config in new code
**Phase 3**: Migrate existing code
**Phase 4**: Deprecate old config type

---

## 7. Component Refactoring

### 7.1 Current Branching Pattern

```vue
<template>
  <!-- Agent-type specific rendering -->
  <AcpModeSelector v-if="isAcpModel && hasModes" />
  <ModelSelector v-else-if="variant === 'agent'" />
</template>

<script setup lang="ts">
const isAcpModel = computed(() => activeModel.value?.providerId === 'acp')
</script>
```

### 7.2 Target Pattern (Capability-Based)

```vue
<template>
  <!-- Capability-based rendering -->
  <ModeSelector v-if="sessionInfo?.availableModes" />
  <ModelSelector v-if="sessionInfo?.availableModels" />
</template>

<script setup lang="ts">
const sessionInfo = computed(() => useAgenticPresenter().getSession(sessionId))
</script>
```

### 7.3 Components to Refactor

| Component | Current Branching | Target Approach |
|-----------|-------------------|-----------------|
| `ChatInput.vue` | `variant === 'acp'` | Capability-based |
| `ModelSelector.vue` | `providerId === 'acp'` | Session models |
| `ChatConfig.vue` | `providerId === 'acp'` | Unified config |
| `MessageItemAssistant.vue` | `model_provider === 'acp'` | Agent info from session |

---

## 8. Phase 1: Foundation

### 8.1 Objectives

1. Create type definitions for renderer
2. Set up testing infrastructure
3. Create migration utilities

### 8.2 Deliverables

| File | Purpose |
|------|---------|
| `src/renderer/src/types/agentic.ts` | Renderer-side types |
| `src/renderer/src/utils/agenticMigration.ts` | Migration utilities |
| `src/renderer/src/composables/useAgenticTypes.ts` | Type utilities |

### 8.3 Implementation

**File**: `src/renderer/src/types/agentic.ts`
```typescript
import type { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'

// Renderer-specific extensions
export interface RendererSessionState {
  sessionId: string
  agentId: string
  status: 'idle' | 'generating' | 'paused' | 'error'
  messageIds: string[]
  lastActivity: number
}

export interface AgenticEventPayload {
  sessionId: string
  [key: string]: unknown
}
```

**File**: `src/renderer/src/utils/agenticMigration.ts`
```typescript
export class AgenticMigration {
  // Terminology mapping
  static threadIdToSessionId(threadId: string): string {
    return threadId  // Initially identity, may add prefix later
  }

  static sessionIdToThreadId(sessionId: string): string {
    return sessionId  // Initially identity
  }

  // Config conversion
  static toUnifiedConfig(settings: CONVERSATION_SETTINGS): UnifiedSessionConfig {
    // Conversion logic
  }

  static fromUnifiedConfig(config: UnifiedSessionConfig): CONVERSATION_SETTINGS {
    // Reverse conversion
  }

  // Event conversion
  static convertStreamEvent(event: StreamMessage): AgenticEventPayload | null {
    // Convert STREAM_EVENTS to AgenticEventType
  }
}
```

### 8.4 Testing

```typescript
// test/renderer/agentic/migration.test.ts
describe('AgenticMigration', () => {
  it('should convert threadId to sessionId', () => {
    expect(AgenticMigration.threadIdToSessionId('abc-123'))
      .toBe('abc-123')
  })

  it('should convert config to unified', () => {
    const settings: CONVERSATION_SETTINGS = {
      providerId: 'acp',
      modelId: 'claude-code-acp',
      // ...
    }
    const unified = AgenticMigration.toUnifiedConfig(settings)
    expect(unified.agentId).toBe('claude-code-acp')
  })
})
```

---

## 9. Phase 2: Composable Creation

### 9.1 Objectives

1. Create `useAgenticPresenter()` composable
2. Implement all IAgenticPresenter methods
3. Add proper error handling

### 9.2 Core Implementation

**File**: `src/renderer/src/composables/useAgenticPresenter.ts`

```typescript
import { usePresenter } from './usePresenter'
import type { IAgenticPresenter } from '@shared/types/presenters/agentic.presenter.d'

interface UseAgenticPresenterOptions {
  onError?: (error: Error, context: string) => void
}

export function useAgenticPresenter(options?: UseAgenticPresenterOptions) {
  // Get AgenticPresenter from main process
  // Note: This will be added to IPresenter interface
  const agenticP = usePresenter('agenticPresenter') as IAgenticPresenter

  // Session management
  const createSession = async (agentId: string, config: SessionConfig) => {
    try {
      return await agenticP.createSession(agentId, config)
    } catch (error) {
      options?.onError?.(error as Error, 'createSession')
      throw error
    }
  }

  const getSession = async (sessionId: string) => {
    try {
      return await agenticP.getSession(sessionId)
    } catch (error) {
      options?.onError?.(error as Error, 'getSession')
      return null
    }
  }

  const loadSession = async (sessionId: string, context?: LoadContext) => {
    try {
      await agenticP.loadSession(sessionId, context ?? {})
    } catch (error) {
      options?.onError?.(error as Error, 'loadSession')
      throw error
    }
  }

  const closeSession = async (sessionId: string) => {
    try {
      await agenticP.closeSession(sessionId)
    } catch (error) {
      options?.onError?.(error as Error, 'closeSession')
      throw error
    }
  }

  // Messaging
  const sendMessage = async (sessionId: string, content: MessageContent) => {
    try {
      await agenticP.sendMessage(sessionId, content)
    } catch (error) {
      options?.onError?.(error as Error, 'sendMessage')
      throw error
    }
  }

  const cancelMessage = async (sessionId: string, messageId: string) => {
    try {
      await agenticP.cancelMessage(sessionId, messageId)
    } catch (error) {
      options?.onError?.(error as Error, 'cancelMessage')
      throw error
    }
  }

  // Model/Mode selection
  const setModel = async (sessionId: string, modelId: string) => {
    try {
      await agenticP.setModel(sessionId, modelId)
    } catch (error) {
      options?.onError?.(error as Error, 'setModel')
      throw error
    }
  }

  const setMode = async (sessionId: string, modeId: string) => {
    try {
      await agenticP.setMode(sessionId, modeId)
    } catch (error) {
      options?.onError?.(error as Error, 'setMode')
      throw error
    }
  }

  return {
    createSession,
    getSession,
    loadSession,
    closeSession,
    sendMessage,
    cancelMessage,
    setModel,
    setMode
  }
}
```

### 9.3 Testing

```typescript
// test/renderer/composables/useAgenticPresenter.test.ts
describe('useAgenticPresenter', () => {
  it('should create session', async () => {
    const { createSession } = useAgenticPresenter()
    const sessionId = await createSession('deepchat.default', {})
    expect(sessionId).toBeTruthy()
  })

  it('should handle errors', async () => {
    const onError = vi.fn()
    const { sendMessage } = useAgenticPresenter({ onError })

    await expect(sendMessage('invalid', {}))
      .rejects.toThrow()

    expect(onError).toHaveBeenCalled()
  })
})
```

---

## 10. Phase 3: Event Migration

### 10.1 Objectives

1. Create unified event handler
2. Route all AgenticEventType events
3. Maintain dual listeners during transition

### 10.2 Implementation

**File**: `src/renderer/src/composables/useAgenticEvents.ts`

```typescript
import { windowApi } from '@/utils/windowApi'
import { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'
import type { AgenticEventPayload } from '@/types/agentic'

export function useAgenticEvents(handlers: {
  onSessionCreated?: (payload: SessionCreatedEvent) => void
  onSessionReady?: (payload: SessionReadyEvent) => void
  onSessionUpdated?: (payload: SessionUpdatedEvent) => void
  onSessionClosed?: (payload: SessionClosedEvent) => void
  onMessageDelta?: (payload: MessageDeltaEvent) => void
  onMessageBlock?: (payload: MessageBlockEvent) => void
  onMessageEnd?: (payload: MessageEndEvent) => void
  onToolStart?: (payload: ToolStartEvent) => void
  onToolRunning?: (payload: ToolRunningEvent) => void
  onToolEnd?: (payload: ToolEndEvent) => void
  onPermissionRequired?: (payload: ToolPermissionRequiredEvent) => void
  onPermissionGranted?: (payload: ToolPermissionGrantedEvent) => void
  onPermissionDenied?: (payload: ToolPermissionDeniedEvent) => void
  onStatusChanged?: (payload: StatusChangedEvent) => void
  onError?: (payload: AgenticErrorEvent) => void
}) {
  const setupListeners = () => {
    const api = windowApi()

    // Session lifecycle
    api.on(AgenticEventType.SESSION_CREATED, (_, payload) => {
      handlers.onSessionCreated?.(payload as SessionCreatedEvent)
    })

    api.on(AgenticEventType.SESSION_READY, (_, payload) => {
      handlers.onSessionReady?.(payload as SessionReadyEvent)
    })

    api.on(AgenticEventType.SESSION_UPDATED, (_, payload) => {
      handlers.onSessionUpdated?.(payload as SessionUpdatedEvent)
    })

    api.on(AgenticEventType.SESSION_CLOSED, (_, payload) => {
      handlers.onSessionClosed?.(payload as SessionClosedEvent)
    })

    // Message flow
    api.on(AgenticEventType.MESSAGE_DELTA, (_, payload) => {
      handlers.onMessageDelta?.(payload as MessageDeltaEvent)
    })

    api.on(AgenticEventType.MESSAGE_BLOCK, (_, payload) => {
      handlers.onMessageBlock?.(payload as MessageBlockEvent)
    })

    api.on(AgenticEventType.MESSAGE_END, (_, payload) => {
      handlers.onMessageEnd?.(payload as MessageEndEvent)
    })

    // Tool calls
    api.on(AgenticEventType.TOOL_START, (_, payload) => {
      handlers.onToolStart?.(payload as ToolStartEvent)
    })

    api.on(AgenticEventType.TOOL_RUNNING, (_, payload) => {
      handlers.onToolRunning?.(payload as ToolRunningEvent)
    })

    api.on(AgenticEventType.TOOL_END, (_, payload) => {
      handlers.onToolEnd?.(payload as ToolEndEvent)
    })

    // Tool permissions
    api.on(AgenticEventType.TOOL_PERMISSION_REQUIRED, (_, payload) => {
      handlers.onPermissionRequired?.(payload as ToolPermissionRequiredEvent)
    })

    api.on(AgenticEventType.TOOL_PERMISSION_GRANTED, (_, payload) => {
      handlers.onPermissionGranted?.(payload as ToolPermissionGrantedEvent)
    })

    api.on(AgenticEventType.TOOL_PERMISSION_DENIED, (_, payload) => {
      handlers.onPermissionDenied?.(payload as ToolPermissionDeniedEvent)
    })

    // Status
    api.on(AgenticEventType.STATUS_CHANGED, (_, payload) => {
      handlers.onStatusChanged?.(payload as StatusChangedEvent)
    })

    api.on(AgenticEventType.ERROR, (_, payload) => {
      handlers.onError?.(payload as AgenticErrorEvent)
    })
  }

  const cleanupListeners = () => {
    const api = windowApi()

    // Remove all listeners
    Object.values(AgenticEventType).forEach(eventType => {
      api.removeAllListeners(eventType)
    })
  }

  return {
    setupListeners,
    cleanupListeners
  }
}
```

### 10.3 Integration with Chat Store

```typescript
// In useChatStoreService.ts
export function useChatStoreService() {
  // ... existing code ...

  // Add agentic event handlers
  const agenticHandlers = {
    onMessageDelta: (payload) => {
      messageStreaming.handleStreamResponse({
        eventId: payload.messageId,
        conversationId: payload.sessionId,
        content: payload.content,
        stream_kind: 'delta'
      })
    },

    onMessageEnd: (payload) => {
      messageStreaming.handleStreamEnd({
        eventId: payload.messageId
      })
    },

    // ... other handlers
  }

  const { setupListeners: setupAgenticListeners } = useAgenticEvents(agenticHandlers)

  // Call in onMounted
  onMounted(() => {
    setupChatEvents()  // Existing
    setupAgenticListeners()  // New
  })

  return {
    // ... existing exports ...
  }
}
```

---

## 11. Phase 4: State Migration

### 11.1 Objectives

1. Rename `threadId` → `sessionId` throughout state
2. Update all state references
3. Maintain backward compatibility aliases

### 11.2 Migration Strategy

**Step 1**: Add aliases in `useChatStoreService.ts`

```typescript
// Old names (deprecated)
const activeThreadId = ref<string | null>(null)

// New names
const activeSessionId = computed({
  get: () => activeThreadId.value,
  set: (val) => { activeThreadId.value = val }
})

// Export both during transition
export function useChatStoreService() {
  return {
    // New names
    activeSessionId,

    // Old names (deprecated)
    activeThreadId,

    // Methods
    setActiveSessionId: (id: string | null) => {
      activeThreadId.value = id
    }
  }
}
```

**Step 2**: Update all consumers to use `sessionId`

**Step 3**: Remove deprecated aliases

### 11.3 Component Migration Example

**Before**:
```vue
<script setup lang="ts">
const chatStore = useChatStore()
const threadId = computed(() => chatStore.activeThreadId)
</script>
```

**After**:
```vue
<script setup lang="ts">
const chatStore = useChatStore()
const sessionId = computed(() => chatStore.activeSessionId)
</script>
```

---

## 12. Phase 5: Component Migration

### 12.1 Objectives

1. Remove agent-type branching from components
2. Use capability-based rendering
3. Consolidate ACP-specific components

### 12.2 Component Migration Pattern

**Pattern 1: Conditional Rendering**

**Before**:
```vue
<AcpModeSelector v-if="isAcpModel && hasModes" />
```

**After**:
```vue
<ModeSelector v-if="sessionInfo?.availableModes" :modes="sessionInfo.availableModes" />
```

**Pattern 2: Model Selection**

**Before**:
```vue
<ModelSelector v-if="variant === 'agent'" />
<AcpSessionModelSelector v-if="isAcpModel && hasModels" />
```

**After**:
```vue
<ModelSelector
  :available-models="sessionInfo?.availableModels ?? []"
  :current-model="sessionInfo?.currentModelId"
  @model-select="handleModelSelect"
/>
```

### 12.3 Components to Refactor

| Component | Changes |
|-----------|---------|
| `ChatInput.vue` | Remove `variant` prop, use session capabilities |
| `ModelSelector.vue` | Support ACP agent models |
| `ChatConfig.vue` | Remove `providerId === 'acp'` checks |
| `MessageItemAssistant.vue` | Use `SessionInfo` for agent metadata |
| `AcpModeSelector.vue` | Rename to `ModeSelector`, make generic |
| `AcpSessionModelSelector.vue` | Merge into `ModelSelector` |

### 12.4 New Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ChatInput.vue                             │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              AgentHeader.vue (NEW)                    │ │
│  │  - Shows agent name, icon, status                      │ │
│  │  - Uses SessionInfo from agenticPresenter             │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              ModelSelector.vue (REFACTORED)           │ │
│  │  - Supports all agent models                          │ │
│  │  - Uses sessionInfo.availableModels                   │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              ModeSelector.vue (NEW)                   │ │
│  │  - Shows available modes (if any)                     │ │
│  │  - Uses sessionInfo.availableModes                    │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              PromptInput.vue (UNCHANGED)              │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 13. Testing Strategy

### 13.1 Unit Tests

| Test File | Coverage |
|-----------|----------|
| `agentic/migration.test.ts` | Migration utilities |
| `composables/useAgenticPresenter.test.ts` | Composable methods |
| `composables/useAgenticEvents.test.ts` | Event handlers |

### 13.2 Integration Tests

| Test File | Coverage |
|-----------|----------|
| `agentic/session-lifecycle.test.ts` | Create, load, close sessions |
| `agentic/messaging.test.ts` | Send, cancel messages |
| `agentic/event-flow.test.ts` | Event propagation |
| `agentic/multi-agent.test.ts` | Multiple agent types |

### 13.3 E2E Tests

| Test File | Coverage |
|-----------|----------|
| `e2e/deepchat-flow.test.ts` | DeepChat agent usage |
| `e2e/acp-flow.test.ts` | ACP agent usage |
| `e2e/switching.test.ts` | Switch between agent types |

### 13.4 Manual Testing Checklist

- [ ] Create DeepChat session
- [ ] Create ACP session
- [ ] Send message to DeepChat
- [ ] Send message to ACP
- [ ] Load DeepChat history
- [ ] Load ACP history
- [ ] Switch models (DeepChat)
- [ ] Switch models (ACP)
- [ ] Switch modes (ACP)
- [ ] Cancel message (DeepChat)
- [ ] Cancel message (ACP)
- [ ] Handle permissions (DeepChat)
- [ ] Handle errors (both)

---

## 14. Rollout Plan

### 14.1 Phased Rollout

**Phase 1: Foundation (Week 1-2)**
- Create type definitions
- Set up testing infrastructure
- Create migration utilities
- **Risk**: Low
- **Rollback**: Easy (delete new files)

**Phase 2: Composable (Week 2-3)**
- Implement `useAgenticPresenter()`
- Add to preload bridge
- Write tests
- **Risk**: Medium
- **Rollback**: Remove from preload

**Phase 3: Event Migration (Week 3-4)**
- Create unified event handler
- Route events alongside existing
- Verify event flow
- **Risk**: Medium
- **Rollback**: Stop routing new events

**Phase 4: State Migration (Week 4-5)**
- Add terminology aliases
- Migrate state references
- Remove old names
- **Risk**: High
- **Rollback**: Revert commits

**Phase 5: Component Migration (Week 5-6)**
- Refactor components
- Remove agent-type branching
- Consolidate components
- **Risk**: High
- **Rollback**: Revert commits

### 14.2 Feature Flags

```typescript
// In config
const FEATURES = {
  AGENTIC_UNIFIED_LAYER: true,  // Master flag
  UNIFIED_EVENTS: true,          // Phase 3
  UNIFIED_STATE: false,          // Phase 4
  UNIFIED_COMPONENTS: false      // Phase 5
}
```

### 14.3 Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Agent-type branching | ~50 locations | 0 | Code search |
| Event types | 2 systems | 1 | Event listeners |
| Terminology consistency | Mixed | 100% | Code review |
| Test coverage | 0% | 80% | Test report |

---

## 15. Conclusion

This design provides a comprehensive, phased approach to integrating the Agentic Unified Layer into the renderer. The key principles are:

1. **Gradual Migration** - No breaking changes, phases can be rolled back
2. **Terminology Consistency** - Unified use of `sessionId` throughout
3. **Event Unification** - Single event format for all agent types
4. **Configuration Consolidation** - Single config structure
5. **Capability-Based Rendering** - No agent-type branching

The phased approach minimizes risk while allowing the team to validate each phase before proceeding. The foundation can be implemented immediately, with subsequent phases following as capacity allows.

---

## Appendix A: File Changes Summary

### New Files

| File | Purpose | Lines (est.) |
|------|---------|--------------|
| `src/renderer/src/types/agentic.ts` | Type definitions | 100 |
| `src/renderer/src/utils/agenticMigration.ts` | Migration utilities | 150 |
| `src/renderer/src/composables/useAgenticPresenter.ts` | Main composable | 200 |
| `src/renderer/src/composables/useAgenticEvents.ts` | Event handler | 150 |
| `src/renderer/src/components/AgentHeader.vue` | New component | 100 |
| `src/renderer/src/components/ModeSelector.vue` | New component | 150 |

### Modified Files

| File | Changes | Lines (est.) |
|------|---------|--------------|
| `src/preload/index.ts` | Add agenticPresenter to IPresenter | 20 |
| `src/renderer/src/composables/chat/useChatStoreService.ts` | Add agentic integration | 100 |
| `src/renderer/src/composables/chat/useChatEvents.ts` | Add unified events | 50 |
| `src/renderer/src/components/chat-input/ChatInput.vue` | Remove branching | 150 |
| `src/renderer/src/components/ChatConfig.vue` | Use unified config | 100 |
| `src/renderer/src/components/message/MessageItemAssistant.vue` | Use SessionInfo | 50 |

### Deleted Files

| File | Replaced By |
|------|-------------|
| `src/renderer/src/components/chat-input/AcpModeSelector.vue` | ModeSelector.vue |
| `src/renderer/src/components/chat-input/AcpSessionModelSelector.vue` | ModelSelector.vue |

---

## Appendix B: Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Breaking existing functionality | High | Medium | Phased rollout, feature flags |
| Performance regression | Medium | Low | Benchmarking, optimization |
| Type errors | Medium | Medium | Strict type checking, tests |
| Incomplete migration | High | Medium | Code review, checklist |
| User confusion | Low | Low | Documentation, UI hints |

---

## Appendix C: Open Questions

1. **Session ID Format**: Should we add a prefix to distinguish agent types? (e.g., `acp:xxx`, `dc:xxx`)
   - **Recommendation**: No, let presenter handle routing

2. **Backward Compatibility**: How long to maintain dual event listeners?
   - **Recommendation**: One release cycle after full migration

3. **ACP Workspace**: How to handle ACP workdir in unified config?
   - **Recommendation**: Use `workspacePath` field, let ACP presenter handle workdir mapping

4. **Migration Timeline**: What's the minimum viable Phase 1?
   - **Recommendation**: Types + composable + tests, no UI changes
