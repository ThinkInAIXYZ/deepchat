# State Management Specifications

**Status**: Draft
**Created**: 2026-01-16
**Related**: [spec.md](./spec.md), [components.md](./components.md)

---

## Overview

This document specifies state management changes required for the Single WebContents Architecture. The key change is **removing Tab-aware state patterns** and replacing them with **Router-based conversation management**.

**Existing Code Reference**: `src/renderer/src/stores/chat.ts`

---

## 1. Current State Analysis

### 1.1 Existing Tab-Aware State (chat.ts)

```typescript
// Current: All state keyed by tabId (webContentsId)
activeThreadIdMap: Map<tabId, threadId>           // Line 74
messageIdsMap: Map<tabId, string[]>               // Line 81
threadsWorkingStatusMap: Map<tabId, Map<...>>     // Line 91
generatingMessagesCacheMap: Map<tabId, Map<...>>  // Line 94-96

// Current: Tab identification
const getTabId = () => window.api.getWebContentsId()  // Line 135
const getActiveThreadId = () => activeThreadIdMap.value.get(getTabId())  // Line 136
```

### 1.2 Why This Needs to Change

In the current multi-WebContentsView architecture:
- Each tab is a separate WebContents with its own renderer process
- State must be keyed by `tabId` to isolate conversations
- `getTabId()` returns the WebContents ID for the current tab

In the new single-WebContents architecture:
- All conversations share one WebContents
- No need for `tabId` isolation
- Active conversation determined by Vue Router route params

---

## 2. New State Structure

### 2.1 SidebarStore (New)

**Location**: `src/renderer/src/stores/sidebarStore.ts`

**Purpose**: Manage open conversations list for the vertical sidebar.

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { useRouter } from 'vue-router'
import type { CONVERSATION } from '@shared/presenter'

export interface ConversationMeta {
  id: string
  title: string
  lastMessageAt: Date
  isLoading: boolean
  hasError: boolean
  modelIcon?: string
}

export const useSidebarStore = defineStore('sidebar', () => {
  const sessionP = usePresenter('sessionPresenter')
  const configP = usePresenter('configPresenter')
  const router = useRouter()

  // State
  const openConversations = ref<Map<string, ConversationMeta>>(new Map())
  const tabOrder = ref<string[]>([])
  const width = ref(240)
  const collapsed = ref(false)

  // Getters
  const sortedConversations = computed(() => {
    return tabOrder.value
      .map(id => openConversations.value.get(id))
      .filter((c): c is ConversationMeta => c !== undefined)
  })

  const conversationCount = computed(() => openConversations.value.size)

  // Actions defined below...
  return {
    openConversations,
    tabOrder,
    width,
    collapsed,
    sortedConversations,
    conversationCount,
    // ... actions
  }
})
```

### 2.2 SidebarStore Actions

```typescript
// Actions for SidebarStore

/**
 * Open a conversation (add to sidebar and navigate)
 */
async function openConversation(threadId: string): Promise<void> {
  // 1. Check if already open
  if (!openConversations.value.has(threadId)) {
    // 2. Load metadata from presenter
    const meta = await sessionP.getConversation(threadId)
    if (!meta) {
      console.error(`Conversation ${threadId} not found`)
      return
    }

    // 3. Add to open list
    openConversations.value.set(threadId, {
      id: threadId,
      title: meta.title || 'New Conversation',
      lastMessageAt: new Date(meta.updatedAt),
      isLoading: false,
      hasError: false,
      modelIcon: meta.modelId
    })
    tabOrder.value.push(threadId)
  }

  // 4. Navigate via router
  router.push(`/conversation/${threadId}`)

  // 5. Persist state
  await persistState()
}

/**
 * Close a conversation (remove from sidebar)
 */
async function closeConversation(threadId: string): Promise<void> {
  // 1. Remove from maps
  openConversations.value.delete(threadId)
  tabOrder.value = tabOrder.value.filter(id => id !== threadId)

  // 2. If closing active conversation, navigate to adjacent
  const currentRoute = router.currentRoute.value
  if (currentRoute.params.id === threadId) {
    const nextId = findAdjacentConversation(threadId)
    if (nextId) {
      router.push(`/conversation/${nextId}`)
    } else {
      router.push('/new')
    }
  }

  // 3. Persist state
  await persistState()
}

/**
 * Create new conversation
 */
