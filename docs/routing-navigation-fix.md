# Routing and Navigation Fix Design

## Current Issues

### Issue 1: IconSidebar Navigation Failure
**Symptom**: Clicking on an IconItem in the sidebar does not navigate to the conversation.

**Root Cause**:
- `IconSidebar` emits `conversation-select` event → `App.vue` calls `sidebarStore.openConversation()`
- `sidebarStore.openConversation()` calls `router.push(\`/conversation/${threadId}\`)`
- `ChatTabView` watches `route.params.id` and calls `chatStore.setActiveThread(threadId)`
- However, `chatStore.setActiveThread()` calls `threadP.setActiveConversation()` which is async
- The main process sends `CONVERSATION_EVENTS.ACTIVATED` event back to renderer
- But the route change happens BEFORE the conversation is properly loaded
- Result: Navigation occurs but conversation doesn't load properly

**Code Flow**:
```
IconSidebar click
  → App.vue handleSidebarConversationSelect()
    → sidebarStore.openConversation(threadId)
      → router.push(`/conversation/${threadId}`)
        → ChatTabView route watcher
          → chatStore.setActiveThread(threadId)
            → threadP.setActiveConversation() [async, waits for main process]
              → [ACTIVATED event arrives later]
```

### Issue 2: NewThread Conversation Creation Navigation Failure
**Symptom**: Creating a new conversation in NewThread doesn't navigate to the conversation view, and the conversation doesn't appear in the sidebar.

**Root Cause**:
- `NewThread.handleSend()` calls `chatStore.createThread()` which:
  - Creates the thread via `threadP.createConversation()`
  - Sets `activeThreadId` locally
  - Returns the threadId
- But it does NOT:
  - Navigate to `/conversation/${threadId}` route
  - Add the conversation to `sidebarStore`
- The main process sends `CONVERSATION_EVENTS.ACTIVATED` event
- But since there's no route change, the UI stays on `/home`
- The conversation exists but is not visible

**Code Flow**:
```
NewThread handleSend()
  → chatStore.createThread()
    → threadP.createConversation()
      → setActiveThreadId(threadId) [local only]
      → [ACTIVATED event arrives]
  → chatStore.sendMessage()
  [NO NAVIGATION OCCURS]
  [NO SIDEBAR UPDATE]
```

### Issue 3: goHome() Navigation Failure
**Symptom**: Clicking the home button in the sidebar doesn't navigate to the home view.

**Root Cause**:
- `sidebarStore.goHome()` only calls `chatStore.setActiveThreadId(null)`
- It does NOT call `router.push('/home')`
- Result: The active thread is cleared but the route doesn't change

### Issue 4: Dual State Management
**Symptom**: Conversations are managed in two places without proper synchronization.

**Root Cause**:
- `chatStore` manages the active conversation and message state
- `sidebarStore` manages the list of open conversations (tabs)
- These two stores don't synchronize:
  - Creating a conversation in `chatStore` doesn't update `sidebarStore`
  - Opening a conversation in `sidebarStore` doesn't properly coordinate with `chatStore`
  - No single source of truth for which conversations are "open"

## Architecture Analysis

### Current Architecture (Single WebContents)

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Process                              │
│  - SessionPresenter: manages conversations                   │
│  - Sends CONVERSATION_EVENTS.ACTIVATED                       │
│  - Sends CONVERSATION_EVENTS.LIST_UPDATED                    │
└───────────────┬─────────────────────────────────────────────┘
                │ IPC Events
┌───────────────▼─────────────────────────────────────────────┐
│                    Renderer Process                          │
│                                                              │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │  chatStore   │         │ sidebarStore │                 │
│  │              │         │              │                 │
│  │ - activeThreadId      │ - conversations (Map)           │
│  │ - threads    │         │ - tabOrder   │                 │
│  │ - messages   │         │              │                 │
│  └──────────────┘         └──────────────┘                 │
│         │                        │                          │
│         │                        │                          │
│  ┌──────▼────────────────────────▼──────┐                  │
│  │         Vue Router                   │                  │
│  │  /home                               │                  │
│  │  /conversation/:id                   │                  │
│  └──────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

