# Single WebContents Architecture Specification

**Status**: Draft
**Created**: 2026-01-16
**Owner**: Architecture Team

---

## 1. Background & Motivation

### 1.1 Current Architecture

DeepChat currently uses a **multi-window + multi-tab hybrid architecture**:

```
BrowserWindow (Chat Window)
├─ Shell WebContents (src/renderer/shell/)
│  └─ AppBar + Window Controls
└─ Multiple WebContentsViews (src/renderer/src/)
   ├─ Tab 1: Chat Interface
   ├─ Tab 2: Settings
   ├─ Tab 3: Knowledge Base
   └─ Tab N: Other Views

BrowserWindow (Browser Window)
├─ Shell WebContents (src/renderer/shell/)
│  └─ AppBar + BrowserToolbar
└─ Multiple WebContentsViews (External URLs)
   ├─ Tab 1: https://example.com
   └─ Tab N: Other Web Pages
```

**Key Components**:
- **Shell**: Thin UI layer (`src/renderer/shell/`) with AppBar for tab management
- **Main**: Actual application content (`src/renderer/src/`) rendered via WebContentsView
- **TabPresenter**: Complex Electron main-process manager for WebContentsView lifecycle
- **WindowPresenter**: BrowserWindow lifecycle manager coordinating with TabPresenter

### 1.2 Motivation for Change

**Problems with Current Architecture**:

1. **Complexity**: Managing WebContentsView lifecycle, bounds, visibility, and focus is intricate
2. **Overhead**: Each WebContentsView creates overhead for IPC routing and state synchronization
3. **Development Friction**: Two separate Renderer codebases (shell vs main) complicates development
4. **Memory Inefficiency**: Cannot truly destroy tabs - they remain in memory or require full recreation
5. **IPC Complexity**: Elaborate WebContentsId → TabId → WindowId mapping for IPC routing

**Benefits of Single WebContents**:

1. **Simplified Architecture**: One unified Renderer codebase per window type
2. **Better Performance**: Faster tab switching via component mounting/unmounting
3. **Easier State Management**: Shared Pinia stores across tabs with better isolation control
4. **Reduced IPC Overhead**: Direct presenter calls without complex tab routing
5. **Modern Web UX**: Tab switching feels like SPA navigation

---

## 2. Architecture Design

### 2.1 New Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Chat Window (Single WebContents)             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ┌──┐  ┌──────────────────────────────────────────────┐  │  │
│  │  │T1│  │                                              │  │  │
│  │  ├──┤  │        Active Conversation Content          │  │  │
│  │  │T2│  │        (ChatView with conversationId)       │  │  │
│  │  ├──┤  │                                              │  │  │
│  │  │T3│  │   User: How do I...                         │  │  │
│  │  ├──┤  │   Assistant: To do that...                  │  │  │
│  │  │+│  │   User: Thanks!                              │  │  │
│  │  └──┘  │                                              │  │  │
│  │        │   [Type your message...]          [Send]    │  │  │
│  │        └──────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│    ↑                            ↑                               │
│  Vertical                   Single ChatView                     │
│  Tab Bar                    (conversation tabs)                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│          Settings/Knowledge/History (Separate Windows)          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Dedicated window with specific content                  │  │
│  │  - Settings: Single WebContents, SettingsView            │  │
│  │  - Knowledge: Single WebContents, KnowledgeBaseView      │  │
│  │  - History: Single WebContents, HistoryView              │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│             Browser Window (Keeps Current Architecture)         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  AppBar + BrowserToolbar (Shell WebContents)             │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │  WebContentsView 1, 2, 3... (External Web Pages)         │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Principles**:

1. **Window Type Differentiation**:
   - **Chat Windows**: Single WebContents with vertical tab bar for conversation switching
   - **Tool Windows** (Settings/Knowledge/History): Single WebContents, separate windows
   - **Browser Windows**: Keep existing Shell + WebContentsView architecture (security isolation)

2. **Unified Renderer Codebase**: Merge `src/renderer/shell/` and `src/renderer/src/` into single app

3. **Tab Management**:
   - Chat window tabs = conversation sessions (not routes)
   - Tab switching = changing active conversation ID in ChatView
   - No Vue Router needed (single view, multiple conversations)