async function createConversation(): Promise<string> {
  // 1. Create via presenter
  const newThread = await sessionP.createConversation()

  // 2. Add to open list
  openConversations.value.set(newThread.id, {
    id: newThread.id,
    title: newThread.title || 'New Conversation',
    lastMessageAt: new Date(),
    isLoading: false,
    hasError: false
  })
  tabOrder.value.push(newThread.id)

  // 3. Navigate
  router.push(`/conversation/${newThread.id}`)

  // 4. Persist
  await persistState()

  return newThread.id
}

/**
 * Reorder conversations (drag-and-drop)
 */
function reorderConversations(fromIndex: number, toIndex: number): void {
  const item = tabOrder.value.splice(fromIndex, 1)[0]
  tabOrder.value.splice(toIndex, 0, item)
  persistState()
}

/**
 * Find adjacent conversation for navigation after close
 */
function findAdjacentConversation(closedId: string): string | null {
  const idx = tabOrder.value.indexOf(closedId)
  if (idx === -1) return tabOrder.value[0] || null

  // Prefer next, fallback to previous
  if (idx < tabOrder.value.length - 1) {
    return tabOrder.value[idx + 1]
  } else if (idx > 0) {
    return tabOrder.value[idx - 1]
  }
  return null
}

### 2.3 Persistence Strategy

```typescript
/**
 * Persist sidebar state to ConfigPresenter
 */
async function persistState(): Promise<void> {
  const state = {
    openConversationIds: tabOrder.value,
    lastActiveConversationId: router.currentRoute.value.params.id,
    ui: {
      width: width.value,
      collapsed: collapsed.value
    }
  }

  // Debounced write to ConfigPresenter
  await configP.setSetting('chatWindow.sidebarState', state)
}

/**
 * Restore sidebar state on window creation
 */
async function restoreState(): Promise<void> {
  const state = await configP.getSetting('chatWindow.sidebarState')
  if (!state) return

  // Restore UI state
  width.value = state.ui?.width ?? 240
  collapsed.value = state.ui?.collapsed ?? false

  // Restore open conversations
  for (const id of state.openConversationIds || []) {
    try {
      const meta = await sessionP.getConversation(id)
      if (meta) {
        openConversations.value.set(id, {
          id,
          title: meta.title,
          lastMessageAt: new Date(meta.updatedAt),
          isLoading: false,
          hasError: false
        })
      }
    } catch (e) {
      console.warn(`Failed to restore conversation ${id}:`, e)
      // Skip invalid conversations
    }
  }

  // Restore tab order (filter out invalid IDs)
  tabOrder.value = (state.openConversationIds || [])
    .filter(id => openConversations.value.has(id))

  // Navigate to last active or first conversation
  const targetId = state.lastActiveConversationId || tabOrder.value[0]
  if (targetId && openConversations.value.has(targetId)) {
    router.push(`/conversation/${targetId}`)
  } else {
    router.push('/new')
  }
}
```

---

## 3. ChatStore Modifications

### 3.1 State Changes Summary

| Current State | New State | Change |
|---------------|-----------|--------|
| `activeThreadIdMap: Map<tabId, threadId>` | Removed | Use `useRoute().params.id` |
| `messageIdsMap: Map<tabId, string[]>` | `messageIds: string[]` | Remove tabId key |
| `threadsWorkingStatusMap: Map<tabId, Map<...>>` | `workingStatusMap: Map<threadId, WorkingStatus>` | Remove tabId layer |
| `generatingMessagesCacheMap: Map<tabId, Map<...>>` | `generatingMessagesCache: Map<messageId, ...>` | Remove tabId layer |
| `getTabId()` | Removed | No longer needed |
| `getActiveThreadId()` | `useRoute().params.id` | From router |

### 3.2 Modified Getters

```typescript
// BEFORE: Tab-aware getters
const getTabId = () => window.api.getWebContentsId()
const getActiveThreadId = () => activeThreadIdMap.value.get(getTabId()) ?? null
const getMessageIds = () => messageIdsMap.value.get(getTabId()) ?? []

// AFTER: Router-based getters
const route = useRoute()
const getActiveThreadId = () => route.params.id as string | undefined
const messageIds = ref<string[]>([])
const getMessageIds = () => messageIds.value
```

### 3.3 Modified Actions