### Problems with Current Architecture

1. **No coordination between stores**: `chatStore` and `sidebarStore` operate independently
2. **Route changes don't trigger proper state updates**: Navigation happens before async operations complete
3. **Missing sidebar updates**: Creating conversations doesn't add them to sidebar
4. **Incomplete navigation**: Some actions update state but don't navigate

## Proposed Solution

### Design Principles

1. **Single Source of Truth**: Main process (SessionPresenter) is the source of truth for conversation state
2. **Event-Driven Updates**: Renderer stores react to main process events, not direct calls
3. **Router as Navigation Controller**: All navigation goes through Vue Router
4. **Store Synchronization**: Sidebar and chat stores synchronize via shared events

### Solution Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Process                              │
│  - SessionPresenter: manages conversations                   │
│  - Sends CONVERSATION_EVENTS.ACTIVATED                       │
│  - Sends CONVERSATION_EVENTS.LIST_UPDATED                    │
└───────────────┬─────────────────────────────────────────────┘
                │ IPC Events
┌───────────────▼─────────────────────────────────────────────┐
│                    Renderer Process                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐
│  │  Event Coordination Layer (NEW)                         │
│  │  - Listens to ACTIVATED events                          │
│  │  - Coordinates router + stores                          │
│  └──────────────────────────────────────────────────────────┘
│         │                        │                          │
│  ┌──────▼──────┐         ┌──────▼──────┐                   │
│  │  chatStore  │◄────────┤ sidebarStore│                   │
│  │             │  sync   │             │                   │
│  │ - activeThreadId     │ - conversations                  │
│  │ - threads   │         │ - tabOrder  │                   │
│  │ - messages  │         │             │                   │
│  └─────────────┘         └─────────────┘                   │
│         │                        │                          │
│  ┌──────▼────────────────────────▼──────┐                  │
│  │         Vue Router                   │                  │
│  │  /home                               │                  │
│  │  /conversation/:id                   │                  │
│  └──────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

### Key Changes

#### 1. Unified Navigation Flow

**Principle**: All conversation navigation goes through a single coordination point.

**Implementation**:
- Create a `useConversationNavigation` composable that coordinates:
  - Router navigation
  - Store updates
  - Sidebar synchronization
- All components use this composable instead of directly calling stores

#### 2. Sidebar Synchronization

**Principle**: Sidebar automatically reflects all active conversations.

**Implementation**:
- `sidebarStore` listens to `CONVERSATION_EVENTS.ACTIVATED`
- When a conversation is activated, automatically add it to sidebar if not present
- When navigating to `/home`, clear active conversation but keep sidebar tabs

#### 3. Route-Driven State

**Principle**: Route changes drive state updates, not the other way around.

**Implementation**:
- Navigation always happens via `router.push()`
- Route watchers trigger state updates
- Async operations complete before navigation

#### 4. Event Coordination

**Principle**: Main process events are the source of truth.

**Implementation**:
- Wait for `ACTIVATED` event before considering navigation complete
- Use event coordination to ensure stores are in sync
- Handle race conditions between route changes and IPC events

## Implementation Plan

### Phase 1: Create Navigation Composable

**File**: `src/renderer/src/composables/useConversationNavigation.ts`