4. **State Management**: Single Pinia chat store with active conversation ID

---

## 3. Technical Design

### 3.1 Window Creation Flow

#### Chat Window

```typescript
// WindowPresenter.createChatWindow()
async createChatWindow(options?: {
  initialConversationId?: string
  width?: number
  height?: number
}): Promise<number> {
  const window = new BrowserWindow({
    width: options?.width || 1200,
    height: options?.height || 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  const windowId = window.id
  this.windows.set(windowId, window)
  this.windowTypes.set(windowId, 'chat')

  // Load unified renderer (chat view)
  if (is.dev) {
    await window.loadURL('http://localhost:5173/index.html')
  } else {
    await window.loadFile('../renderer/index.html')
  }

  // Optionally notify renderer to load specific conversation
  if (options?.initialConversationId) {
    window.webContents.on('did-finish-load', () => {
      window.webContents.send('load-conversation', options.initialConversationId)
    })
  }

  return windowId
}
```

#### Tool Windows (Settings, Knowledge, History)

```typescript
// WindowPresenter.createToolWindow()
async createToolWindow(toolType: 'settings' | 'knowledge' | 'history'): Promise<number> {
  const window = new BrowserWindow({
    width: toolType === 'settings' ? 900 : 1200,
    height: 700,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  const windowId = window.id
  this.windows.set(windowId, window)
  this.windowTypes.set(windowId, 'tool')

  // Load specific tool view
  const viewPath = {
    settings: 'settings.html',
    knowledge: 'knowledge.html',
    history: 'history.html'
  }[toolType]

  if (is.dev) {
    await window.loadURL(`http://localhost:5173/${viewPath}`)
  } else {
    await window.loadFile(`../renderer/${viewPath}`)
  }

  return windowId
}
```

#### Browser Window (Unchanged)

```typescript
// WindowPresenter.createBrowserWindow()
async createBrowserWindow(options?: {
  initialUrl?: string
}): Promise<number> {
  // Keep existing shell + WebContentsView architecture
  return this.createShellWindow({
    windowType: 'browser',
    initialTab: { url: options?.initialUrl || 'about:blank' }
  })
}
```

### 3.2 Renderer Architecture

#### 3.2.1 Directory Structure

```
src/renderer/
├── index.html                 # Chat window entry
├── settings.html              # Settings window entry
├── knowledge.html             # Knowledge window entry
├── history.html               # History window entry
├── src/
│   ├── main.ts               # Chat window initialization
│   ├── settings-main.ts      # Settings window initialization
│   ├── knowledge-main.ts     # Knowledge window initialization
│   ├── history-main.ts       # History window initialization
│   ├── App.vue               # Chat window root (Vertical Tab Bar + ChatView)
│   ├── SettingsApp.vue       # Settings window root
│   ├── KnowledgeApp.vue      # Knowledge window root
│   ├── HistoryApp.vue        # History window root
│   ├── views/                # Main views
│   │   ├── ChatView.vue
│   │   ├── SettingsView.vue
│   │   ├── KnowledgeBaseView.vue
│   │   └── HistoryView.vue
│   ├── components/           # Shared components
│   │   ├── VerticalTabBar.vue  # NEW: Vertical conversation tab list
│   │   ├── ConversationTab.vue # NEW: Single conversation tab item
│   │   └── ...
│   ├── stores/               # Pinia stores
│   │   ├── app.ts           # App-level state
│   │   ├── chat.ts          # Chat state (active conversation ID)
│   │   ├── settings.ts      # Settings state
│   │   └── ...
│   └── composables/          # Composables
│       ├── usePresenter.ts
│       └── ...
│
├── shell/                    # Browser window shell (KEPT for browser windows)
│   ├── index.html
│   ├── App.vue              # Shell with AppBar + BrowserToolbar
│   ├── components/
│   │   ├── AppBar.vue
│   │   └── BrowserToolbar.vue
│   └── stores/
│       └── tab.ts           # WebContentsView tab management
```

**Note**: No router/ directory needed - chat window manages conversations via state, not routing.

#### 3.2.2 Chat Window Layout (App.vue)

```vue
<!-- src/renderer/src/App.vue - Chat Window -->
<template>
  <div class="app-container h-screen flex">
    <!-- Vertical Tab Bar (conversation list) -->
    <VerticalTabBar
      :tabs="conversationTabs"
      :active-tab-id="activeConversationId"
      @tab-click="switchConversation"
      @tab-close="closeConversation"
      @new-tab="createNewConversation"
    />

    <!-- Main chat content area -->
    <main class="flex-1 flex flex-col">
      <ChatView
        :conversation-id="activeConversationId"
        :key="activeConversationId"
      />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useChatStore } from './stores/chat'