```typescript
// BEFORE: setActiveThread with tabId
const setActiveThreadId = (threadId: string | null) => {
  activeThreadIdMap.value.set(getTabId(), threadId)
}

// AFTER: Navigation via router (handled by SidebarStore)
// ChatStore no longer manages active thread - it's derived from route
```

### 3.4 Preserved Functionality

These parts of chat.ts remain **unchanged**:

- `threads` - Historical conversations list
- `chatConfig` - Conversation settings
- `selectedVariantsMap` - Message variant selections
- `generatingThreadIds` - Set of generating threads
- `childThreadsByMessageId` - Branch threads
- Message caching functions (`cacheMessage`, `getCachedMessage`, etc.)
- Stream event handlers (`handleStreamResponse`, etc.)
- Presenter integrations (`sessionPresenter`, `agentPresenter`)

---

## 4. Vue Router Integration

### 4.1 Route Configuration

**Location**: `src/renderer/src/router/index.ts`

```typescript
import { createRouter, createWebHashHistory } from 'vue-router'
import ChatView from '@/views/ChatView.vue'

const routes = [
  {
    path: '/',
    redirect: '/new'
  },
  {
    path: '/new',
    name: 'new-conversation',
    component: ChatView,
    meta: { title: 'New Conversation' }
  },
  {
    path: '/conversation/:id',
    name: 'conversation',
    component: ChatView,
    meta: { title: 'Conversation' }
  },
  {
    // Catch-all redirect
    path: '/:pathMatch(.*)*',
    redirect: '/new'
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
```

### 4.2 Navigation Guards

```typescript
// In router/index.ts

router.beforeEach(async (to, from, next) => {
  const sidebarStore = useSidebarStore()

  // If navigating to a conversation
  if (to.name === 'conversation' && to.params.id) {
    const conversationId = to.params.id as string

    // Ensure conversation is in open list
    if (!sidebarStore.openConversations.has(conversationId)) {
      try {
        // Load and add to open list
        await sidebarStore.openConversation(conversationId)
      } catch (e) {
        console.error('Failed to load conversation:', e)
        // Redirect to /new on error
        return next('/new')
      }
    }
  }

  next()
})

router.afterEach((to) => {
  // Update document title
  const title = to.meta.title || 'DeepChat'
  document.title = title as string
})
```

### 4.3 Browser Navigation Handling

```typescript
// Disable browser back/forward for conversation switching
// Conversations are workspace tabs, not browser history

router.beforeEach((to, from, next) => {
  // Check if this is a browser back/forward navigation
  const isPopState = window.history.state?.position !== undefined

  if (isPopState && to.name === 'conversation' && from.name === 'conversation') {
    // Prevent browser navigation between conversations
    // User should use sidebar to switch
    return next(false)
  }

  next()
})
```

---

## 5. Data Flow Diagrams

### 5.1 Conversation Selection Flow

```
User clicks conversation in VerticalSidebar
  │
  ▼
VerticalSidebar emits 'conversation-select'
  │
  ▼
App.vue handler: router.push(`/conversation/${id}`)
  │
  ▼
Vue Router beforeEach guard
  │
  ├─ Check if conversation in sidebarStore.openConversations
  │   │
  │   ├─ Yes: Allow navigation
  │   │
  │   └─ No: Load via sidebarStore.openConversation()
  │
  ▼
ChatView receives new route.params.id
  │
  ▼
ChatView watcher triggers loadConversation()
  │
  ▼
Messages loaded and displayed
```

### 5.2 Conversation Close Flow

```
User clicks close button on ConversationTab
  │
  ▼
ConversationTab emits 'close'
  │
  ▼
VerticalSidebar emits 'conversation-close'
  │
  ▼
App.vue handler: sidebarStore.closeConversation(id)
  │
  ├─ Remove from openConversations Map
  ├─ Remove from tabOrder array
  │
  ├─ If closing active conversation:
  │   │
  │   ▼
  │   Find adjacent conversation
  │   │
  │   ├─ Found: router.push(`/conversation/${adjacentId}`)
  │   │
  │   └─ Not found: router.push('/new')
  │
  ▼
Persist state to ConfigPresenter
```

---

## References

- Existing `chat.ts`: `src/renderer/src/stores/chat.ts`
- Existing router: `src/renderer/src/router/index.ts`
- Vue Router docs: https://router.vuejs.org/
- Pinia docs: https://pinia.vuejs.org/
