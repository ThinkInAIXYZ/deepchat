# New UI Implementation Development Tracker

## Overview

This document tracks the development progress of new UI feature implementation. All implementations must match the mock interface exactly.

**Architecture Design**: [new-ui-implementation-plan.md](../../architecture/new-ui-implementation-plan.md)

## Mock Reference File List

| Mock File | Purpose | Target Replacement |
|-----------|---------|-------------------|
| `components/mock/MockWelcomePage.vue` | Welcome page | `pages/WelcomePage.vue` |
| `components/NewThreadMock.vue` | NewThread page | `pages/NewThreadPage.vue` |
| `components/mock/MockChatPage.vue` | Chat page | `pages/ChatPage.vue` |
| `components/mock/MockTopBar.vue` | Top bar | `components/chat/ChatTopBar.vue` |
| `components/mock/MockMessageList.vue` | Message list | `components/chat/MessageList.vue` |
| `components/mock/MockInputBox.vue` | Input box | `components/chat/ChatInputBox.vue` |
| `components/mock/MockInputToolbar.vue` | Input toolbar | `components/chat/ChatInputToolbar.vue` |
| `components/mock/MockStatusBar.vue` | Status bar | `components/chat/ChatStatusBar.vue` |
| `components/WindowSideBar.vue` | Sidebar | (refactored in place) |
| `composables/useMockViewState.ts` | State management | Replaced by stores |

---

## Specs List

| Spec | File |
|------|------|
| Page Router | [spec.md](../new-ui-page-state/spec.md) |
| Agent Store | [spec.md](../new-ui-agent-store/spec.md) |
| Session Store | [spec.md](../new-ui-session-store/spec.md) |
| Project Store | [spec.md](../new-ui-project-store/spec.md) |
| Sidebar Components | [spec.md](../new-ui-sidebar/spec.md) |
| Chat Components | [spec.md](../new-ui-chat-components/spec.md) |
| Page Components | [spec.md](../new-ui-pages/spec.md) |

---

## Phase 1: Store Layer

### 1.1 Page Router Store

- [x] Create `stores/ui/pageRouter.ts`
- [x] Define `PageRoute` type (welcome / newThread / chat)
- [x] Implement `initialize()` — check providers, check active session
- [x] Implement `goToWelcome()`, `goToNewThread()`, `goToChat(sessionId)`
- [x] Implement `currentRoute` and `chatSessionId` getters
- [x] Listen to `CONFIG_EVENTS.PROVIDER_CHANGED`
- [x] Error handling with fallback to newThread

### 1.2 Session Store

- [x] Create `stores/ui/session.ts`
- [x] Define `UISession` type with `resolveAgentId()` mapping
- [x] Define `mapSessionStatus()` mapping
- [x] Implement `fetchSessions()` via `sessionPresenter.getSessionList()`
- [x] Implement `createSession()` — create session + send message + navigate
- [x] Implement `selectSession()` — activate session + navigate
- [x] Implement `closeSession()` — unbind tab + navigate to newThread
- [x] Implement `groupByTime()` and `groupByProject()` grouping
- [x] Implement `getFilteredGroups(agentId)` for sidebar
- [x] Implement `toggleGroupMode()`
- [x] Listen to `CONVERSATION_EVENTS.LIST_UPDATED`, `ACTIVATED`, `DEACTIVATED`
- [x] Error handling on all async actions

### 1.3 Agent Store

- [x] Create `stores/ui/agent.ts`
- [x] Define `UIAgent` type
- [x] Implement `fetchAgents()` — DeepChat + `getAcpBuiltinAgents()` + `getAcpCustomAgents()`
- [x] Implement `selectAgent(id)` toggle
- [x] Implement `enabledAgents`, `selectedAgent`, `selectedAgentName` getters
- [x] Listen to `CONFIG_EVENTS.SETTING_CHANGED`
- [x] Error handling

### 1.4 Project Store

- [x] Create `stores/ui/project.ts`
- [x] Define `UIProject` type
- [x] Implement `deriveFromSessions(sessions)` — aggregate unique projects
- [x] Implement `selectProject(path)`
- [x] Implement `openFolderPicker()` via `devicePresenter.selectDirectory()`
- [x] Error handling

**Acceptance Criteria**:
- [x] All stores manage state correctly
- [x] IPC calls map to correct presenter methods
- [x] Errors are caught and exposed via `error` ref
- [ ] Unit tests pass

---

## Phase 2: Page Components

### 2.1 ChatTabView Refactor

- [x] Remove all legacy ChatView/NewThread/Mock imports
- [x] Remove `useMockViewState` usage
- [x] Route based on `pageRouter.currentRoute`
- [x] Initialize stores on mount (parallel)
- [x] Remove ArtifactDialog margin calculation (move to ChatPage if needed)

### 2.2 WelcomePage

- [x] Create `pages/WelcomePage.vue`
- [x] Copy exact layout/classes from `MockWelcomePage.vue`
- [x] Static provider grid (6 items)
- [x] All clicks → `windowPresenter.openOrFocusSettingsTab()`
- [x] Window drag region support

### 2.3 NewThreadPage

- [x] Create `pages/NewThreadPage.vue`
- [x] Copy exact layout/classes from `NewThreadMock.vue`
- [x] Project selector from `projectStore`
- [x] Integrate ChatInputBox + ChatInputToolbar
- [x] Integrate ChatStatusBar
- [x] Submit → `sessionStore.createSession()`

### 2.4 ChatPage