import VerticalTabBar from './components/VerticalTabBar.vue'
import ChatView from './views/ChatView.vue'

const chatStore = useChatStore()

// Active conversation state
const activeConversationId = ref<string | null>(null)

// Open conversation tabs (similar to current AppBar tabs)
const conversationTabs = computed(() => {
  return chatStore.openConversations.map(conv => ({
    id: conv.id,
    title: conv.title || 'New Chat',
    icon: conv.icon,
    closable: true,
    isDirty: conv.hasUnsavedChanges
  }))
})

function switchConversation(conversationId: string) {
  activeConversationId.value = conversationId
  chatStore.setActiveConversation(conversationId)
}

function closeConversation(conversationId: string) {
  chatStore.closeConversation(conversationId)

  // Switch to adjacent tab if current is closed
  if (activeConversationId.value === conversationId) {
    const index = chatStore.openConversations.findIndex(c => c.id === conversationId)
    const nextConv = chatStore.openConversations[Math.max(0, index - 1)]
    if (nextConv) {
      activeConversationId.value = nextConv.id
    }
  }
}

async function createNewConversation() {
  const newConv = await chatStore.createConversation()
  activeConversationId.value = newConv.id
}

// Listen to IPC events from Main process
onMounted(() => {
  window.electron.ipcRenderer.on('load-conversation', (_, conversationId) => {
    switchConversation(conversationId)
  })
})
</script>
```

#### 3.2.3 VerticalTabBar Component

```vue
<!-- src/renderer/src/components/VerticalTabBar.vue -->
<template>
  <aside class="vertical-tab-bar w-16 flex flex-col bg-zinc-900 border-r border-zinc-800">
    <!-- Conversation tabs -->
    <nav class="flex-1 flex flex-col gap-1 p-2 overflow-y-auto">
      <ConversationTab
        v-for="tab in tabs"
        :key="tab.id"
        :tab="tab"
        :active="tab.id === activeTabId"
        @click="$emit('tab-click', tab.id)"
        @close="$emit('tab-close', tab.id)"
      />
    </nav>

    <!-- Bottom controls -->
    <div class="controls flex flex-col gap-2 p-2 border-t border-zinc-800">
      <button
        class="control-btn"
        title="New Conversation"
        @click="$emit('new-tab')"
      >
        <Icon name="Plus" />
      </button>
      <button
        class="control-btn"
        title="Settings"
        @click="openSettings"
      >
        <Icon name="Settings" />
      </button>
      <button
        class="control-btn"
        title="Browser"
        @click="openBrowser"
      >
        <Icon name="Globe" />
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { usePresenter } from '../composables/usePresenter'
import ConversationTab from './ConversationTab.vue'

defineProps<{
  tabs: Array<{
    id: string
    title: string
    icon?: string
    closable: boolean
    isDirty?: boolean
  }>
  activeTabId: string | null
}>()

defineEmits<{
  'tab-click': [id: string]
  'tab-close': [id: string]
  'new-tab': []
}>()

const windowPresenter = usePresenter('windowPresenter')

async function openSettings() {
  await windowPresenter.createToolWindow('settings')
}

async function openBrowser() {
  await windowPresenter.createBrowserWindow()
}
</script>
```

### 3.3 State Management

#### 3.3.1 Chat Store

```typescript
// src/renderer/src/stores/chat.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '../composables/usePresenter'

