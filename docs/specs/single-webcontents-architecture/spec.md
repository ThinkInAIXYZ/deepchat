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
   - **Settings Window**: Keeps current independent window architecture (no changes needed)
   - **Browser Windows**: Keep existing Shell + WebContentsView architecture (security isolation)

2. **UI Layout**:
   - **AppBar**: Retained at top with window title and window controls (minimize/maximize/close)
   - **Vertical Sidebar**: Replaces horizontal tabs, shows open conversations
   - **Sidebar Bottom**: Settings and Browser window entry points
   - **ThreadsView**: Floating sidebar for historical conversations archive (keeps current behavior)

3. **Conversation Management**:
   - Sidebar tabs = open conversation sessions (work area)
   - ThreadsView = historical conversations archive (different concept)
   - Conversation switching = Vue Router navigation to `/conversation/:id`
   - Vue Router manages active conversation state via route params

4. **State Management**: Pinia chat store + Vue Router for conversation navigation

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

#### Settings Window (Unchanged)

**Architecture**:
- Keeps current independent window architecture
- No changes needed for this migration

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
├── src/
│   ├── main.ts               # Chat window initialization
│   ├── App.vue               # Chat window root (Vertical Sidebar + RouterView)
│   ├── router/               # Vue Router configuration
│   │   └── index.ts          # Routes: /conversation/:id, /new, etc.
│   ├── views/                # Main views
│   │   ├── ChatView.vue      # Conversation view (receives id from route)
│   │   └── SettingsView.vue  # (unchanged, for Settings window)
│   ├── components/           # Shared components
│   │   ├── VerticalSidebar.vue    # NEW: Vertical conversation sidebar
│   │   ├── ConversationTab.vue    # NEW: Single conversation tab item
│   │   ├── ThreadsView.vue        # Historical conversations archive (unchanged)
│   │   └── ...
│   ├── stores/               # Pinia stores
│   │   ├── app.ts           # App-level state
│   │   ├── chat.ts          # Chat state (open conversations list)
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
- Vue Router added for conversation navigation (`/conversation/:id`)
- Shell directory kept only for browser windows

#### 3.2.2 Chat Window Layout

**Component Structure**:
- **App.vue**: Root component with AppBar + Vertical Sidebar + RouterView
- **AppBar**: Window title and window controls (minimize/maximize/close)
- **VerticalSidebar**:
  - Top section: List of open conversation tabs
  - Bottom section: New conversation button, Settings button, Browser button
- **RouterView**: Renders ChatView based on current route

**State Management**:
- Open conversations list tracked in Pinia chat store
- Active conversation determined by Vue Router route params (`/conversation/:id`)
- ChatView receives conversation ID from `useRoute().params.id`

**Data Flow**:
1. User clicks conversation tab in sidebar
2. Sidebar calls `router.push('/conversation/:id')`
3. Vue Router updates URL and renders ChatView
4. ChatView loads conversation data based on route param

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
- Settings button: Calls WindowPresenter.openSettingsWindow()
- Browser button: Calls WindowPresenter.createBrowserWindow()
- Uses usePresenter composable for IPC communication

### 3.3 State Management

#### 3.3.1 Vue Router Configuration

**Route Structure**:
```typescript
const routes = [
  {
    path: '/',
    redirect: '/new'
  },
  {
    path: '/new',
    name: 'new-conversation',
    component: ChatView  // Empty state, ready for new conversation
  },
  {
    path: '/conversation/:id',
    name: 'conversation',
    component: ChatView  // Loads conversation by id
  }
]
```

**Router Mode**:
- Use `createWebHashHistory()` for Electron compatibility
- URLs will be like `index.html#/conversation/abc123`

**Navigation Guards**:
- Before each navigation, ensure conversation exists in open list
- If navigating to closed conversation, add it to open list first

#### 3.3.2 Chat Store

**Store Responsibilities**:
- Manage list of open conversations in current window
- Provide conversation lifecycle methods (create, load, close)
- Coordinate with ConversationPresenter for persistence
- Note: Active conversation is determined by Vue Router, not store

**State Structure**:
```
ChatStore {
  openConversations: Conversation[]     // List of open conversation tabs
  // activeConversationId derived from router.currentRoute.params.id
}
```

**Key Operations**:
- **createConversation()**: Create new conversation, add to open list, navigate to it
- **openConversation(id)**: Add to open list if not already open, navigate to it
- **closeConversation(id)**: Remove from open list, navigate to adjacent if was active

