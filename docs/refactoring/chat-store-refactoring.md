# Chat Store Refactoring Design

## 📋 Overview

This document outlines the refactoring plan for `src/renderer/src/stores/chat.ts`, which has grown to 2098 lines and suffers from poor separation of concerns, making it difficult to maintain and extend.

**Status**: Design Phase
**Created**: 2026-01-19
**Target**: Q1 2026

---

## 🔍 Current Problems

### 1. Massive Single File (2098 lines)
- Hard to navigate and understand
- Difficult to locate specific functionality
- Merge conflicts are common
- IDE performance degradation

### 2. Poor Separation of Concerns
The store mixes multiple responsibilities:
- Thread/conversation management
- Message CRUD and caching
- Streaming event handling
- Variant message management
- Chat configuration
- Export functionality
- Deeplink handling
- Audio playback
- IPC event coordination

### 3. State Management Issues

#### Duplicate State
```typescript
// Multiple sources of truth for the same concept
generatingThreadIds: Set<string>           // Is thread generating?
threadsWorkingStatus: Map<string, Status>  // Thread working status
// These track the same thing differently

// Variant selection stored in two places
chatConfig.value.selectedVariantsMap      // In config
selectedVariantsMap.value                 // Separate ref
```

#### Complex Message Caching
```typescript
// External cache (messageRuntimeCache.ts)
getCachedMessage(id)
cacheMessage(message)

// Internal cache
generatingMessagesCache: Map<string, { message, threadId }>

// Array of IDs
messageIds: string[]

// Version bumping for reactivity
messageCacheVersion: number
```

This creates synchronization issues and makes it hard to reason about message state.

### 4. Event Handler Complexity

**Stream Event Handlers** (lines 869-1334):
- `handleStreamResponse`: 313 lines with deeply nested conditionals
- `handleStreamEnd`: 68 lines
- `handleStreamError`: 80 lines
- Mixed concerns: parsing, caching, UI updates, notifications

**IPC Event Listeners** (lines 1784-1875):
- Setup scattered at bottom of file
- Hard to see what events are handled
- Event handlers call store methods creating circular dependencies

### 5. Unclear Data Flow

```
IPC Event → handleStreamResponse → Update cache → Bump version → UI reacts
                ↓
         Play audio, send notifications, update variants
```

The flow is hard to trace because:
- Side effects everywhere
- Multiple caches to update
- Variant logic intertwined with main message logic

### 6. Testing Challenges
- Cannot test individual pieces in isolation
- Mock setup is complex (need entire store)
- Side effects make unit testing difficult

---

## 🎯 Proposed Solution: Composable Architecture

Split the monolithic store into focused composables following Vue 3 best practices.

### Why Composables Over Multiple Stores?

1. **Better Composition**: Composables can call each other naturally
2. **Easier Testing**: Each composable can be tested independently
3. **Clearer Dependencies**: Import only what you need
4. **Better Tree-Shaking**: Unused composables won't be bundled
5. **Vue 3 Idiomatic**: Aligns with Vue 3 Composition API patterns

---

## 🏗️ New Architecture

```
src/renderer/src/
├── stores/
│   └── chat.ts                          # Main orchestrator (~300 lines)
│
├── composables/
│   ├── chat/
│   │   ├── useThreadManagement.ts       # Thread CRUD, activation, forking
│   │   ├── useMessageCache.ts           # Unified message caching
│   │   ├── useMessageStreaming.ts       # Stream event handlers
│   │   ├── useVariantManagement.ts      # Variant selection logic
│   │   ├── useChatConfig.ts             # Config state and persistence
│   │   ├── useThreadExport.ts           # Export functionality
│   │   ├── useDeeplink.ts               # Deeplink handling
│   │   ├── useChatAudio.ts              # Sound effects
│   │   └── useChatEvents.ts             # IPC event coordination
│   │
│   └── shared/
│       └── usePresenterCache.ts         # Shared presenter caching pattern
│
└── lib/
    └── messageCache/
        ├── index.ts                     # Unified cache implementation
        ├── types.ts                     # Cache types
        └── utils.ts                     # Cache utilities
```

