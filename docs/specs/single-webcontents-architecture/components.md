# Component Specifications

**Status**: Draft
**Created**: 2026-01-16
**Related**: [spec.md](./spec.md)

---

## Overview

This document provides detailed component specifications for the Single WebContents Architecture migration. All specifications are based on analysis of the existing codebase patterns.

**Key Principle**: Reuse existing patterns from `src/renderer/shell/components/AppBar.vue` and adapt them for vertical layout.

---

## 1. VerticalSidebar Component

### 1.1 Component Overview

**Purpose**: Vertical sidebar for managing open conversation tabs in chat windows. Replaces the horizontal tab bar (`AppBar.vue`) with a more space-efficient vertical layout.

**Location**: `src/renderer/src/components/VerticalSidebar.vue`

**Parent Component**: `App.vue` (Chat window root)

**Reuse Points from Existing Code**:
- Drag-and-drop logic from `AppBar.vue` (lines 44-46, 56-57)
- Overflow detection and scrolling patterns
- Tooltip patterns via `onOverlayMouseEnter/Leave`
- Window control button patterns

### 1.2 Props Definition

```typescript
interface VerticalSidebarProps {
  /**
   * List of open conversations to display as tabs
   * Source: sidebarStore.sortedConversations
   */
  conversations: ConversationMeta[]

  /**
   * ID of currently active conversation
   * Source: useRoute().params.id
   */
  activeConversationId?: string

  /**
   * Sidebar width in pixels
   * @default 240
   * @min 180
   * @max 400
   */
  width?: number

  /**
   * Whether sidebar is collapsed (icon-only mode)
   * @default false
   */
  collapsed?: boolean

  /**
   * Whether to show close buttons on tabs
   * @default true
   */
  showCloseButtons?: boolean

  /**
   * Whether drag-and-drop reordering is enabled
   * @default false (Phase 2 feature)
   */
  enableReordering?: boolean
}

/**
 * Metadata for a single conversation tab
 * Based on existing CONVERSATION type from @shared/presenter
 */
interface ConversationMeta {
  id: string
  title: string
  lastMessageAt: Date
  isLoading?: boolean
  hasError?: boolean
  modelIcon?: string
}
```

### 1.3 Events Definition

```typescript
interface VerticalSidebarEvents {
  /**
   * Emitted when user selects a conversation tab
   * Handler: router.push(`/conversation/${id}`)
   */
  'conversation-select': (conversationId: string) => void

  /**
   * Emitted when user clicks close button on a tab
   * Handler: sidebarStore.closeConversation(id)
   */
  'conversation-close': (conversationId: string) => void

  /**
   * Emitted when user reorders tabs via drag-and-drop
   * Handler: sidebarStore.reorderConversations(fromIndex, toIndex)
   */
  'conversation-reorder': (payload: {
    conversationId: string
    fromIndex: number
    toIndex: number
  }) => void

  /**
   * Emitted when user clicks "New Conversation" button
   * Handler: sidebarStore.createConversation()
   */
  'new-conversation': () => void

  /**
   * Emitted when user clicks Settings button
   * Handler: windowPresenter.openOrFocusSettingsWindow()
   */
  'open-settings': () => void

  /**
   * Emitted when user clicks Browser button
   * Handler: windowPresenter.createShellWindow({ windowType: 'browser' })
   */
  'open-browser': () => void

  /**
   * Emitted when user changes sidebar width via resize handle
   */
  'width-change': (newWidth: number) => void

  /**
   * Emitted when user toggles collapsed state
   */
  'collapsed-change': (collapsed: boolean) => void
}
```

### 1.4 Layout Structure

**Comparison with Existing AppBar**:

| Aspect | Existing AppBar | New VerticalSidebar |
|--------|-----------------|---------------------|
| Position | Window top | Window left |
| Layout | `flex-row h-9` | `flex-col w-[var(--sidebar-width)]` |
| Scroll | `overflow-x-auto` | `overflow-y-auto` |
| Tab data source | `tabStore.tabs` (IPC) | `sidebarStore.openConversations` (local) |
| Switch mechanism | `tabPresenter.switchTab()` | `router.push()` |
| Close mechanism | `tabPresenter.closeTab()` | `sidebarStore.closeConversation()` |

**Template Structure**:

```vue
<template>
  <div class="flex flex-col h-full border-r border-border"
       :style="{ width: collapsed ? '48px' : `${width}px` }">

    <!-- Top: Scrollable conversation list -->
    <div class="flex-1 overflow-y-auto scrollbar-hide">
      <div class="flex flex-col"
           @dragover="onTabContainerDragOver"
           @drop="onTabContainerDrop">
        <ConversationTab
          v-for="(conv, idx) in conversations"
          :key="conv.id"
          :conversation="conv"
          :active="conv.id === activeConversationId"
          :closable="conversations.length > 1"
          @click="$emit('conversation-select', conv.id)"
          @close="$emit('conversation-close', conv.id)"
          @dragstart="onTabDragStart(conv.id, $event)"
          @dragover="onTabItemDragOver(idx, $event)"
        />
        <!-- Drag insert indicator (reuse from AppBar) -->
        <div v-if="dragInsertIndex !== -1"
             class="absolute left-0 right-0 h-0.5 bg-blue-500 z-10 pointer-events-none"
             :style="{ top: dragInsertPosition + 'px' }" />
      </div>
    </div>

    <!-- Bottom: Fixed action buttons -->
    <div class="shrink-0 flex flex-col border-t border-border p-2 gap-1">
      <Button @click="$emit('new-conversation')">
        <Icon icon="lucide:plus" /> New
      </Button>
      <Button @click="$emit('open-settings')">
        <Icon icon="lucide:settings" />
      </Button>
      <Button @click="$emit('open-browser')">
        <Icon icon="lucide:compass" />
      </Button>
    </div>
  </div>
</template>
```

### 1.5 Drag-and-Drop Logic

**Reuse from AppBar.vue** (adapt for vertical):

```typescript
// Existing horizontal logic (AppBar.vue lines 200-250)
const onTabContainerDragOver = (e: DragEvent) => {
  e.preventDefault()
  // Calculate insert position based on mouse Y (not X)
}

const onTabItemDragOver = (idx: number, e: DragEvent) => {
  e.preventDefault()
  const rect = (e.target as HTMLElement).getBoundingClientRect()
  const midY = rect.top + rect.height / 2  // Changed from midX
  dragInsertIndex.value = e.clientY < midY ? idx : idx + 1
}

const onTabContainerDrop = async (e: DragEvent) => {
  e.preventDefault()
  const tabId = e.dataTransfer?.getData('text/plain')
  if (tabId && dragInsertIndex.value !== -1) {
    emit('conversation-reorder', {
      conversationId: tabId,
      fromIndex: currentIndex,
      toIndex: dragInsertIndex.value
    })
  }
  dragInsertIndex.value = -1
}
```

### 1.6 Keyboard Navigation

```typescript
/**
 * Keyboard shortcuts (reuse patterns from existing code)
 */
const keyboardHandlers = {
  'ArrowUp': () => selectPreviousConversation(),
  'ArrowDown': () => selectNextConversation(),
  'Ctrl+W': () => closeActiveConversation(),
  'Ctrl+T': () => emit('new-conversation'),
  'Ctrl+Tab': () => selectNextConversation(),
  'Ctrl+Shift+Tab': () => selectPreviousConversation(),
}
```

### 1.7 Edge Cases

| Scenario | Behavior |
|----------|----------|
| Empty state | Show "New Conversation" CTA |
| Single conversation | Hide close button (`closable=false`) |
| Long titles | CSS ellipsis + tooltip on hover |
| Many conversations (100+) | Virtual scrolling (Phase 2) |
| Rapid switching | No debounce, cancel previous loads |
| Close last conversation | Navigate to `/new` instead |

---

## 2. ConversationTab Component

### 2.1 Component Overview

**Purpose**: Individual conversation tab item rendered within VerticalSidebar.

**Location**: `src/renderer/src/components/ConversationTab.vue`

**Parent Component**: `VerticalSidebar.vue`

**Reference**: Based on `AppBarTabItem.vue` patterns

### 2.2 Props Definition

```typescript
interface ConversationTabProps {
  conversation: ConversationMeta
  active: boolean
  closable?: boolean  // @default true
  draggable?: boolean // @default false (Phase 2)
  tabindex?: number   // @default -1
}
```

### 2.3 Events Definition

```typescript
interface ConversationTabEvents {
  'click': (conversationId: string) => void
  'close': (conversationId: string, event: MouseEvent) => void
  'dragstart': (conversationId: string, event: DragEvent) => void
  'dragend': (conversationId: string, event: DragEvent) => void
  'contextmenu': (conversationId: string, event: MouseEvent) => void
}
```

### 2.4 Visual States

```typescript
enum TabVisualState {
  DEFAULT = 'default',
  HOVER = 'hover',
  ACTIVE = 'active',
  LOADING = 'loading',
  ERROR = 'error',
  DRAGGING = 'dragging'
}
```

**Styling**:

```vue
<template>
  <div
    class="flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors"
    :class="{
      'bg-accent': active,
      'hover:bg-muted': !active,
      'opacity-50': conversation.isLoading,
      'border-l-2 border-primary': active
    }"
    @click="$emit('click', conversation.id)"
  >
    <!-- Icon -->
    <img v-if="conversation.modelIcon"
         :src="conversation.modelIcon"
         class="w-5 h-5 rounded" />
    <Icon v-else icon="lucide:message-square" class="w-5 h-5" />

    <!-- Title -->
    <span class="flex-1 truncate text-sm">
      {{ conversation.title || 'New Conversation' }}
    </span>

    <!-- Loading indicator -->
    <Icon v-if="conversation.isLoading"
          icon="lucide:loader-2"
          class="w-4 h-4 animate-spin" />

    <!-- Error indicator -->
    <Icon v-else-if="conversation.hasError"
          icon="lucide:alert-circle"
          class="w-4 h-4 text-destructive" />

    <!-- Close button -->
    <Button
      v-if="closable"
      variant="ghost"
      size="icon"
      class="w-6 h-6 opacity-0 group-hover:opacity-100"
      @click.stop="$emit('close', conversation.id, $event)"
    >
      <Icon icon="lucide:x" class="w-3 h-3" />
    </Button>
  </div>
</template>
```

---

## 3. ChatView Component Changes

### 3.1 Overview

**Location**: `src/renderer/src/views/ChatView.vue` (existing file)

**Key Change**: Receive conversation ID from Vue Router instead of TabPresenter.

### 3.2 Current vs New Data Flow

**Current** (Tab-aware):
```typescript
// Current: Get active thread from tabId
const chatStore = useChatStore()
const activeThreadId = chatStore.getActiveThreadId() // Uses getTabId() internally
```

**New** (Router-based):
```typescript
// New: Get active thread from route params
const route = useRoute()
const activeThreadId = computed(() => route.params.id as string | undefined)
```

### 3.3 Lifecycle Changes

```typescript
// New lifecycle behavior
const route = useRoute()

// Watch for route changes (conversation switching)
watch(() => route.params.id, async (newId, oldId) => {
  if (newId === oldId) return

  // 1. Cancel pending loads from previous conversation
  abortController?.abort()
  abortController = new AbortController()

  // 2. Clear current state
  clearCurrentConversationState()

  // 3. Load new conversation
  if (newId) {
    await loadConversation(newId as string, abortController.signal)
  }
}, { immediate: true })

// Cleanup on unmount
onBeforeUnmount(() => {
  abortController?.abort()
  clearEventListeners()
})
```

### 3.4 Integration with Existing Components

**No changes needed** for these child components:
- `MessageList.vue` - Receives messages from chatStore
- `ChatInput.vue` - Sends messages via agentPresenter
- `WorkspaceView.vue` - Agent workspace

**Changes needed**:
- Remove `getTabId()` calls
- Use `route.params.id` for conversation identification

---

## 4. App.vue Changes

### 4.1 New Layout Structure

**Current** (Shell + WebContentsView):
```
BrowserWindow
├── Shell WebContents (shell/index.html)
│   └── AppBar (horizontal tabs)
└── WebContentsView (src/index.html)
    └── ChatView
```

**New** (Single WebContents):
```
BrowserWindow
└── Single WebContents (src/index.html)
    └── App.vue
        ├── VerticalSidebar (left)
        └── RouterView (right)
            └── ChatView
```

### 4.2 Template Changes

```vue
<!-- New App.vue structure -->
<template>
  <div class="flex h-screen w-screen">
    <!-- Vertical Sidebar -->
    <VerticalSidebar
      :conversations="sidebarStore.sortedConversations"
      :active-conversation-id="route.params.id"
      :width="sidebarStore.width"
      :collapsed="sidebarStore.collapsed"
      @conversation-select="onConversationSelect"
      @conversation-close="onConversationClose"
      @new-conversation="onNewConversation"
      @open-settings="onOpenSettings"
      @open-browser="onOpenBrowser"
    />

    <!-- Main Content -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Window Title Bar (for window controls) -->
      <div class="h-9 flex items-center justify-end px-2 window-drag-region">
        <WindowControls v-if="!isMacOS" />
      </div>

      <!-- Router View -->
      <RouterView class="flex-1" />
    </div>

    <!-- Global Dialogs (unchanged) -->
    <UpdateDialog />
    <MessageDialog />
    <McpSamplingDialog />
  </div>
</template>
```

---

## References

- Existing `AppBar.vue`: `src/renderer/shell/components/AppBar.vue`
- Existing `AppBarTabItem.vue`: `src/renderer/shell/components/AppBarTabItem.vue`
- Existing `ChatView.vue`: `src/renderer/src/views/ChatView.vue`
- Existing `chat.ts` store: `src/renderer/src/stores/chat.ts`
