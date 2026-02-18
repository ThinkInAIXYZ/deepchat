# New UI Feature Implementation Plan

This document defines the technical plan for implementing complete functionality on the new UI architecture, without considering legacy compatibility migration, based on entirely new code implementation.

---

## 1. Architecture Overview

### 1.1 Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ChatTabView (Entry)                      │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  WelcomePage      │  Displayed when no Provider config  ││
│  ├─────────────────────────────────────────────────────────┤│
│  │  NewThreadPage    │  Displayed when creating new session││
│  ├─────────────────────────────────────────────────────────┤│
│  │  ChatPage         │  Displayed during active session    ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │  WindowSideBar    │  Agent filter + Session list        ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Core Principles

1. **Unidirectional Data Flow**: Store → Composable → Component
2. **State Machine Driven**: Page transitions controlled by PageState state machine
3. **Presenter Pattern**: All business logic handled through Main process Presenters
4. **Reactive Design**: Components only handle UI rendering, state managed by Stores

---

## 2. Directory Structure

```
src/renderer/src/
├── views/
│   └── ChatTabView.vue              # Page entry, state machine logic
├── pages/                           # Page components (new directory)
│   ├── WelcomePage.vue              # Welcome page
│   ├── NewThreadPage.vue            # New thread page
│   └── ChatPage.vue                 # Chat page
├── components/
│   ├── sidebar/                     # Sidebar components (new directory)
│   │   ├── AgentFilter.vue          # Agent filter
│   │   ├── SessionGroup.vue         # Session group
│   │   ├── SessionItem.vue          # Session item
│   │   └── SidebarActions.vue       # Sidebar action buttons
│   ├── chat/                        # Chat related components (new directory)
│   │   ├── ChatTopBar.vue           # Chat top bar
│   │   ├── MessageList.vue          # Message list
│   │   ├── MessageItem.vue          # Message item
│   │   ├── ChatInput.vue            # Input box
│   │   ├── InputToolbar.vue         # Input toolbar
│   │   └── ChatStatusBar.vue        # Status bar
│   └── common/                      # Common components
│       ├── ProjectSelector.vue      # Project selector
│       ├── ModelSelector.vue        # Model selector
│       └── PermissionSelector.vue   # Permission selector
├── stores/
│   ├── ui/                          # UI related Stores (new directory)
│   │   ├── pageState.ts             # Page state machine
│   │   ├── agent.ts                 # Agent management
│   │   ├── session.ts               # Session management
│   │   └── project.ts               # Project management
│   └── chat.ts                      # Retained, message related logic
├── composables/
│   ├── usePageState.ts              # Page state management
│   ├── useAgentFilter.ts            # Agent filter logic
│   ├── useSessionGroup.ts           # Session grouping logic
│   └── useProjectRecent.ts          # Recent projects logic
└── types/
    └── ui.ts                        # UI type definitions
```

---

## 3. State Management Layer

### 3.1 Page State Machine (pageState.ts)

**Responsibility**: Manage global page state, control page transition logic

**State Definition**:
```typescript
type PageState = 
  | { type: 'welcome' }
  | { type: 'newThread' }
  | { type: 'chat'; sessionId: string }
```

**State Transition Triggers**:
- On startup, check Provider config → welcome / newThread
- Create session → chat
- Switch session → chat (update sessionId)
- Close session → newThread
- Delete last Provider → welcome

**Implementation Points**:
- Use Pinia store to manage state
- Provide `transitionTo(state)` method
- Provide `initialize()` method for startup initialization

### 3.2 Agent Store (agent.ts)

**Responsibility**: Manage Agent list and Agent filter state

**Data Structure**:
```typescript
interface Agent {
  id: string
  name: string
  type: 'deepchat' | 'acp'
  enabled: boolean
  icon?: string
}

interface AgentState {
  agents: Agent[]
  selectedAgentId: string | null  // null means "All Agents"
  loading: boolean
}
```