---

## 📦 Composable Breakdown

### 1. `useThreadManagement.ts` (~200 lines)

**Responsibilities**:
- Thread CRUD operations
- Thread activation/deactivation
- Thread forking
- Child thread creation
- Thread list management

**State**:
```typescript
const activeThreadId = ref<string | null>(null)
const threads = ref<GroupedThreads[]>([])
const childThreadsByMessageId = ref<Map<string, CONVERSATION[]>>(new Map())
```

**Key Methods**:
```typescript
createThread(title, settings)
setActiveThread(threadId)
clearActiveThread()
forkThread(messageId, forkTag)
createChildThreadFromSelection(payload)
openThreadInNewTab(threadId, options)
renameThread(threadId, title)
toggleThreadPinned(threadId, isPinned)
```

---

### 2. `useMessageCache.ts` (~250 lines)

**Responsibilities**:
- Unified message caching (replaces dual cache system)
- Message prefetching
- Cache invalidation
- DOM info tracking

**Unified Cache Design**:
```typescript
interface MessageCacheEntry {
  message: Message
  threadId: string
  isGenerating: boolean
  domInfo?: { top: number; height: number }
}

const messageCache = new Map<string, MessageCacheEntry>()
const messageCacheVersion = ref(0)
```

**Key Methods**:
```typescript
// Cache operations
getCachedMessage(messageId): Message | null
cacheMessage(message, threadId, isGenerating)
deleteCachedMessage(messageId)
clearCacheForThread(threadId)

// Message loading
getMessageIds(threadId): string[]
loadMessages(threadId): Promise<Message[]>
prefetchMessagesForRange(startIndex, endIndex)
ensureMessagesLoadedByIds(messageIds)

// DOM tracking
recordMessageDomInfo(entries)
getMessageDomInfo(messageId)
```

**Benefits**:
- Single source of truth for messages
- Simpler cache invalidation
- Easier to debug
- Better performance (no duplicate storage)

---

### 3. `useMessageStreaming.ts` (~300 lines)

**Responsibilities**:
- Handle streaming events from main process
- Update message content during streaming
- Manage streaming state

**State**:
```typescript
const generatingThreadIds = ref<Set<string>>(new Set())
const threadsWorkingStatus = ref<Map<string, WorkingStatus>>(new Map())
```

**Key Methods**:
```typescript
handleStreamResponse(msg)
handleStreamEnd(msg)
handleStreamError(msg)
updateThreadWorkingStatus(threadId, status)
getThreadWorkingStatus(threadId)
```

**Refactored Stream Handler**:
```typescript
// Break down the 313-line handleStreamResponse into smaller functions
handleStreamResponse(msg) {
  if (msg.stream_kind === 'init') {
    return handleStreamInit(msg)
  }

  const message = getStreamingMessage(msg.eventId)
  if (!message) return

  if (msg.tool_call) {
    handleToolCallUpdate(message, msg)
  } else if (msg.content) {
    handleContentUpdate(message, msg)
  } else if (msg.reasoning_content) {
    handleReasoningUpdate(message, msg)
  } else if (msg.image_data) {
    handleImageUpdate(message, msg)
  } else if (msg.rate_limit) {
    handleRateLimitUpdate(message, msg)
  }

  if (msg.totalUsage) {
    updateMessageUsage(message, msg.totalUsage)
  }

  cacheStreamingMessage(message)
}

// Each handler is 20-50 lines, easier to understand
function handleToolCallUpdate(message, msg) { ... }
function handleContentUpdate(message, msg) { ... }
```

---

### 4. `useVariantManagement.ts` (~150 lines)