export const useChatStore = defineStore('chat', () => {
  const conversationPresenter = usePresenter('conversationPresenter')

  // Open conversations (tabs) in current window
  const openConversations = ref<Conversation[]>([])

  // Active conversation ID
  const activeConversationId = ref<string | null>(null)

  // Computed active conversation
  const activeConversation = computed(() => {
    return openConversations.value.find(c => c.id === activeConversationId.value)
  })

  // Actions
  async function createConversation() {
    const newConv = await conversationPresenter.create({
      title: 'New Chat',
      messages: []
    })

    openConversations.value.push(newConv)
    activeConversationId.value = newConv.id

    return newConv
  }

  function setActiveConversation(id: string) {
    activeConversationId.value = id
  }

  function closeConversation(id: string) {
    const index = openConversations.value.findIndex(c => c.id === id)
    if (index > -1) {
      openConversations.value.splice(index, 1)
    }
  }

  async function loadConversation(id: string) {
    // Check if already open
    if (openConversations.value.some(c => c.id === id)) {
      activeConversationId.value = id
      return
    }

    // Load from database
    const conversation = await conversationPresenter.get(id)
    if (conversation) {
      openConversations.value.push(conversation)
      activeConversationId.value = id
    }
  }

  return {
    openConversations,
    activeConversationId,
    activeConversation,
    createConversation,
    setActiveConversation,
    closeConversation,
    loadConversation
  }
})
```

**Key Difference from Current Architecture**:
- No need for tab-scoped state (no Vue Router, no multiple views)
- Conversation switching = updating `activeConversationId`
- ChatView component receives `conversationId` as prop and loads appropriate data

### 3.4 Main Process Changes

#### 3.4.1 Simplified TabPresenter

```typescript
// src/main/presenter/tabPresenter.ts

/**
 * TabPresenter now only manages Browser window tabs
 * Chat window conversations are managed in Renderer via Pinia store
 */
class TabPresenter implements ITabPresenter {
  // Keep only browser window related state
  private browserTabs: Map<number, WebContentsView> = new Map()
  private tabState: Map<number, TabData> = new Map()
  private windowTabs: Map<number, number[]> = new Map()

  /**
   * Create WebContentsView tab (browser window only)
   */
  async createBrowserTab(windowId: number, url: string): Promise<number> {
    const window = this.windowPresenter.getWindow(windowId)
    const windowType = this.windowTypes.get(windowId)

    if (windowType !== 'browser') {
      throw new Error('createBrowserTab only supports browser windows')
    }

    // Existing WebContentsView creation logic (unchanged)
    const view = new WebContentsView({
      webPreferences: {
        sandbox: false,
        session: getYoBrowserSession()
        // NO preload for security
      }
    })

    await view.webContents.loadURL(url)

    const tabId = view.webContents.id
    this.browserTabs.set(tabId, view)

    // ... rest of existing logic
    return tabId
  }

  // Keep existing browser tab methods:
  // - switchBrowserTab()
  // - closeBrowserTab()
  // - reorderBrowserTabs()
  // - moveBrowserTab()

  // REMOVED methods (chat windows no longer use these):
  // - createTab() for chat windows
  // - Complex WebContentsView management for chat windows
  // - WebContentsId → TabId mapping for chat windows
}
```

#### 3.4.2 WindowPresenter Changes

```typescript
// src/main/presenter/windowPresenter/index.ts

class WindowPresenter implements IWindowPresenter {
  async createChatWindow(options?: {
    initialRoute?: string
    width?: number
    height?: number
  }): Promise<number> {
    const window = new BrowserWindow({
      width: options?.width || 1200,
      height: options?.height || 800,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        sandbox: false
      }
    })

    const windowId = window.id
    this.windows.set(windowId, window)
    this.windowTypes.set(windowId, 'chat')

    // Load unified renderer
    const route = options?.initialRoute || '/chat'
    if (is.dev) {
      await window.loadURL(`http://localhost:5173/#${route}`)
    } else {
      await window.loadFile('../renderer/index.html', { hash: route })
    }

    return windowId
  }

  async createBrowserWindow(options?: {
    initialUrl?: string
  }): Promise<number> {
    // Keep existing shell + WebContentsView architecture
    return this.createShellWindow({
      windowType: 'browser',
      initialTab: { url: options?.initialUrl || 'about:blank' }
    })
  }
}
```

### 3.5 IPC Simplification

#### 3.5.1 Before (Current Architecture)

```typescript
// Renderer needs to know which tab it is
const presenter = usePresenter('chatPresenter')
await presenter.sendMessage(message)  // Complex routing