**Data Sources**:
- DeepChat Agent: Always exists
- ACP Agents: Get from `configPresenter.getAcpAgents()`

### 3.3 Session Store (session.ts)

**Responsibility**: Manage session list and session grouping

**Data Structure**:
```typescript
interface Session {
  id: string
  title: string
  agentId: string
  status: 'completed' | 'working' | 'error' | 'none'
  projectDir: string
  providerId?: string
  modelId?: string
  activeSkills?: string[]
  createdAt: number
  updatedAt: number
}

type SessionGroup = 
  | { type: 'time'; label: string; sessions: Session[] }
  | { type: 'project'; project: Project; sessions: Session[] }

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  groupByProject: boolean
  loading: boolean
}
```

**Key Actions**:
- `fetchSessions()`: Get session list from sessionPresenter
- `createSession(settings)`: Create new session
- `selectSession(id)`: Select session
- `closeSession()`: Close current session
- `toggleGroupMode()`: Toggle grouping mode

### 3.4 Project Store (project.ts)

**Responsibility**: Manage recent project list

**Data Structure**:
```typescript
interface Project {
  path: string
  name: string
  lastAccessedAt: number
  sessionCount: number
}

interface ProjectState {
  projects: Project[]
  loading: boolean
}
```

**Data Sources**:
- Aggregated from session list
- Support manual addition via folder picker

---

## 4. Page Component Layer

### 4.1 ChatTabView.vue

**Responsibility**: Page entry, render corresponding page based on PageState

**Implementation**:
```vue
<template>
  <div class="flex h-full">
    <WindowSideBar />
    <div class="flex-1 flex flex-col">
      <WelcomePage v-if="pageState.type === 'welcome'" />
      <NewThreadPage v-else-if="pageState.type === 'newThread'" />
      <ChatPage v-else :session-id="pageState.sessionId" />
    </div>
  </div>
</template>
```

**Initialization Flow**:
1. Call `pageState.initialize()` on component mount
2. Check Provider configuration
3. Check if there's an active session
4. Determine initial page state

### 4.2 WelcomePage.vue

**Responsibility**: Guide user to configure first Provider

**Data Dependencies**:
- ProviderStore: Get recommended Provider list

**Interactions**:
- Click Provider → Call `windowPresenter.openOrFocusSettingsTab()`
- Click ACP Agent entry → Same as above

### 4.3 NewThreadPage.vue

**Responsibility**: New session entry

**Data Dependencies**:
- ProjectStore: Recent project list
- AgentStore: Agent selection
- ModelStore: Model selection (DeepChat Agent only)

**Subcomponents**:
- ProjectSelector: Project/folder selection
- ChatInput: Message input
- ChatStatusBar: Model/permission configuration

**Interactions**:
- Send message → Call `sessionStore.createSession()` → Page transitions to ChatPage

### 4.4 ChatPage.vue

**Responsibility**: Main interface during active session

**Data Dependencies**:
- SessionStore: Current session info
- ChatStore: Message list

**Subcomponents**:
- ChatTopBar: Title, project, share, more actions
- MessageList: Message rendering
- ChatInput: Message input
- ChatStatusBar: Current configuration display

---

## 5. Sidebar Component Layer

### 5.1 WindowSideBar.vue Refactoring

**Structure**:
```
┌─────────────────────────────────┐
│ AgentFilter (icon column)       │
│   - All Agents                  │
│   - DeepChat                    │
│   - Claude Code                 │
│   - ...                         │
├─────────────────────────────────┤
│ SessionList                     │
│   - SessionGroup (Today)        │
│     - SessionItem               │
│     - SessionItem               │
│   - SessionGroup (Yesterday)    │
│     - SessionItem               │
├─────────────────────────────────┤
│ SidebarActions                  │
│   - New Chat                    │
│   - Toggle Group Mode           │
│   - Collapse                    │
│   - Browser                     │
│   - Settings                    │
└─────────────────────────────────┘
```

**Implementation**:
- Split into independent subcomponents
- Share state via composables
- Support collapsed/expanded modes