**Responsibilities**:
- Variant selection and persistence
- Variant message resolution
- Retry/regenerate with variants

**State**:
```typescript
const selectedVariantsMap = ref<Record<string, string>>({})
```

**Key Methods**:
```typescript
updateSelectedVariant(mainMessageId, variantId)
clearSelectedVariantForMessage(mainMessageId)
resolveVariantMessage(message, selectedVariants)
retryMessage(messageId)
regenerateFromUserMessage(userMessageId)
```

**Simplified Logic**:
```typescript
// Current: variant logic scattered across multiple functions
// New: centralized variant management

const variantAwareMessages = computed(() => {
  return messageIds.value
    .map(id => getCachedMessage(id))
    .filter(Boolean)
    .map(msg => resolveVariantMessage(msg, selectedVariantsMap.value))
})
```

---

### 5. `useChatConfig.ts` (~150 lines)

**Responsibilities**:
- Chat configuration state
- Config persistence
- ACP workdir preferences
- Agent workspace preferences

**State**:
```typescript
const chatConfig = ref<CONVERSATION_SETTINGS>({ ... })
```

**Key Methods**:
```typescript
loadChatConfig()
saveChatConfig()
updateChatConfig(newConfig)
setAcpWorkdirPreference(agentId, workdir)
setAgentWorkspacePreference(workspacePath)
```

---

### 6. `useThreadExport.ts` (~100 lines)

**Responsibilities**:
- Export threads to various formats
- Nowledge-mem integration

**Key Methods**:
```typescript
exportThread(threadId, format)
submitToNowledgeMem(threadId)
testNowledgeMemConnection()
updateNowledgeMemConfig(config)
getNowledgeMemConfig()
```

---

### 7. `useDeeplink.ts` (~80 lines)

**Responsibilities**:
- Handle deeplink events
- Manage deeplink cache
- Context mention management

**State**:
```typescript
const deeplinkCache = ref<DeeplinkData | null>(null)
const pendingContextMentions = ref<Map<string, PendingContextMention>>(new Map())
const pendingScrollTargetByConversation = ref<Map<string, PendingScrollTarget>>(new Map())
```

**Key Methods**:
```typescript
handleDeeplinkStart(data)
clearDeeplinkCache()
setPendingContextMention(threadId, content, label)
consumeContextMention(threadId)
queueScrollTarget(conversationId, target)
consumePendingScrollMessage(conversationId)
```

---

### 8. `useChatAudio.ts` (~80 lines)

**Responsibilities**:
- Sound effect playback
- Audio initialization

**Key Methods**:
```typescript
initAudio()
playTypewriterSound()
playToolcallSound()
```

---

### 9. `useChatEvents.ts` (~200 lines)

**Responsibilities**:
- IPC event listener setup
- Event routing to appropriate composables
- Event cleanup

**Key Methods**:
```typescript
setupChatEventListeners()
cleanupChatEventListeners()
```

**Centralized Event Handling**:
```typescript
export function useChatEvents() {
  const threadMgmt = useThreadManagement()
  const streaming = useMessageStreaming()
  const config = useChatConfig()

  function setupChatEventListeners() {
    // Thread events
    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.LIST_UPDATED, (_, data) => {
      threadMgmt.handleThreadListUpdate(data)
    })

    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.ACTIVATED, (_, msg) => {
      threadMgmt.handleThreadActivated(msg)
    })

    // Stream events
    window.electron.ipcRenderer.on(STREAM_EVENTS.RESPONSE, (_, msg) => {
      streaming.handleStreamResponse(msg)
    })

    // ... other events
  }

  function cleanupChatEventListeners() {
    window.electron.ipcRenderer.removeAllListeners(CONVERSATION_EVENTS.LIST_UPDATED)
    // ... cleanup all listeners
  }

  return { setupChatEventListeners, cleanupChatEventListeners }
}
```

---

### 10. Main Store `chat.ts` (~300 lines)