```typescript
export function useConversationNavigation() {
  const router = useRouter()
  const chatStore = useChatStore()
  const sidebarStore = useSidebarStore()

  /**
   * Navigate to a conversation
   * Coordinates: router, chatStore, sidebarStore
   */
  async function navigateToConversation(threadId: string, title?: string) {
    // 1. Add to sidebar if not present
    if (!sidebarStore.conversations.has(threadId)) {
      sidebarStore.conversations.set(threadId, {
        id: threadId,
        title: title || 'Loading...'
      })
      sidebarStore.tabOrder.push(threadId)
    }

    // 2. Navigate to route (this triggers ChatTabView watcher)
    await router.push(`/conversation/${threadId}`)

    // 3. ChatTabView watcher will call chatStore.setActiveThread()
    // 4. Main process will send ACTIVATED event
    // 5. Stores will update when event arrives
  }

  /**
   * Navigate to home (new conversation)
   */
  async function navigateToHome() {
    await router.push('/home')
    // ChatTabView will clear active thread
  }

  /**
   * Create a new conversation and navigate to it
   */
  async function createAndNavigateToConversation(
    title: string,
    settings: Partial<CONVERSATION_SETTINGS>
  ) {
    // 1. Create the conversation
    const threadId = await chatStore.createThread(title, settings)

    // 2. Navigate to it
    await navigateToConversation(threadId, title)

    return threadId
  }

  return {
    navigateToConversation,
    navigateToHome,
    createAndNavigateToConversation
  }
}
```

### Phase 2: Update sidebarStore

**Changes to `src/renderer/src/stores/sidebarStore.ts`**:

1. **Remove direct router calls from `openConversation`**:
```typescript
async function openConversation(threadId: string, title?: string): Promise<void> {
  // Only update sidebar state, don't navigate
  if (!conversations.value.has(threadId)) {
    conversations.value.set(threadId, {
      id: threadId,
      title: title || 'New Conversation'
    })
    tabOrder.value.push(threadId)
  }
  persistState()
  // Navigation will be handled by caller using useConversationNavigation
}
```

2. **Add automatic sync on ACTIVATED event**:
```typescript
// In setup or onMounted
window.electron.ipcRenderer.on(CONVERSATION_EVENTS.ACTIVATED, (_, msg) => {
  const threadId = msg.conversationId

  // Auto-add to sidebar if not present
  if (!conversations.value.has(threadId)) {
    conversations.value.set(threadId, {
      id: threadId,
      title: 'Loading...'
    })
    tabOrder.value.push(threadId)
    persistState()
  }

  // Refresh metadata
  refreshConversationMeta(threadId)
})
```

3. **Update `goHome` to navigate**:
```typescript
function goHome(): void {
  router.push('/home')
  // Route change will trigger ChatTabView to clear active thread
}
```

### Phase 3: Update App.vue

**Changes to `src/renderer/src/App.vue`**:

```typescript
import { useConversationNavigation } from '@/composables/useConversationNavigation'

const { navigateToConversation, navigateToHome } = useConversationNavigation()

// Update handlers
const handleSidebarConversationSelect = (conversationId: string) => {
  navigateToConversation(conversationId)
}

const handleSidebarHome = () => {
  navigateToHome()
}
```

### Phase 4: Update NewThread

**Changes to `src/renderer/src/components/NewThread.vue`**:

```typescript
import { useConversationNavigation } from '@/composables/useConversationNavigation'

const { createAndNavigateToConversation } = useConversationNavigation()

const handleSend = async (messageContent: UserMessageContent) => {
  if (!messageContent.text.trim()) return

  try {
    // Create conversation and navigate
    const threadId = await createAndNavigateToConversation(
      messageContent.text,
      {
        providerId: selectedModelInfo.value?.providerId,
        modelId: selectedModelInfo.value?.id
      } as any
    )

    if (threadId) {
      // Send message (conversation is now active)
      await chatStore.sendMessage(messageContent)

      // Clear input
      chatInputRef.value?.clearContent()
    }
  } catch (error) {
    console.error('Failed to send message:', error)
  }
}

const handleAcpStart = async (config: {
  agentId: string
  workdir: string
  modelId?: string
  modeId?: string
}) => {
  try {
    // Create ACP conversation and navigate
    const threadId = await createAndNavigateToConversation(
      'New ACP Session',
      {
        providerId: 'acp',
        modelId: config.agentId,
        chatMode: 'acp agent',
        acpWorkdirMap: {
          [config.agentId]: config.workdir
        }
      } as any
    )

    if (threadId) {
      await workspaceStore.refreshFileTree()

      // Update ChatInput model selection
      selectedModelInfo.value = {
        id: config.agentId,
        providerId: 'acp'
      }
    }
  } catch (error) {
    console.error('Failed to start ACP session:', error)
  }

  showAgentConfigDialog.value = false
}
```

