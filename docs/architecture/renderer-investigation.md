# Renderer Architecture Investigation Report

## Executive Summary

This report provides a comprehensive investigation of the renderer layer architecture in DeepChat, focusing on agent interaction patterns, state management, event handling, message streaming, and business dependencies between ACP and DeepChat services.

**Date**: 2026-01-25
**Scope**: `src/renderer/src/`
**Purpose**: Understand current renderer architecture to design Agentic Unified Layer integration

---

## Table of Contents

1. [Agent Type Detection & Branching](#1-agent-type-detection--branching)
2. [Presenter Usage Patterns](#2-presenter-usage-patterns)
3. [Message Sending Flow](#3-message-sending-flow)
4. [Session/Conversation Management](#4-sessionconversation-management)
5. [State Management Architecture](#5-state-management-architecture)
6. [Event Handling System](#6-event-handling-system)
7. [Message Streaming & Block Processing](#7-message-streaming--block-processing)
8. [ACP vs DeepChat Service Dependencies](#8-acp-vs-deepchat-service-dependencies)
9. [UI Component Architecture](#9-ui-component-architecture)
10. [Key Architectural Issues](#10-key-architectural-issues)

---

## 1. Agent Type Detection & Branching

### 1.1 Primary Detection Method

The renderer detects agent types through the `providerId` field in the model configuration:

```typescript
// Location: Multiple files in src/renderer/src/components/chat-input/composables/
const isAcpModel = computed(
  () => activeModel.value?.providerId === 'acp' && !!activeModel.value?.id
)
```

**Found in**:
- `useAcpMode.ts` (lines 33-35)
- `useAcpSessionModel.ts` (lines 33-35)
- `useAcpWorkdir.ts` (lines 29-30)
- `useAcpCommands.ts` (lines 23-25)

### 1.2 Branching Logic Locations

| File | Line | Pattern |
|------|------|----------|
| `ChatInput.vue` | 131 | `v-if="variant === 'acp' && acpMode.isAcpModel.value"` |
| `useChatEvents.ts` | 126 | `if (providerId === 'acp')` |
| `ChatConfig.vue` | 185, 251 | `props.providerId === 'acp'` |
| `ModelSelector.vue` | 10 | `activeModel.providerId === 'acp'` |

### 1.3 ACP Mode Cleanup (IMPORTANT)

**CRITICAL FINDING**: The codebase has undergone ACP cleanup. The `isAcpMode` computed property now always returns `false`:

```typescript
// Location: useChatStoreService.ts:103-104
const isAcpMode = computed(() => false)
const activeAcpAgentId = computed(() => null as string | null)
```

**Implication**: ACP-only chat mode has been deprecated, though ACP agents still work through the unified agent flow.

---

## 2. Presenter Usage Patterns

### 2.1 AgentPresenter (Unified Message Handler)

**Used for ALL agent message sending** (both DeepChat and ACP agents):

**Interface**: `src/shared/types/presenters/agent.presenter.d.ts`

**Usage**: `src/renderer/src/composables/chat/useExecutionAdapter.ts:32`

```typescript
const agentP = usePresenter('agentPresenter')
```

**Key Methods Called**:
| Method | Purpose |
|--------|---------|
| `sendMessage()` | Send user message (line 62) |
| `continueLoop()` | Continue from interruption (line 99) |
| `cancelLoop()` | Cancel generation (line 150) |
| `retryMessage()` | Retry with different variant (line 125) |
| `regenerateFromUserMessage()` | Regenerate from user message (line 132) |

### 2.2 AcpPresenter (ACP-Specific Operations)

**Used for ACP session/mode/model management only** (NOT message sending):

**Interface**: `src/shared/types/presenters/acp.presenter.d.ts`

**Usage**: `src/renderer/src/composables/chat/useAcpRuntimeAdapter.ts:10`

```typescript
const acpPresenter = usePresenter('acpPresenter' as any) as IAcpPresenter
```

**Key Methods Called** (via `useAcpRuntimeAdapter`):
| Method | Purpose |
|--------|---------|
| `warmupProcess()` | Pre-warm ACP agent process |
| `setSessionMode()` | Change permission policy mode |
| `setSessionModel()` | Change model within session |
| `getSessionInfo()` | Retrieve session information |

### 2.3 Other Presenters

| Presenter | Purpose | Location |
|-----------|---------|----------|
| `sessionPresenter` | Core conversation management | `useConversationCore.ts:22` |
| `configPresenter` | Model and configuration | `usePromptInputConfig.ts:25` |

---

## 3. Message Sending Flow

### 3.1 Unified Flow for ALL Agent Types

**CRITICAL FINDING**: The renderer uses a **unified message sending flow** for both DeepChat and ACP agents through `agentPresenter`.

```
User sends message
    ↓
ChatInput.vue emit('send')
    ↓
ChatLayout.vue: chatStore.sendMessage(msg)
    ↓
useChatStoreService.ts: sendMessage()
    ↓
useExecutionAdapter.ts: sendMessage()
    ↓
agentPresenter.sendMessage(threadId, content, tabId, variants)
    ↓
Main Process (agentPresenter routes to appropriate backend)
    ↓
Stream Events (STREAM_EVENTS.RESPONSE/END/ERROR)
    ↓
useMessageStreaming.ts handles stream updates
```

### 3.2 Key Implementation

**Location**: `useExecutionAdapter.ts:54-90`

```typescript
const sendMessage = async (content: UserMessageContent | AssistantMessageBlock[]) => {
  const threadId = options.activeThreadId.value
  if (!threadId || !content) return

  try {
    options.generatingThreadIds.value.add(threadId)
    options.updateThreadWorkingStatus(threadId, 'working')

    const aiResponseMessage = await agentP.sendMessage(
      threadId,  // NOTE: Uses conversationId as agentId
      JSON.stringify(content),
      options.getTabId(),
      options.selectedVariantsMap.value
    )

    if (!aiResponseMessage) {
      throw new Error('Failed to create assistant message')
    }

    options.generatingMessagesCache.value.set(aiResponseMessage.id, {
      message: aiResponseMessage,
      threadId
    })
    options.messageCacheComposable.cacheMessageForView(aiResponseMessage)
    options.messageCacheComposable.ensureMessageId(aiResponseMessage.id)

    await options.loadMessages()
  } catch (error) {
    console.error('Failed to send message:', error)
  }
}
```

### 3.3 No Branching in Renderer

**Key Point**: The renderer does NOT decide which flow to use - it always calls `agentPresenter.sendMessage()`. The backend handles routing to the appropriate provider.

---

## 4. Session/Conversation Management

### 4.1 Terminology Gap

| Term | Usage | Notes |
|------|-------|-------|
| `conversationId` | Main process | SQLite primary key |
| `sessionId` | ACP sessions | Agent-generated session ID |
| `threadId` | Renderer | Active conversation ID |
| `agentId` | ACP context | ACP agent identifier |

### 4.2 Key Relationships

```
conversationId (renderer)
    ↓ maps to
threadId (useChatStoreService)
    ↓ passed as
agentId (to agentPresenter.sendMessage)
    ↓ backend maps to
conversationId (main process)
```

### 4.3 Active Thread Management

**Location**: `useChatStoreService.ts:52`

```typescript
const activeThreadId = ref<string | null>(null)
```

**Management**:
- Set via `setActiveThreadId()`
- Loaded from route params in `ChatTabView.vue`
- Cleared via `clearActiveThread()`
- **NOT dependent on agent type** - same flow for all agents

---

## 5. State Management Architecture

### 5.1 Pinia Stores

**All stores in** `src/renderer/src/stores/`:

| Store | Purpose | Agent-Specific? |
|-------|---------|----------------|
| `agentModelStore.ts` | ACP agent models | ✅ ACP-only |
| `chat.ts` | Main chat state | ⚠️ Has deprecated ACP flag |
| `traceDialog.ts` | Debug dialog (has agentId) | ✅ Agent-aware |
| `workspace.ts` | Workspace for agents | ⚠️ Used by both |
| `mcp.ts` | MCP servers/tools | ❌ Shared |
| `modelStore.ts` | Model catalog | ⚠️ Includes ACP as "models" |
| `providerStore.ts` | LLM providers | ❌ Shared |

### 5.2 Chat State Management

**Location**: `useChatStoreService.ts`

**Core State**:
```typescript
// Active thread
activeThreadId: ref<string | null>(null)

// Message tracking
messageIds: ref<string[]>([])
generatingMessagesCache: ref<Map<string, { message: Message; threadId: string }>>

// Thread state
generatingThreadIds: ref<Set<string>>
threadsWorkingStatus: ref<Map<string, WorkingStatus>>

// Variants
selectedVariantsMap: ref<Record<string, string>>({})
```

### 5.3 Store Dependency Graph

```
chatStore (useChatStoreService)
  ├── ConversationCore
  ├── ChatAdapter
  ├── ChatConfig
  ├── ThreadManagement
  ├── MessageCache
  ├── VariantManagement
  ├── ExecutionAdapter
  │   └── MessageStreaming
  ├── ChatEvents
  ├── Deeplink
  ├── ChatAudio
  └── ThreadExport

modelStore (useModelStoreService)
  ├── ProviderStore
  ├── ModelConfigStore
  └── AgentModelStore (agent-specific)

workspaceStore (useWorkspaceStoreService)
  └── ChatStore (for activeThreadId)
```

### 5.4 Circular Dependencies

**Potential**: `workspaceStore` → `chatStore` → `workspaceStore`

**Mitigation**: Workspace store is lazily accessed in ExecutionAdapter (line 36-41)

---

## 6. Event Handling System

### 6.1 Event Setup Location

**Location**: `useChatEvents.ts` (lines 42-214)

### 6.2 Event Listeners by Type

**STREAM_EVENTS** (lines 179-197):
```typescript
window.electron.ipcRenderer.on(STREAM_EVENTS.RESPONSE, (_, msg) => {
  executionAdapter.handleStreamResponse(msg)
})
window.electron.ipcRenderer.on(STREAM_EVENTS.END, (_, msg) => {
  executionAdapter.handleStreamEnd(msg)
})
window.electron.ipcRenderer.on(STREAM_EVENTS.ERROR, (_, msg) => {
  executionAdapter.handleStreamError(msg)
})
```

**CONVERSATION_EVENTS**:
- `LIST_UPDATED` - Thread list update (line 49)
- `ACTIVATED` - Thread activation (line 74)
- `DEACTIVATED` - Thread deactivation (line 104)
- `MESSAGE_EDITED` - Message edit (line 99)
- `SCROLL_TO_MESSAGE` - Scroll request (line 114)

**CONFIG_EVENTS**:
- `MODEL_LIST_CHANGED` - Model list with ACP check (lines 125-129)

**ACP-Specific Events** (`useAcpEventsAdapter.ts`):
- `ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE` (line 31)
- `ACP_WORKSPACE_EVENTS.SESSION_MODES_READY` (line 42)
- `ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY` (line 53)

### 6.3 Event Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    MAIN PROCESS                                 │
│  StreamGenerationHandler / LLMEventHandler                      │
│  - Emits STREAM_EVENTS (RESPONSE, END, ERROR)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RENDERER PROCESS                             │
│  useChatEvents.ts (setupStreamEventListeners)                   │
│      │                                                          │
│      ▼                                                          │
│  executionAdapter.handleStream*                                │
│      │                                                          │
│      ▼                                                          │
│  useMessageStreaming.ts (process deltas)                       │
│      │                                                          │
│      ▼                                                          │
│  Message Cache → UI Update                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Message Streaming & Block Processing

### 7.1 Stream Message Structure

**Location**: `useMessageStreaming.ts` (lines 13-48)

```typescript
export interface StreamMessage {
  eventId: string
  conversationId?: string
  parentId?: string
  stream_kind?: 'init' | 'delta' | 'final'

  // Content
  content?: string
  reasoning_content?: string
  image_data?: { data, mimeType }

  // Tool calls
  tool_call_id?: string
  tool_call_name?: string
  tool_call_params?: string
  tool_call?: 'start' | 'end' | 'error' | 'update' | 'running'

  // Metadata
  totalUsage?: { prompt_tokens, completion_tokens, total_tokens }
  rate_limit?: { providerId, qpsLimit, currentQps, ... }
}
```

### 7.2 Message Block Types

**Location**: `src/shared/types/core/chat.ts` (lines 48-104)

| Block Type | Description | Source |
|-----------|-------------|--------|
| `content` | Main response text | All LLMs |
| `reasoning_content` | Chain of thought | Extended thinking models |
| `plan` | Agent execution plan | Agent loop |
| `error` | Error messages | All |
| `tool_call` | MCP/ACP tool execution | Agent loop |
| `action` | User action requests | Agent loop |
| `image` | Generated images | Vision models |
| `mcp_ui_resource` | MCP UI components | MCP tools |
| `search` | Web search results | Search integration |

**Action Subtypes**:
- `tool_call_permission` - Permission request
- `maximum_tool_calls_reached` - Loop limit
- `rate_limit` - Rate limiting

### 7.3 Component Hierarchy

```
MessageList.vue
└── DynamicScroller (Virtual scrolling)
    └── MessageItemAssistant.vue
        ├── ModelIcon
        ├── MessageInfo
        ├── Spinner (loading indicator)
        ├── MessageBlockContent.vue (type: 'content')
        ├── MessageBlockThink.vue (type: 'reasoning_content')
        ├── MessageBlockPlan.vue (type: 'plan')
        ├── MessageBlockSearch.vue (type: 'search')
        ├── MessageBlockToolCall.vue (type: 'tool_call')
        ├── MessageBlockPermissionRequest.vue (type: 'action' + tool_call_permission)
        ├── MessageBlockAction.vue (type: 'action' - other)
        ├── MessageBlockMcpUi.vue (type: 'mcp_ui_resource')
        ├── MessageBlockImage.vue (type: 'image')
        ├── MessageBlockError.vue (type: 'error')
        └── MessageToolbar (copy, retry, fork, trace)
```

### 7.4 Streaming State Management

**State Tracking**:
```typescript
// Active threads
generatingThreadIds: Ref<Set<string>>

// Message cache
generatingMessagesCache: Ref<Map<string, {
  message: Message
  threadId: string
}>>

// Working status
threadsWorkingStatus: Ref<Map<string, WorkingStatus>>
type WorkingStatus = 'working' | 'completed' | 'error'

// Runtime cache
messageCacheComposable: {
  cacheMessageForView(message: Message)
  ensureMessageId(messageId: string)
  findMainAssistantMessageByParentId(parentId: string)
}
```

**State Flow**:
```
GENERATION START
    ↓
1. generatingThreadIds.add(threadId)
2. threadsWorkingStatus.set(threadId, 'working')
3. generatingMessagesCache.set(messageId, {message, threadId})
    ↓
STREAMING PHASE
    ↓
handleStreamResponse(msg)
    ├─ Find message in cache
    ├─ Update blocks based on msg.type
    ├─ cacheMessageForView() → Trigger reactivity
    └─ Update loading states
    ↓
GENERATION END
    ↓
1. generatingMessagesCache.delete(messageId)
2. generatingThreadIds.delete(threadId)
3. threadsWorkingStatus.delete(threadId)
4. Enrich message with metadata
5. Finalize UI update
```

---

## 8. ACP vs DeepChat Service Dependencies

### 8.1 Initialization Comparison

**DeepChat Agents**:
```
1. App.vue mounts
2. initAppStores() → providerStore, modelStore
3. chatStore → useChatStoreService()
4. ChatInput → agent presenter ready
5. First message → agentPresenter.sendMessage()
```

**ACP Agents**:
```
1. App.vue mounts
2. initAppStores() → agentModelStore refreshes ACP agents
3. ChatInput → useAcpMode, useAcpSessionModel, useAcpWorkdir
4. ACP agent selected → warmupAcpProcess()
5. Workdir selected → loadWarmupModes()
6. First message → acpPresenter.createSession() + sendPrompt()
```

### 8.2 Shared vs Agent-Specific Services

| Service | DeepChat | ACP | Notes |
|---------|----------|-----|-------|
| **chatStore** | ✅ | ✅ | Primary state |
| **providerStore** | ✅ | ⚠️ | ACP doesn't use providers |
| **modelStore** | ✅ | ✅ | ACP agents as "models" |
| **agentModelStore** | ❌ | ✅ | ACP-only |
| **configPresenter** | ✅ | ✅ | Shared |
| **mcpStore** | ✅ | ⚠️ | Conditional |
| **workspaceStore** | ✅ | ✅ | Required for ACP |

### 8.3 Timing Dependencies

**Critical Path for ACP**:
```
User Action → Agent Selection → Workdir Selection → Warmup Process
     ↓                                                          ↓
Model Selection ← Mode/Model Loading ← Session Creation ← First Message
```

**DeepChat** has no warmup requirement - can send messages immediately.

### 8.4 Configuration Fields

**Shared**:
- `systemPrompt`, `temperature`, `contextLength`, `maxTokens`
- `providerId`, `modelId`
- `agentWorkspacePath` (shared workspace)
- `enabledMcpTools`

**ACP-Specific**:
- `chatMode: 'acp agent'`
- `acpWorkdirMap: Record<string, string>`

### 8.5 Event Flow Differences

**DeepChat**: Single event stream (STREAM_EVENTS)

**ACP**: Dual event streams
- STREAM_EVENTS (message flow)
- ACP_WORKSPACE_EVENTS (modes, models, commands)

---

## 9. UI Component Architecture

### 9.1 Component Branching by Agent Type

**ChatInput Component** (`ChatInput.vue`):

```vue
<!-- ACP Mode Selector (lines 130-138) -->
<AcpModeSelector
  v-if="variant === 'acp' && acpMode.isAcpModel.value && acpMode.hasAgentModes.value"
/>

<!-- ACP Session Model Selector (lines 142-154) -->
<AcpSessionModelSelector
  v-if="showAcpSessionModelSelector"
/>

<!-- Regular Model Selector (lines 155-187) -->
<ModelSelector
  v-else-if="variant === 'agent' || variant === 'newThread'"
/>
```

### 9.2 ACP-Only Components

| Component | Purpose | Location |
|-----------|---------|----------|
| `AcpModeSelector` | Permission policy modes | `chat-input/AcpModeSelector.vue` |
| `AcpSessionModelSelector` | Agent-specific models | `chat-input/AcpSessionModelSelector.vue` |
| `AcpAgentGrid` | Homepage agent grid | `homepage/AcpAgentGrid.vue` |
| `AcpAgentConfigDialog` | Agent configuration | `homepage/AcpAgentConfigDialog.vue` |

### 9.3 Shared Components (Agent-Aware)

| Component | Branching Logic |
|-----------|----------------|
| `ChatConfig` | `props.providerId === 'acp'` (line 251) |
| `McpToolsList` | Read-only when `chatStore.isAcpMode` (line 34) |
| `MessageItemAssistant` | Shows ACP badge when `model_provider === 'acp'` (line 8) |

---

## 10. Key Architectural Issues

### 10.1 Terminology Mismatch

**Issue**: Inconsistent terminology across layers

| Term | Renderer | Main Process | Agentic Unified Layer |
|------|----------|--------------|---------------------|
| Session ID | ❌ Uses `threadId`/`conversationId` | `sessionId` (ACP) | `sessionId` (unified) |
| Agent ID | ❌ Mixed usage | `agentId` | `agentId` (unified) |

**Impact**: Integration requires terminology mapping

### 10.2 Dual Event Systems

**Issue**: Two separate event formats

| System | Events | Usage |
|--------|--------|-------|
| `STREAM_EVENTS` | RESPONSE, END, ERROR | DeepChat + ACP messages |
| `ACP_WORKSPACE_EVENTS` | MODES_READY, MODELS_READY, COMMANDS_UPDATE | ACP-specific |

**Impact**: Renderer must listen to both event types

### 10.3 Configuration Inconsistency

**Issue**: Separate config fields for agent types

```typescript
// Current structure
{
  providerId: 'acp',  // or 'openai', 'anthropic', etc.
  modelId: 'claude-code-acp',
  chatMode: 'acp agent',  // ACP-specific
  acpWorkdirMap: { 'claude-code-acp': '/path' }  // ACP-specific
}
```

**Impact**: Branching logic throughout codebase

### 10.4 Model System Inconsistency

**Issue**: ACP agents exposed as "models"

```typescript
// ACP agents are treated as models with providerId='acp'
{
  providerId: 'acp',
  id: 'claude-code-acp',
  name: 'Claude Code'
}
```

**Impact**: Confusing semantics - agents ≠ models

### 10.5 Initialization Timing

**Issue**: ACP agents require warmup before use

**DeepChat**: Can send messages immediately after model selection

**ACP**: Must complete warmup process before first message

**Impact**: Different initialization flows

---

## 11. File Reference Summary

### 11.1 Key Investigation Files

| Category | File | Purpose |
|----------|------|---------|
| **State** | `useChatStoreService.ts` | Main chat state |
| **State** | `useExecutionAdapter.ts` | Message execution |
| **State** | `useMessageStreaming.ts` | Stream processing |
| **State** | `useChatEvents.ts` | Event listeners |
| **ACP** | `useAcpRuntimeAdapter.ts` | ACP adapter |
| **ACP** | `useAcpMode.ts` | Mode management |
| **UI** | `ChatInput.vue` | Input component |
| **UI** | `MessageItemAssistant.vue` | Message display |
| **Types** | `agentic.presenter.d.ts` | Unified interface (future) |

### 11.2 Component Locations

```
src/renderer/src/
├── components/
│   ├── chat-input/
│   │   ├── ChatInput.vue (main input component)
│   │   ├── AcpModeSelector.vue
│   │   └── AcpSessionModelSelector.vue
│   ├── message/
│   │   ├── MessageList.vue
│   │   ├── MessageItemAssistant.vue
│   │   └── MessageBlock*.vue (9 block components)
│   ├── homepage/
│   │   ├── AcpAgentGrid.vue
│   │   └── AcpAgentConfigDialog.vue
│   └── ChatConfig.vue
├── composables/
│   ├── chat/
│   │   ├── useChatStoreService.ts
│   │   ├── useExecutionAdapter.ts
│   │   ├── useMessageStreaming.ts
│   │   ├── useChatEvents.ts
│   │   ├── useAcpRuntimeAdapter.ts
│   │   └── useChatConfig.ts
│   ├── acp/
│   │   └── useAcpEventsAdapter.ts
│   └── chat-input/composables/
│       ├── useAcpMode.ts
│       ├── useAcpSessionModel.ts
│       └── useAcpWorkdir.ts
├── stores/
│   ├── chat.ts
│   ├── agentModelStore.ts
│   └── workspace.ts
└── events.ts
```

---

## 12. Recommendations for Agentic Unified Layer Integration

### 12.1 High Priority

1. **Consolidate Terminology**
   - Standardize on `sessionId` throughout renderer
   - Map `conversationId` → `sessionId` in all components
   - Update all references from `threadId` to `sessionId`

2. **Create `useAgenticPresenter()` Composable**
   - Replace `usePresenter('agentPresenter')` calls
   - Replace `usePresenter('acpPresenter')` calls
   - Provide unified interface for all agent operations

3. **Unify Event Handling**
   - Create single event listener for `AgenticEventType`
   - Phase out `STREAM_EVENTS` and `ACP_WORKSPACE_EVENTS`
   - Update `useChatEvents.ts` to use unified events

### 12.2 Medium Priority

4. **Standardize Configuration Structure**
   ```typescript
   interface UnifiedAgentConfig {
     agentId: string  // e.g., 'deepchat.default', 'acp.anthropic.claude-code'
     sessionId: string
     modeId?: string
     modelId?: string
     workspacePath?: string
   }
   ```

5. **Remove Agent Type Branching**
   - Eliminate `providerId === 'acp'` checks
   - Replace with agent capability queries
   - Use `SessionInfo.capabilities` instead

6. **Consolidate Model/Mode Selection**
   - Create unified model selector component
   - Support both DeepChat models and ACP agent models
   - Use `availableModels` and `availableModes` from `SessionInfo`

### 12.3 Lower Priority

7. **Refactor Component Architecture**
   - Remove ACP-specific components where possible
   - Consolidate shared functionality
   - Use capability-based rendering

8. **Standardize Initialization**
   - Create unified initialization flow
   - Handle warmup requirements internally
   - Hide agent-specific complexity

---

## 13. Conclusion

The renderer layer has a **hybrid architecture** where ACP and DeepChat agents share many services but have critical differences in:

1. **Initialization timing** - ACP requires warmup, DeepChat doesn't
2. **Configuration structure** - Separate fields create inconsistency
3. **Event flows** - ACP has dual event streams, DeepChat single
4. **Workspace coupling** - ACP tightly coupled, DeepChat loosely

The **Agentic Unified Layer** provides a path forward for consolidation, but significant renderer refactoring is required to fully adopt the unified interface.

**Key Challenges**:
- Terminology mapping (`conversationId` ↔ `sessionId`)
- Event system unification
- Configuration consolidation
- Component de-branching

**Next Steps**:
1. Design `useAgenticPresenter()` composable
2. Create migration plan for terminology
3. Design unified configuration structure
4. Plan phased rollout to minimize disruption