// Main process
ipcMain.handle('presenter:call', (event, name, method, ...args) => {
  const webContentsId = event.sender.id
  const tabId = tabPresenter.getTabIdByWebContentsId(webContentsId)
  const windowId = tabPresenter.getWindowIdByWebContentsId(webContentsId)
  // Complex context tracking...
})
```

#### 3.5.2 After (New Architecture)

```typescript
// Renderer: Simple direct call (chat windows)
const presenter = usePresenter('chatPresenter')
await presenter.sendMessage(message)  // No tab routing needed

// Main process: Simpler handler
ipcMain.handle('presenter:call', (event, name, method, ...args) => {
  const windowId = BrowserWindow.fromWebContents(event.sender)?.id
  // Simpler context - no tab mapping needed for chat windows
})
```

---

## 4. Migration Strategy

### 4.1 Phased Migration

#### Phase 1: Prepare Infrastructure (Week 1-2)

- [ ] Create VerticalTabBar and ConversationTab components
- [ ] Update chat store for conversation tab management
- [ ] Create tool window entry points (settings.html, knowledge.html, history.html)
- [ ] Update build configuration for multiple entry points

#### Phase 2: Refactor Chat Window (Week 3-4)

- [ ] Merge shell and main renderer into unified App.vue
- [ ] Implement conversation tab switching logic
- [ ] Update ChatView to work with conversationId prop
- [ ] Test conversation switching and tab management

#### Phase 3: Create Tool Windows (Week 5)

- [ ] Migrate Settings to separate window
- [ ] Migrate Knowledge Base to separate window
- [ ] Migrate History to separate window
- [ ] Test tool window creation and lifecycle

#### Phase 4: Refactor Main Process (Week 6-7)

- [ ] Simplify TabPresenter (remove chat window logic)
- [ ] Add WindowPresenter.createChatWindow()
- [ ] Add WindowPresenter.createToolWindow()
- [ ] Remove unused WebContentsView code for chat windows
- [ ] Update EventBus routing logic

#### Phase 5: Update IPC Layer (Week 8)

- [ ] Simplify IPC context tracking (no WebContentsId mapping for chat)
- [ ] Update presenter call handlers
- [ ] Test IPC communication across all window types
- [ ] Remove obsolete IPC channels

#### Phase 6: Testing & Polish (Week 9-10)

- [ ] End-to-end testing
- [ ] Performance benchmarking
- [ ] Memory profiling
- [ ] Fix edge cases
- [ ] Documentation updates

#### Phase 7: Deploy (Week 11)

- [ ] Beta release
- [ ] User feedback collection
- [ ] Bug fixes
- [ ] Stable release

### 4.2 Rollback Strategy

Keep both architectures available via feature flag:

```typescript
// Feature flag in config
const USE_SINGLE_WEBCONTENTS = true  // New architecture
const USE_MULTI_WEBCONTENTS = false  // Old architecture (fallback)

