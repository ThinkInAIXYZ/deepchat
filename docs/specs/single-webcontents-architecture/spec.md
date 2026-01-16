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
│  └─ AppBar (horizontal tabs for open conversations)
└─ Multiple WebContentsViews (src/renderer/src/)
   ├─ Tab 1: Conversation "Project Planning"
   ├─ Tab 2: Conversation "Code Review"
   ├─ Tab 3: Conversation "Bug Analysis"
   └─ Tab N: Other Open Conversations

BrowserWindow (Settings Window) - Independent
└─ Single WebContents (Settings UI)

BrowserWindow (Browser Window) - Independent
├─ Shell WebContents (src/renderer/shell/)
│  └─ AppBar + BrowserToolbar
└─ Multiple WebContentsViews (External URLs)
   ├─ Tab 1: https://example.com
   └─ Tab N: Other Web Pages
```

**Key Components**:
- **AppBar Horizontal Tabs**: Each tab represents an **open conversation** (not functional areas)
- **Shell**: Thin UI layer (`src/renderer/shell/`) with AppBar for managing open conversation tabs
- **Main**: Conversation content (`src/renderer/src/`) rendered via WebContentsView per tab
- **TabPresenter**: Complex Electron main-process manager for WebContentsView lifecycle
- **WindowPresenter**: BrowserWindow lifecycle manager coordinating with TabPresenter
- **ThreadsView**: Floating sidebar showing **historical conversations archive** (different from open conversations)
- **Settings/Browser**: Already independent windows, not tabs in chat window

### 1.2 Motivation for Change

**Problems with Current Architecture**:

1. **Complexity**: Managing WebContentsView lifecycle, bounds, visibility, and focus is intricate
2. **Overhead**: Each WebContentsView creates overhead for IPC routing and state synchronization
3. **Development Friction**: Two separate Renderer codebases (shell vs main) complicates development
4. **Memory Inefficiency**: Cannot truly destroy tabs - they remain in memory or require full recreation
5. **IPC Complexity**: Elaborate WebContentsId → TabId → WindowId mapping for IPC routing

**Benefits of Single WebContents**:

1. **Simplified Architecture**: One unified Renderer codebase per window type
2. **Better Performance**: Faster conversation switching via component mounting/unmounting
3. **Easier State Management**: Shared Pinia stores across conversations with better isolation control
4. **Reduced IPC Overhead**: Direct presenter calls without complex tab routing
5. **Modern Web UX**: Conversation switching feels like SPA navigation
6. **Improved UI Design**:
   - Vertical sidebar replaces unpopular horizontal tabs
   - Better space utilization for conversation titles
   - Clearer visual hierarchy with AppBar for window controls
   - Settings/Browser entries integrated into sidebar for easier access

---

## 2. Architecture Design

### 2.1 New Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                Chat Window (Single WebContents)                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  AppBar: [Window Title]              [− □ ×]             │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │  ┌──┐  ┌──────────────────────────────────────────────┐  │  │
│  │  │C1│  │                                              │  │  │
│  │  ├──┤  │   Active Conversation Content                │  │  │
│  │  │C2│  │   (ChatView with conversationId)             │  │  │
│  │  ├──┤  │                                              │  │  │
│  │  │C3│  │   User: How do I...                         │  │  │
│  │  ├──┤  │   Assistant: To do that...                  │  │  │
│  │  │  │  │   User: Thanks!                              │  │  │
│  │  │+│  │                                              │  │  │
│  │  ├──┤  │   [Type your message...]          [Send]    │  │  │
│  │  │⚙│  └──────────────────────────────────────────────┘  │  │
│  │  ├──┤                                                    │  │
│  │  │🌐│                                                    │  │
│  │  └──┘                                                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│    ↑                            ↑                               │
│  Vertical                   Single ChatView                     │
│  Sidebar                    (active conversation)               │
│  - C1,C2,C3: Open conversations                                 │
│  - +: New conversation                                          │
│  - ⚙: Settings window                                           │
│  - 🌐: Browser window                                           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│          Settings/Knowledge/History (Separate Windows)          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  AppBar: [Settings]                      [− □ ×]         │  │
│  ├───────────────────────────────────────────────────────────┤  │
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
   - **Chat Windows**: Single WebContents with vertical sidebar for conversation switching
   - **Tool Windows** (Settings/Knowledge/History): Single WebContents, separate windows
   - **Browser Windows**: Keep existing Shell + WebContentsView architecture (security isolation)

2. **UI Layout**:
   - **AppBar**: Retained at top with window title and window controls (minimize/maximize/close)
   - **Vertical Sidebar**: Replaces horizontal tabs, shows open conversations
   - **Sidebar Bottom**: Settings and Browser window entry points
   - **ThreadsView**: Separate floating sidebar for historical conversations archive

3. **Conversation Management**:
   - Sidebar tabs = open conversation sessions (work area)
   - ThreadsView = historical conversations archive (different concept)
   - Conversation switching = changing active conversation ID in ChatView
   - No Vue Router needed (single view, multiple conversations)

4. **State Management**: Single Pinia chat store with active conversation ID

---

## 3. Technical Design

### 3.1 Window Creation Flow

#### Chat Window

**Architecture**:
- Create single BrowserWindow with unified renderer
- Load main application entry point (index.html)
- Window type marked as 'chat' for routing purposes
- Optional: Pass initial conversation ID via IPC after load

**Window Configuration**:
- Default size: 1200x800
- Preload script enabled for IPC bridge
- Single WebContents (no WebContentsView children)

#### Tool Windows (Settings, Knowledge, History)

**Architecture**:
- Create separate BrowserWindow for each tool type
- Each loads dedicated HTML entry point (settings.html, knowledge.html, history.html)
- Window type marked as 'tool' for routing purposes
- Independent lifecycle from chat windows

**Window Configuration**:
- Settings: 900x700
- Knowledge/History: 1200x700
- Preload script enabled for IPC bridge
- Single WebContents per window

#### Browser Window (Unchanged)

**Architecture**:
- Keep existing Shell + WebContentsView architecture
- Shell WebContents for AppBar and controls
- Multiple WebContentsView children for external web pages
- Security isolation maintained (no preload in WebContentsView)

### 3.2 Renderer Architecture

#### 3.2.1 Directory Structure

**New Structure**:
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
│   ├── App.vue               # Chat window root (Vertical Sidebar + ChatView)
│   ├── SettingsApp.vue       # Settings window root
│   ├── KnowledgeApp.vue      # Knowledge window root
│   ├── HistoryApp.vue        # History window root
│   ├── views/                # Main views
│   │   ├── ChatView.vue
│   │   ├── SettingsView.vue
│   │   ├── KnowledgeBaseView.vue
│   │   └── HistoryView.vue
│   ├── components/           # Shared components
│   │   ├── VerticalSidebar.vue    # NEW: Vertical conversation sidebar
│   │   ├── ConversationTab.vue    # NEW: Single conversation tab item
│   │   ├── ThreadsView.vue        # Historical conversations archive
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

**Key Changes**:
- No router/ directory needed - chat window manages conversations via state
- Shell directory kept only for browser windows
- Multiple HTML entry points for different window types

#### 3.2.2 Chat Window Layout

**Component Structure**:
- **App.vue**: Root component with AppBar + Vertical Sidebar + ChatView
- **AppBar**: Window title and window controls (minimize/maximize/close)
- **VerticalSidebar**:
  - Top section: List of open conversation tabs
  - Bottom section: New conversation button, Settings button, Browser button
- **ChatView**: Main content area displaying active conversation

**State Management**:
- Active conversation ID tracked in Pinia chat store
- Conversation switching updates active ID
- ChatView receives conversation ID as prop and loads appropriate data

**Data Flow**:
1. User clicks conversation tab in sidebar
2. Sidebar emits tab-click event with conversation ID
3. App.vue updates active conversation ID in store
4. ChatView re-renders with new conversation data

#### 3.2.3 VerticalSidebar Component

**Component Responsibilities**:
- Display list of open conversation tabs
- Handle tab click events (switch conversation)
- Handle tab close events (close conversation)
- Provide new conversation button
- Provide Settings and Browser window entry points

**Layout Structure**:
- Top: Scrollable list of conversation tabs
- Bottom: Fixed controls (New, Settings, Browser)

**Interaction with Main Process**:
- Settings button: Calls WindowPresenter.createToolWindow('settings')
- Browser button: Calls WindowPresenter.createBrowserWindow()
- Uses usePresenter composable for IPC communication

### 3.3 State Management

#### 3.3.1 Chat Store

**Store Responsibilities**:
- Manage list of open conversations in current window
- Track active conversation ID
- Provide conversation lifecycle methods (create, load, close)
- Coordinate with ConversationPresenter for persistence

**State Structure**:
```
ChatStore {
  openConversations: Conversation[]     // List of open conversation tabs
  activeConversationId: string | null   // Currently active conversation
  activeConversation: Conversation      // Computed from above
}
```

**Key Operations**:
- **createConversation()**: Create new conversation, add to open list, set as active
- **loadConversation(id)**: Load conversation from database, add to open list if not already open
- **setActiveConversation(id)**: Switch active conversation
- **closeConversation(id)**: Remove from open list, switch to adjacent if was active

**Difference from Current Architecture**:
- No need for tab-scoped state (no Vue Router, no multiple views)
- Conversation switching = updating activeConversationId
- ChatView component receives conversationId as prop and loads appropriate data
- All conversations share same Pinia store instance

### 3.4 Main Process Changes

#### 3.4.1 Simplified TabPresenter

**Scope Reduction**:
- TabPresenter now only manages Browser window tabs
- Chat window conversations are managed in Renderer via Pinia store
- Removes complex WebContentsView lifecycle management for chat windows

**Retained Responsibilities** (Browser windows only):
- Create/destroy WebContentsView for browser tabs
- Manage browser tab switching and visibility
- Handle browser tab reordering
- Coordinate browser tab state with WindowPresenter

**Removed Responsibilities** (Chat windows):
- No longer creates WebContentsView for chat conversations
- No longer manages chat tab lifecycle
- No longer maintains WebContentsId → TabId mapping for chat windows
- No longer handles chat tab switching via IPC

**Architecture Impact**:
- Significant code reduction (~67% LOC reduction)
- Simpler state management (browser tabs only)
- Clearer separation of concerns

#### 3.4.2 WindowPresenter Changes

**New Methods**:
- **createChatWindow(options)**: Create single WebContents chat window
- **createToolWindow(toolType)**: Create Settings/Knowledge/History windows

**Modified Methods**:
- **createShellWindow()**: Now only creates browser windows (windowType: 'browser')

**Window Type Management**:
- Track window types: 'chat', 'tool', 'browser'
- Route IPC events based on window type
- Simplified context tracking (no WebContentsId mapping for chat windows)

### 3.5 IPC Simplification

#### 3.5.1 Current Architecture (Before)

**Complexity**:
- Renderer needs to identify which tab it is via WebContentsId
- Main process maintains complex WebContentsId → TabId → WindowId mapping
- IPC handler must resolve context for every call
- Tab routing adds latency and complexity

**Context Resolution Flow**:
1. Renderer calls presenter method
2. IPC handler receives event with sender WebContentsId
3. Look up TabId from WebContentsId
4. Look up WindowId from TabId
5. Execute method with resolved context

#### 3.5.2 New Architecture (After)

**Simplification**:
- Chat windows: Direct window-level IPC (no tab routing needed)
- Main process only needs to identify BrowserWindow
- Simpler context tracking (windowId only for chat windows)
- Reduced IPC latency

**Context Resolution Flow** (Chat windows):
1. Renderer calls presenter method
2. IPC handler receives event with sender WebContents
3. Get BrowserWindow from WebContents
4. Execute method with window context

**Browser Windows**:
- Keep existing tab routing for WebContentsView tabs
- No change to browser window IPC architecture

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

**TabPresenter** (for chat windows):
- `createTab()` - No longer needed, conversations managed in renderer
- `switchTab()` - Replaced by conversation state management
- `closeTab()` - Replaced by conversation store methods
- `reorderTabs()` - May add back for conversation reordering
- `moveTab()` - Complex, deferred to Phase 2

### A.2 New APIs

**WindowPresenter**:
- `createChatWindow(options)` - Create single WebContents chat window
  - Options: initialConversationId, width, height
- `createToolWindow(toolType)` - Create Settings/Knowledge/History windows
  - toolType: 'settings' | 'knowledge' | 'history'

**ConversationPresenter** (Renderer):
- Conversation lifecycle methods exposed via Pinia store
- No direct IPC routing needed for conversation switching

### A.3 Modified APIs

**WindowPresenter.createShellWindow()**:
- Now only creates browser windows (windowType: 'browser')
- 'chat' window type removed, use createChatWindow() instead

---

## Appendix B: UI Mockups

### B.1 Chat Window Layout

```
┌─────────────────────────────────────────────────────────────┐
│  AppBar: [DeepChat]                            [− □ ×]      │
├─────────────────────────────────────────────────────────────┤
│ ┌──┐ ┌─────────────────────────────────────────────────┐   │
│ │C1│ │  Conversation: "Planning DeepChat Refactor"     │   │
│ │  │ ├─────────────────────────────────────────────────┤   │
│ ├──┤ │                                                 │   │
│ │C2│ │  User: Let's refactor the window architecture   │   │
│ │  │ │  Assistant: Great idea! Here's my analysis...   │   │
│ ├──┤ │  User: Can you create a spec document?          │   │
│ │C3│ │  Assistant: Of course! I'll write...            │   │
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
Vertical Sidebar          Single ChatView
(open conversations)      (active conversation content)

Legend:
- AppBar: Window title and controls (minimize/maximize/close)
- C1, C2, C3: Open conversation tabs (work area)
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