**Responsibilities**:
- Orchestrate composables
- Provide unified API for components
- Maintain backward compatibility during migration

**Structure**:
```typescript
export const useChatStore = defineStore('chat', () => {
  // Initialize composables
  const threadMgmt = useThreadManagement()
  const messageCache = useMessageCache()
  const streaming = useMessageStreaming()
  const variants = useVariantManagement()
  const config = useChatConfig()
  const exports = useThreadExport()
  const deeplink = useDeeplink()
  const audio = useChatAudio()
  const events = useChatEvents()

  // Setup on mount
  onMounted(() => {
    audio.initAudio()
    events.setupChatEventListeners()
  })

  // Expose unified API
  return {
    // Thread management
    ...threadMgmt,

    // Message management
    ...messageCache,

    // Streaming
    ...streaming,

    // Variants
    ...variants,

    // Config
    ...config,

    // Exports
    ...exports,

    // Deeplink
    ...deeplink,

    // Computed properties that combine multiple composables
    messageItems: computed(() => {
      const ids = messageCache.getMessageIds()
      return ids.map(id => ({
        id,
        message: variants.resolveVariantMessage(
          messageCache.getCachedMessage(id),
          variants.selectedVariantsMap.value
        )
      }))
    })
  }
})
```

---

## 🔄 Migration Strategy

### Phase 1: Preparation (Week 1)
1. Create new directory structure
2. Set up composable templates
3. Write unit tests for critical paths
4. Document current behavior

### Phase 2: Extract Pure Logic (Week 2)
Start with composables that have minimal dependencies:

1. **useChatAudio.ts** - No dependencies, easy to extract
2. **useThreadExport.ts** - Only depends on presenters
3. **useDeeplink.ts** - Minimal state, clear boundaries

**Testing**: Verify each extracted composable works independently

### Phase 3: Extract Core State (Week 3)
Extract state management composables:

4. **useChatConfig.ts** - Config state and persistence
5. **useThreadManagement.ts** - Thread operations
6. **useMessageCache.ts** - Unified caching (most complex)

**Testing**: Integration tests for cache operations

### Phase 4: Extract Event Handlers (Week 4)
7. **useMessageStreaming.ts** - Stream event handlers
8. **useVariantManagement.ts** - Variant logic
9. **useChatEvents.ts** - IPC event coordination

**Testing**: End-to-end tests for streaming and variants

### Phase 5: Integration (Week 5)
10. Update main `chat.ts` to orchestrate composables
11. Update components to use new API
12. Remove old code
13. Update documentation

### Phase 6: Cleanup & Optimization (Week 6)
14. Remove deprecated code
15. Optimize performance
16. Final testing
17. Code review

---

## 🧪 Testing Strategy

### Unit Tests
Each composable should have unit tests:

```typescript
// useMessageCache.test.ts
describe('useMessageCache', () => {
  it('should cache message correctly', () => {
    const { cacheMessage, getCachedMessage } = useMessageCache()
    const message = createMockMessage()

    cacheMessage(message, 'thread-1', false)

    expect(getCachedMessage(message.id)).toEqual(message)
  })

  it('should clear cache for thread', () => {
    const { cacheMessage, clearCacheForThread, getCachedMessage } = useMessageCache()
    const message = createMockMessage()

    cacheMessage(message, 'thread-1', false)
    clearCacheForThread('thread-1')

    expect(getCachedMessage(message.id)).toBeNull()
  })
})
```

### Integration Tests
Test composables working together:

```typescript
// chat-integration.test.ts
describe('Chat Integration', () => {
  it('should handle message streaming end-to-end', async () => {
    const store = useChatStore()

    await store.createThread('Test', {})
    await store.sendMessage({ text: 'Hello' })

    // Simulate stream events
    store.handleStreamResponse({ eventId: 'msg-1', content: 'Hi' })
    store.handleStreamEnd({ eventId: 'msg-1' })

    const messages = store.getCurrentThreadMessages()
    expect(messages).toHaveLength(2)
  })
})
```