// WindowPresenter
async createChatWindow(options) {
  if (USE_SINGLE_WEBCONTENTS) {
    return this.createUnifiedChatWindow(options)
  } else {
    return this.createShellWindow({ windowType: 'chat', ...options })
  }
}
```

---

## 5. Impact Analysis

### 5.1 Performance Impact

| Metric | Current | New | Change |
|--------|---------|-----|--------|
| **Tab Switch Time** | ~50-100ms (WebContentsView show/hide) | ~10-30ms (Component mount) | **↑ 2-5x faster** |
| **Memory per Tab** | ~30-50MB (WebContents overhead) | ~5-10MB (Component state) | **↓ ~80% reduction** |
| **Window Creation** | ~500ms (Shell + WebContentsView) | ~300ms (Single WebContents) | **↑ 40% faster** |
| **IPC Latency** | ~2-5ms (WebContentsId mapping) | ~1-2ms (Direct window call) | **↑ 50% faster** |

### 5.2 Code Complexity

| Component | Current LOC | New LOC | Change |
|-----------|-------------|---------|--------|
| TabPresenter | ~1200 | ~400 (browser only) | **↓ 67%** |
| WindowPresenter | ~1700 | ~1400 | **↓ 18%** |
| Shell Renderer | ~800 | ~0 (merged) | **↓ 100%** |
| Main Renderer | ~15000 | ~15500 (+ vertical tab bar) | **↑ 3%** |
| Tool Windows | ~0 | ~500 (3 windows) | **↑ New** |
| **Total** | ~18700 | ~17800 | **↓ 5%** |

**Note**: Complexity reduction is moderate because we're not adding Vue Router overhead, just simpler conversation state management.

### 5.3 User Experience

**Improvements**:
- ✅ Faster conversation switching (imperceptible)
- ✅ Simpler mental model (vertical tabs = conversations, not router pages)
- ✅ Settings/Tools in separate windows (clearer separation of concerns)
- ✅ More responsive UI (less IPC overhead)

**Potential Issues**:
- ⚠️ Tool windows may feel disconnected (mitigated by familiar window pattern)
- ⚠️ Conversation state management complexity (mitigated by Pinia store)

---

## 6. Risk Assessment

### 6.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Conversation state not properly cleaned up** | Medium | Medium | Implement proper cleanup in closeConversation(), memory profiling |
| **IPC simplification breaks features** | Low | High | Incremental migration, feature flags, thorough testing |
| **Performance regression** | Very Low | Medium | Performance benchmarking, profiling |
| **Multi-entry build complexity** | Medium | Low | Well-tested Vite multi-entry configuration |

### 6.2 Migration Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Feature regressions** | Medium | High | Extensive QA testing, beta release cycle |
| **User data loss** | Very Low | Critical | No database changes, state migration testing |
| **Breaking third-party integrations** | Low | Medium | API compatibility layer, version negotiation |
| **Development timeline overrun** | Medium | Medium | Phased migration, clear milestones, rollback plan |

---

## 7. Open Questions

### 7.1 Design Decisions

- [ ] **Q1**: Should conversation tabs support drag-and-drop reordering?
  - **Consideration**: Current AppBar supports tab reordering
  - **Recommendation**: Implement in Phase 2 (not MVP)

- [ ] **Q2**: How to handle ACP workspace windows?
  - **Consideration**: ACP workspace might need isolation similar to browser tabs
  - **Options**:
    - Option A: Keep as WebContentsView (current behavior)
    - Option B: Create as separate tool window
    - Option C: Embed in chat window (if security permits)
  - **Recommendation**: [NEEDS CLARIFICATION]

- [ ] **Q3**: Should we support tearing off conversation tabs into new windows?
  - **Consideration**: Complex state serialization/deserialization
  - **Recommendation**: Phase 2 feature, not MVP

- [ ] **Q4**: Should Settings/Knowledge/History windows be modal or independent?
  - **Consideration**: Current behavior vs user convenience
  - **Recommendation**: Independent windows (current behavior)

### 7.2 Technical Questions

- [ ] **Q5**: How many conversation tabs should be kept in memory simultaneously?
  - **Consideration**: Balance between memory usage and quick switching
  - **Recommendation**: Keep all open conversations, implement lazy loading for messages

- [ ] **Q6**: Should tool windows share the same renderer code or have separate builds?
  - **Consideration**: Code sharing vs bundle size
  - **Recommendation**: Share components, separate entry points (cleaner build)

- [ ] **Q7**: How to handle deep linking to specific conversations?
  - **Consideration**: User may click link like `deepchat://conversation/abc123`
  - **Recommendation**: IPC message to load and activate specific conversation

---

## 8. Success Criteria

### 8.1 MVP Requirements

- ✅ Chat windows use single WebContents with vertical tab bar for conversations
- ✅ Settings/Knowledge/History use separate independent windows
- ✅ Browser windows still use shell + WebContentsView architecture
- ✅ Conversation switching is ≥2x faster than current
- ✅ Memory usage per conversation tab is reduced by ≥50%
- ✅ All existing features work without regression
- ✅ No user-facing bugs in critical paths

### 8.2 Performance Benchmarks

- Tab switch time: < 30ms (p95)
- Window creation time: < 400ms (p95)
- Memory per inactive tab: < 15MB (average)
- IPC latency: < 3ms (p95)

### 8.3 Quality Metrics

- Unit test coverage: ≥80%
- E2E test coverage: Critical user flows
- No memory leaks detected in 24h soak test
- Performance regression: < 5% on any metric

---

## 9. References