### 5.2 AgentFilter.vue

**Responsibility**: Agent icon list, filter sessions

**Props**: None (get data from AgentStore)

**Events**:
- `@select`: Triggered when Agent is selected

### 5.3 SessionGroup.vue

**Responsibility**: Session group display

**Props**:
- `group: SessionGroup`: Group data

**Slots**:
- `default`: SessionItem rendering

### 5.4 SessionItem.vue

**Responsibility**: Single session item rendering

**Props**:
- `session: Session`: Session data
- `active: boolean`: Whether active

**Events**:
- `@click`: Click session

---

## 6. Chat Component Layer

### 6.1 ChatTopBar.vue

**Responsibility**: Chat top info bar

**Props**:
- `title: string`: Session title
- `projectPath: string`: Project path

**Slots**:
- Right action buttons area

### 6.2 MessageList.vue

**Responsibility**: Message list rendering

**Key Features**:
- Virtual scrolling support (large message count optimization)
- Scroll to specific message
- Message preloading

**Implementation Points**:
- Reuse core logic from existing `MessageList.vue`
- Adapt to new data structures

### 6.3 ChatInput.vue

**Responsibility**: Message input area

**Key Features**:
- @ mention files
- / commands
- Multi-line input
- Attachment upload

**Implementation Points**:
- Reuse existing `ChatInput.vue` component
- Adapt to new page structure

---

## 7. Development Phases

### Phase 1: Basic Framework (1-2 weeks)

**Goal**: Build page skeleton and state management

**Tasks**:
1. Create directory structure
2. Implement `pageState.ts` state machine
3. Implement `agent.ts` Store
4. Implement basic `session.ts` Store structure
5. Refactor `ChatTabView.vue` page switching logic
6. Create `WelcomePage.vue` static page

**Acceptance Criteria**:
- Pages correctly display Welcome / NewThread / Chat states
- State transition logic is correct

### Phase 2: Sidebar Functionality (1-2 weeks)

**Goal**: Complete sidebar interaction

**Tasks**:
1. Refactor `WindowSideBar.vue`
2. Implement `AgentFilter.vue`
3. Implement `SessionGroup.vue` / `SessionItem.vue`
4. Implement `useSessionGroup.ts` grouping logic
5. Implement `project.ts` Store
6. Implement `SidebarActions.vue`

**Acceptance Criteria**:
- Sidebar correctly displays Agent filter
- Session list grouped by time/project
- Clicking session correctly switches page

### Phase 3: NewThread Page (1 week)

**Goal**: Complete new session functionality

**Tasks**:
1. Implement `ProjectSelector.vue`
2. Implement permission selector
3. Integrate ChatInput component
4. Implement session creation logic

**Acceptance Criteria**:
- Can select project/folder
- Can select Agent and model
- Session is created and navigates correctly after sending message

### Phase 4: Chat Page (1-2 weeks)

**Goal**: Complete session interaction

**Tasks**:
1. Implement `ChatTopBar.vue`
2. Integrate existing `MessageList.vue`
3. Integrate existing `ChatInput.vue`
4. Implement `ChatStatusBar.vue`
5. Implement message send/receive logic

**Acceptance Criteria**:
- Chat page correctly displays title and project
- Message list renders correctly
- Can send and receive messages

### Phase 5: Optimization & Polish (1 week)

**Goal**: Performance optimization and detail refinement

**Tasks**:
1. Performance optimization (virtual scrolling, lazy loading)
2. Animation transition effects
3. Error handling and edge cases
4. Internationalization support

---

## 8. Data Flow Design

### 8.1 Initialization Flow

```
App Mounted
    │
    ▼
pageState.initialize()
    │
    ├── providerStore.hasEnabledProviders()?
    │       │
    │       ├── No → transitionTo('welcome')
    │       │
    │       └── Yes ↓
    │
    ├── sessionStore.hasActiveSession()?
    │       │
    │       ├── Yes → transitionTo('chat', sessionId)
    │       │
    │       └── No → transitionTo('newThread')
    │
    └── agentStore.fetchAgents()
            projectStore.fetchProjects()
```