### E2E Tests
Test full user flows in the actual app.

---

## 📊 Success Metrics

### Code Quality
- ✅ No file over 400 lines
- ✅ Each composable has single responsibility
- ✅ Test coverage > 80%
- ✅ No circular dependencies

### Performance
- ✅ No performance regression
- ✅ Bundle size reduction (tree-shaking)
- ✅ Faster IDE performance

### Developer Experience
- ✅ Easier to locate functionality
- ✅ Faster onboarding for new developers
- ✅ Reduced merge conflicts
- ✅ Easier to add new features

---

## 🚨 Risks & Mitigations

### Risk 1: Breaking Changes
**Mitigation**:
- Maintain backward compatibility in main store
- Gradual migration with feature flags
- Comprehensive testing

### Risk 2: Performance Regression
**Mitigation**:
- Benchmark before/after
- Profile during development
- Optimize hot paths

### Risk 3: Increased Complexity
**Mitigation**:
- Clear documentation
- Consistent patterns across composables
- Code review process

### Risk 4: Timeline Overrun
**Mitigation**:
- Incremental delivery (can stop after any phase)
- Each phase delivers value
- Regular progress reviews

---

## 📝 Implementation Checklist

### Phase 1: Preparation
- [ ] Create directory structure
- [ ] Set up test infrastructure
- [ ] Document current behavior
- [ ] Create migration guide

### Phase 2: Extract Pure Logic
- [ ] Extract `useChatAudio.ts`
- [ ] Extract `useThreadExport.ts`
- [ ] Extract `useDeeplink.ts`
- [ ] Write unit tests for each

### Phase 3: Extract Core State
- [ ] Extract `useChatConfig.ts`
- [ ] Extract `useThreadManagement.ts`
- [ ] Extract `useMessageCache.ts` (unified cache)
- [ ] Write integration tests

### Phase 4: Extract Event Handlers
- [ ] Extract `useMessageStreaming.ts`
- [ ] Extract `useVariantManagement.ts`
- [ ] Extract `useChatEvents.ts`
- [ ] Write E2E tests

### Phase 5: Integration
- [ ] Update main `chat.ts`
- [ ] Update components
- [ ] Remove old code
- [ ] Update documentation

### Phase 6: Cleanup
- [ ] Remove deprecated code
- [ ] Optimize performance
- [ ] Final testing
- [ ] Code review and merge

---

## 🔗 Related Documents

- [ARCHITECTURE.md](../ARCHITECTURE.md) - Overall system architecture
- [renderer-page-structure.md](../renderer-page-structure.md) - Renderer structure
- [FLOWS.md](../FLOWS.md) - Data flow documentation

---

## 📅 Timeline

**Total Estimated Time**: 6 weeks

- Week 1: Preparation
- Week 2: Extract Pure Logic
- Week 3: Extract Core State
- Week 4: Extract Event Handlers
- Week 5: Integration
- Week 6: Cleanup & Optimization

**Note**: Timeline assumes 1 developer working part-time. Can be accelerated with multiple developers or full-time focus.

---

## 💡 Future Improvements

After refactoring, consider:

1. **State Machine for Thread Status**: Use XState for thread lifecycle
2. **Virtual Scrolling**: Optimize message list rendering
3. **Web Workers**: Move heavy processing off main thread
4. **IndexedDB**: Client-side message caching for offline support
5. **Optimistic Updates**: Improve perceived performance

---

## ✅ Approval

- [ ] Technical Lead Review
- [ ] Architecture Review
- [ ] Team Discussion
- [ ] Timeline Approval
- [ ] Ready to Implement

---

**Document Version**: 1.0
**Last Updated**: 2026-01-19
**Author**: Claude Code
**Reviewers**: TBD