### 9.1 Related Documents

- [Current Architecture Research](./research.md) - Detailed analysis of existing WindowPresenter/TabPresenter
- [Vue Router Documentation](https://router.vuejs.org/)
- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window)

### 9.2 Prior Art

- **VSCode**: Uses webviews for extensions but main UI is single webContents
- **Slack**: Desktop app uses single WebContents with router-based navigation
- **Discord**: Multi-window with single WebContents per window

---

## Appendix A: API Changes

### A.1 Removed APIs

```typescript
// TabPresenter (for chat windows)
- createTab(windowId, url, options)        // Replaced by Vue Router navigation
- switchTab(tabId)                         // Replaced by router.push()
- closeTab(tabId)                          // Replaced by router.back() or custom closeTab()
- reorderTabs(windowId, tabIds)            // May add back if tab bar is implemented
- moveTab(tabId, targetWindowId)           // Complex, deferred to Phase 2
```

### A.2 New APIs

```typescript
// WindowPresenter
+ createChatWindow(options: {
    initialRoute?: string
    width?: number
    height?: number
  }): Promise<number>

// TabPresenter
+ navigateChatWindow(windowId: number, route: string): Promise<void>

// Renderer (usePresenter)
+ windowPresenter.navigateToRoute(route: string): Promise<void>
```

### A.3 Modified APIs

```typescript
// WindowPresenter.createShellWindow()
// Now only creates browser windows
createShellWindow(options: {
  windowType: 'browser'  // 'chat' is removed, use createChatWindow instead
  initialTab?: { url: string }
})
```

---

## Appendix B: UI Mockups

### B.1 Chat Window Layout

```
┌─────────────────────────────────────────────────────────────┐
│ ┌──┐ ┌─────────────────────────────────────────────────┐   │
│ │T1│ │  Conversation: "Planning DeepChat Refactor"     │   │
│ │  │ ├─────────────────────────────────────────────────┤   │
│ ├──┤ │                                                 │   │
│ │T2│ │  User: Let's refactor the window architecture   │   │
│ │  │ │  Assistant: Great idea! Here's my analysis...   │   │
│ ├──┤ │  User: Can you create a spec document?          │   │
│ │T3│ │  Assistant: Of course! I'll write...            │   │
│ │  │ │                                                 │   │
│ ├──┤ │                                                 │   │
│ │+ │ │                                                 │   │
│ │  │ ├─────────────────────────────────────────────────┤   │
│ │  │ │  [Type your message...]           [Send ↑]     │   │
│ ├──┤ └─────────────────────────────────────────────────┘   │
│ │⚙ │                                                       │
│ ├──┤                                                       │
│ │🌐│                                                       │
│ └──┘                                                       │
└─────────────────────────────────────────────────────────────┘
  ↑                              ↑
Vertical Tab Bar          Single ChatView
(conversation tabs)       (active conversation content)

Legend:
- T1, T2, T3: Conversation tabs (like current AppBar tabs)
- +: New conversation button
- ⚙: Open Settings window
- 🌐: Open Browser window
```

### B.2 Tool Window (Settings Example)

```
┌─────────────────────────────────────────────────────────────┐
│  Settings                                          [× □ −]  │
├─────────────────────────────────────────────────────────────┤
│ ┌───────────┐ ┌───────────────────────────────────────────┐│
│ │           │ │                                           ││
│ │  General  │ │  Language: [English ▼]                   ││
│ │  Models   │ │  Theme: [Auto ▼]                          ││
│ │  Plugins  │ │  ...                                      ││
│ │  Advanced │ │                                           ││
│ │           │ │                                           ││
│ └───────────┘ └───────────────────────────────────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
  ↑
Separate independent window (not a tab in chat window)
```

### B.3 Browser Window (Unchanged Architecture)

```
┌─────────────────────────────────────────────────────────────┐
│  [Tab 1: Google] [Tab 2: GitHub] [Tab 3: Docs] [+]  [× □ −]│
├─────────────────────────────────────────────────────────────┤
│  [← → ⟳]  [https://example.com                    ] [★ ⋮]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  (External web page content in WebContentsView)            │
│                                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
  ↑
Shell + WebContentsViews (current architecture, unchanged)
```

---

**End of Specification**