- [x] Create `pages/ChatPage.vue`
- [x] Copy exact layout/classes from `MockChatPage.vue`
- [x] Props: `sessionId`
- [x] Read session data from `sessionStore.activeSession`
- [x] Integrate ChatTopBar, MessageList, ChatInputBox, ChatInputToolbar, ChatStatusBar
- [x] Submit → `agentPresenter.sendMessage()`

**Acceptance Criteria**:
- [x] Page layouts match mocks exactly
- [x] Page routing works correctly
- [x] No fallback to legacy ChatView

---

## Phase 3: Chat Components

### 3.1 ChatTopBar

- [x] Create `components/chat/ChatTopBar.vue`
- [x] Copy exact layout/classes from `MockTopBar.vue`
- [x] Props: `title`, `project`
- [x] Computed: `projectName`
- [x] Share + More buttons (placeholder actions)

### 3.2 MessageList

- [x] Create `components/chat/MessageList.vue`
- [x] Copy exact layout/classes from `MockMessageList.vue`
- [x] Read messages via props (parent provides from store)
- [x] User message style: right-aligned, `bg-muted rounded-2xl`
- [x] Assistant message style: left with avatar + model label

### 3.3 ChatInputBox

- [x] Create `components/chat/ChatInputBox.vue`
- [x] Copy exact layout/classes from `MockInputBox.vue`
- [x] v-model support
- [x] Toolbar slot
- [x] Enter to submit, Shift+Enter for newline

### 3.4 ChatInputToolbar

- [x] Create `components/chat/ChatInputToolbar.vue`
- [x] Copy exact layout/classes from `MockInputToolbar.vue`
- [x] Attach (+), Mic, Send buttons
- [x] Emit events: `send`, `attach`

### 3.5 ChatStatusBar

- [x] Create `components/chat/ChatStatusBar.vue`
- [x] Copy exact layout/classes from `MockStatusBar.vue`
- [x] Model selector → placeholder with mock data (real integration deferred)
- [x] Effort selector → placeholder with mock data
- [x] Permissions selector → placeholder for now

**Acceptance Criteria**:
- [x] All component styles match mocks exactly
- [x] Components emit correct events
- [ ] StatusBar dropdowns read/write session settings (deferred — uses placeholder data)

---

## Phase 4: Sidebar Data Integration

### 4.1 Replace Mock Data

- [x] `mockAgents` → `agentStore.enabledAgents`
- [x] `allSessions` / `mockSessionsByDate` → `sessionStore.getFilteredGroups()`
- [x] `selectedAgentId` → `agentStore.selectedAgentId`
- [x] `groupByProject` → `sessionStore.groupMode`

### 4.2 Replace Mock State

- [x] Remove `useMockViewState` import
- [x] `handleNewChat` → `sessionStore.closeSession()`
- [x] `handleSessionClick` → `sessionStore.selectSession(id)`
- [x] Remove debug toggle (welcome page toggle button)

### 4.3 Sidebar-Specific

- [x] Keep `collapsed` as local state
- [x] `filteredGroups` computed from `sessionStore.getFilteredGroups(agentStore.selectedAgentId)`

**Acceptance Criteria**:
- [x] Sidebar displays real session data from stores
- [x] Agent filter works end-to-end
- [x] Time/project grouping toggle works
- [x] Session click navigates to chat page

---

## Phase 5: Integration and Cleanup

### 5.1 End-to-End Flows

- [ ] Full session creation flow: NewThread → submit → ChatPage renders with messages
- [ ] Session switching: sidebar click → ChatPage updates
- [ ] New chat: sidebar + button → NewThreadPage
- [ ] Welcome → Settings → Provider added → NewThreadPage

### 5.2 Error Handling

- [ ] Display `sessionStore.error` in UI
- [ ] Display `agentStore.error` in UI
- [ ] Handle presenter call failures gracefully

### 5.3 Performance

- [ ] Lazy load page components in ChatTabView
- [ ] Virtual scrolling for message list (if needed)

### 5.4 Internationalization

- [ ] Add i18n keys for all user-facing strings

### 5.5 Cleanup

- [ ] Delete `components/mock/MockWelcomePage.vue`
- [ ] Delete `components/mock/MockChatPage.vue`
- [ ] Delete `components/mock/MockTopBar.vue`
- [ ] Delete `components/mock/MockMessageList.vue`
- [ ] Delete `components/mock/MockInputBox.vue`
- [ ] Delete `components/mock/MockInputToolbar.vue`
- [ ] Delete `components/mock/MockStatusBar.vue`
- [ ] Delete `components/NewThreadMock.vue`
- [ ] Delete `composables/useMockViewState.ts`

---

## Test Coverage

| Module | Status |
|--------|--------|
| Page Router Store | ⬜ |
| Session Store | ⬜ |
| Agent Store | ⬜ |
| Project Store | ⬜ |
| ChatTabView routing | ⬜ |
| WelcomePage | ⬜ |
| NewThreadPage | ⬜ |
| ChatPage | ⬜ |
| ChatTopBar | ⬜ |
| MessageList | ⬜ |
| ChatInputBox | ⬜ |
| ChatStatusBar | ⬜ |
| Sidebar integration | ⬜ |

---

## Changelog

| Date | Update |
|------|--------|
| 2025-02-18 | v2: Rewrote all specs — page router decoupled from session, IPC mapping added, error handling, no legacy fallback |
| 2026-02-18 | v3: Phase 1–4 implemented — 4 stores, 5 chat components, 3 pages, ChatTabView refactored, sidebar integrated with stores. Typecheck/lint/format pass. Phase 5 (E2E testing, error display, i18n, mock cleanup) pending. |