### Phase 5: Update ChatTabView Route Watcher

**Changes to `src/renderer/src/views/ChatTabView.vue`**:

```typescript
// Watch route changes to load conversations
watch(
  () => route.params.id,
  async (newId) => {
    if (route.name === 'conversation' && newId) {
      // Load the conversation specified in the route
      await chatStore.setActiveThread(newId as string)
    } else if (route.name === 'home' || !newId) {
      // Clear active thread for home view
      if (chatStore.getActiveThreadId()) {
        await chatStore.clearActiveThread()
      }
    }
  },
  { immediate: true }
)
```

### Phase 6: Update Router Configuration

**Changes to `src/renderer/src/router/index.ts`**:

Ensure routes are properly configured:
```typescript
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/conversation/:id',
      name: 'conversation',
      component: () => import('@/views/ChatTabView.vue'),
      meta: {
        titleKey: 'routes.conversation',
        icon: 'lucide:message-square'
      }
    },
    {
      path: '/home',
      name: 'home',
      component: () => import('@/views/HomeTabView.vue'),
      meta: {
        titleKey: 'routes.home',
        icon: 'lucide:house'
      }
    },
    {
      path: '/',
      redirect: '/home'
    },
    // ... other routes
  ]
})
```

## Testing Plan

### Test Case 1: Sidebar Navigation
1. Open app with existing conversations in sidebar
2. Click on a conversation icon
3. **Expected**: Navigate to conversation, load messages, highlight active icon

### Test Case 2: New Conversation from Home
1. Navigate to home view
2. Enter message and send
3. **Expected**: Create conversation, navigate to it, send message, appear in sidebar

### Test Case 3: ACP Agent Start
1. Navigate to home view
2. Click ACP agent card
3. Configure and start
4. **Expected**: Create ACP conversation, navigate to it, appear in sidebar with agent icon

### Test Case 4: Home Button
1. Be in an active conversation
2. Click home button in sidebar
3. **Expected**: Navigate to home view, clear active conversation, keep sidebar tabs

### Test Case 5: Multiple Conversations
1. Create conversation A
2. Navigate to home
3. Create conversation B
4. Click on conversation A in sidebar
5. **Expected**: Both conversations in sidebar, can switch between them

### Test Case 6: Conversation Persistence
1. Create multiple conversations
2. Close and reopen app
3. **Expected**: Sidebar shows all conversations, can navigate to each

## Migration Notes

### Breaking Changes
- `sidebarStore.openConversation()` no longer navigates directly
- Components must use `useConversationNavigation` composable
- `goHome()` now triggers navigation

### Backward Compatibility
- Main process IPC events remain unchanged
- Store state structures remain unchanged
- Only coordination logic changes

## Open Questions

1. **Should we auto-close conversations from sidebar?**
   - Current: Conversations stay in sidebar until manually closed
   - Alternative: Auto-close when navigating to home?
   - **Recommendation**: Keep current behavior, let users manage tabs

2. **Should we limit number of open conversations?**
   - Current: Unlimited
   - Alternative: Limit to N conversations, close oldest
   - **Recommendation**: Add optional limit in settings (default: unlimited)

3. **Should we persist conversation order across restarts?**
   - Current: Yes, via `sidebarState.openConversationIds`
   - **Recommendation**: Keep current behavior

4. **How to handle conversation deletion?**
   - Current: Not fully implemented
   - **Recommendation**: Remove from sidebar, navigate to adjacent or home

## Summary

This design fixes the routing and navigation issues by:

1. **Creating a unified navigation composable** that coordinates router, chatStore, and sidebarStore
2. **Synchronizing sidebar automatically** when conversations are activated
3. **Making routes the source of truth** for navigation state
4. **Coordinating async operations** properly with route changes

The solution maintains the Single WebContents Architecture pattern and ensures proper synchronization between all components.