**Difference from Current Architecture**:
- Active conversation state moved from store to Vue Router
- Conversation switching = `router.push('/conversation/:id')`
- ChatView component receives conversationId from route params
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

**Modified Methods**:
- **createShellWindow()**: Now only creates browser windows (windowType: 'browser')

**Window Type Management**:
- Track window types: 'chat', 'settings', 'browser'
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

- [ ] Create VerticalSidebar and ConversationTab components
- [ ] Set up Vue Router with conversation routes (`/new`, `/conversation/:id`)
- [ ] Update chat store for conversation tab management (open list only)
- [ ] Update build configuration if needed

#### Phase 2: Refactor Chat Window (Week 3-4)

- [ ] Merge shell and main renderer into unified App.vue
- [ ] Implement conversation tab switching logic
- [ ] Update ChatView to work with conversationId prop
- [ ] Test conversation switching and tab management

#### Phase 3: Refactor Main Process (Week 5-6)

- [ ] Simplify TabPresenter (remove chat window logic)
- [ ] Add WindowPresenter.createChatWindow()
- [ ] Remove unused WebContentsView code for chat windows
- [ ] Update EventBus routing logic

#### Phase 4: Update IPC Layer (Week 7)

- [ ] Simplify IPC context tracking (no WebContentsId mapping for chat)
- [ ] Update presenter call handlers
- [ ] Test IPC communication across all window types
- [ ] Remove obsolete IPC channels

#### Phase 5: Testing & Polish (Week 8-9)

- [ ] End-to-end testing
- [ ] Performance benchmarking
- [ ] Memory profiling
- [ ] Fix edge cases
- [ ] Documentation updates

#### Phase 6: Deploy (Week 10)

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
| Main Renderer | ~15000 | ~15500 (+ vertical sidebar) | **↑ 3%** |
| **Total** | ~18700 | ~17300 | **↓ 7%** |

**Note**: Complexity reduction is moderate because we're not adding Vue Router overhead, just simpler conversation state management.

### 5.3 User Experience

**Improvements**:
- ✅ Faster conversation switching (imperceptible)
- ✅ Simpler mental model (vertical sidebar = conversations)
- ✅ More responsive UI (less IPC overhead)

**Potential Issues**:
- ⚠️ Conversation state management complexity (mitigated by Pinia store)

---

## 6. Risk Assessment

### 6.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Conversation state not properly cleaned up** | Medium | Medium | Implement proper cleanup in closeConversation(), memory profiling |
| **IPC simplification breaks features** | Low | High | Incremental migration, feature flags, thorough testing |
| **Performance regression** | Very Low | Medium | Performance benchmarking, profiling |

### 6.2 Migration Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Feature regressions** | Medium | High | Extensive QA testing, beta release cycle |
| **User data loss** | Very Low | Critical | No database changes, state migration testing |
| **Breaking third-party integrations** | Low | Medium | API compatibility layer, version negotiation |
| **Development timeline overrun** | Medium | Medium | Phased migration, clear milestones, rollback plan |

---

## 7. Open Questions

### 7.1 Design Decisions (Resolved)

- [x] **Q1**: Should conversation tabs support drag-and-drop reordering?
  - **Decision**: Yes, support it but low priority (not MVP)

- [x] **Q2**: How to handle ACP workspace?
  - **Decision**: Workspace belongs to conversation, each conversation can set workdir. No isolation needed.

- [x] **Q3**: Should we support tearing off conversation tabs into new windows?
  - **Decision**: Yes, support it but low priority. New window should be lightweight (not full-featured).

- [x] **Q4**: Window types clarification
  - **Decision**:
    - Settings: Independent window (keeps current behavior, no changes needed)
    - History: Floating panel triggered by AppBar (keeps current behavior, no changes needed)
    - Knowledge: Does not exist (removed from spec)

### 7.2 Technical Questions (Resolved)

- [x] **Q5**: How many conversation tabs should be kept in memory simultaneously?
  - **Decision**: No limit. Keep all open conversations in memory.

- [x] **Q6**: Should tool windows share the same renderer code or have separate builds?
  - **Decision**: Not applicable. Only Settings window exists and it keeps current architecture.

- [x] **Q7**: How to handle deep linking to specific conversations?
  - **Decision**: Not needed for now.

---

## 8. Success Criteria

### 8.1 MVP Requirements

- ✅ Chat windows use single WebContents with vertical sidebar for conversations
- ✅ Settings window keeps current independent architecture (no changes)
- ✅ History panel keeps current floating behavior (no changes)
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

### B.2 Browser Window (Unchanged Architecture)

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