### 8.2 Create Session Flow

```
NewThreadPage: User sends message
    │
    ▼
sessionStore.createSession(settings)
    │
    ├── Call sessionPresenter.createConversation()
    │
    ├── Update local sessions list
    │
    └── pageState.transitionTo('chat', newSessionId)
            │
            ▼
        ChatPage renders
            │
            ▼
        agentPresenter.sendMessage()
```

### 8.3 Session Switch Flow

```
Sidebar: Click session item
    │
    ▼
sessionStore.selectSession(id)
    │
    ├── Call sessionPresenter.setActiveConversation()
    │
    └── pageState.transitionTo('chat', id)
```

---

## 9. Relationship with Existing Code

### 9.1 Reusable Components

| Component | Reuse Level | Notes |
|-----------|-------------|-------|
| ChatInput.vue | High reuse | Core input logic unchanged, adapt to new structure |
| MessageList.vue | High reuse | Message rendering logic unchanged |
| MessageItem*.vue | High reuse | Message item components unchanged |
| MarkdownRenderer.vue | Full reuse | No modification needed |
| Artifact*.vue | Full reuse | No modification needed |

### 9.2 Reusable Stores

| Store | Reuse Level | Notes |
|-------|-------------|-------|
| chat.ts | Partial reuse | Message logic retained, session management migrated to new session.ts |
| providerStore.ts | Full reuse | No modification needed |
| modelStore.ts | Full reuse | No modification needed |

### 9.3 New vs Modified

**New**:
- `stores/ui/pageState.ts`
- `stores/ui/agent.ts`
- `stores/ui/session.ts`
- `stores/ui/project.ts`
- `pages/*.vue`
- `components/sidebar/*.vue`
- `components/chat/*.vue` (partial)

**Modified**:
- `ChatTabView.vue`: Refactor page switching logic
- `WindowSideBar.vue`: Refactor sidebar structure
- `chat.ts`: Remove session management logic, keep message logic

**Deprecated**:
- `components/mock/*.vue`: Mock components can be deleted after completion
- `composables/useMockViewState.ts`: Mock state management can be deleted

---

## 10. Testing Strategy

### 10.1 Unit Tests

**Store Tests**:
- `pageState.ts`: State transition logic
- `session.ts`: Session CRUD operations
- `agent.ts`: Agent filter logic

**Composable Tests**:
- `useSessionGroup.ts`: Grouping calculation logic

### 10.2 Component Tests

- `WelcomePage.vue`: Snapshot test
- `NewThreadPage.vue`: Interaction test
- `ChatPage.vue`: Interaction test
- `SessionItem.vue`: Render test

### 10.3 Integration Tests

- Complete session creation flow
- Session switch flow
- Page state transition flow

---

## 11. Risks and Considerations

### 11.1 Risk Points

| Risk | Impact | Mitigation |
|------|--------|------------|
| Increased state management complexity | Medium | Use Pinia devtools for debugging |
| Page switching performance | Low | Use keep-alive to cache page state |
| Conflict with existing code | Medium | Create new files, gradual migration |
| Missing i18n | Low | Add i18n keys during development |

### 11.2 Considerations

1. **Progressive Migration**: Build new structure first, then gradually migrate functionality
2. **Maintain Compatibility**: Keep old UI available until new UI is complete
3. **Performance First**: Use virtual scrolling for large lists
4. **Type Safety**: Use TypeScript strict mode for all new code

---

## 12. Summary

This plan is based on the product architecture defined in `ui-architecture.md`, using a clear layered design:

1. **State Layer**: 4 core Stores managing page, Agent, session, and project states
2. **Page Layer**: 3 page states, driven by state machine transitions
3. **Component Layer**: Fine-grained component splitting for sidebar and chat areas

Development cycle estimated at 6-8 weeks, implemented progressively in 5 phases.
