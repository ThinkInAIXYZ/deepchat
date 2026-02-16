# Phase 3 Tasks: WindowSideBar Refactor

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Completed

## Style Checklist

在开始实现前，确保理解并遵循以下样式规范：

- [ ] 阅读 `src/renderer/src/components/WindowSideBar.vue` 源码
- [ ] 理解 Agent Icon 按钮样式 (w-9 h-9 rounded-xl)
- [ ] 理解 Session Item 样式 (px-2 py-1.5 rounded-md)
- [ ] 理解 Group 标题样式 (text-xs font-medium text-muted-foreground)
- [ ] 理解折叠/展开动画 (transition-all duration-200)

---

## 1. Agent Store

- [ ] Create `src/renderer/src/stores/agent.ts`
  - [ ] `agents` ref for agent list
  - [ ] `selectedAgentId` ref
  - [ ] `loading` ref
  - [ ] `selectedAgent` computed
  - [ ] `templateAgents` computed
  - [ ] `acpAgents` computed
  - [ ] `loadAgents()` function
  - [ ] `selectAgent(id)` function

## 2. Session List Composable

- [ ] Create `src/renderer/src/composables/useSessionList.ts`
  - [ ] `allSessions` ref
  - [ ] `groupBy` ref ('project' | 'time')
  - [ ] `searchQuery` ref
  - [ ] `filteredSessions` computed (by agent + search)
  - [ ] `groupedSessions` computed
  - [ ] `groupByProject()` function
  - [ ] `groupByTime()` function
  - [ ] `loadSessions()` function
  - [ ] `refreshSessions()` function

## 3. Sidebar Components Structure

- [ ] Create sidebar components directory `src/renderer/src/components/sidebar/`

## 4. AgentPanel Component

- [ ] Create `src/renderer/src/components/sidebar/AgentPanel.vue`
  - [ ] 48px fixed width layout
  - [ ] Agent icon list
  - [ ] Scrollable if many agents
  - [ ] Create new agent button at bottom

- [ ] Create `src/renderer/src/components/sidebar/AgentIconItem.vue`
  - [ ] Icon display
  - [ ] Active state styling
  - [ ] Tooltip with agent name
  - [ ] Status indicator for ACP agents
  - [ ] Click handler

## 5. SessionPanel Component

- [ ] Create `src/renderer/src/components/sidebar/SessionPanel.vue`
  - [ ] 240px default width (resizable optional)
  - [ ] Search bar at top
  - [ ] Group toggle
  - [ ] Session list
  - [ ] New chat button

- [ ] Create `src/renderer/src/components/sidebar/SessionSearchBar.vue`
  - [ ] Search input
  - [ ] Clear button
  - [ ] Debounced search

- [ ] Create `src/renderer/src/components/sidebar/SessionGroupToggle.vue`
  - [ ] Project button
  - [ ] Time button
  - [ ] Active state styling

## 6. SessionList Component

- [ ] Create `src/renderer/src/components/sidebar/SessionList.vue`
  - [ ] Render grouped or flat list
  - [ ] Virtual scrolling for performance
  - [ ] Empty state

- [ ] Create `src/renderer/src/components/sidebar/SessionGroup.vue`
  - [ ] Collapsible header
  - [ ] Expand/collapse animation
  - [ ] Session items

- [ ] Create `src/renderer/src/components/sidebar/SessionItem.vue`
  - [ ] Session title
  - [ ] Timestamp
  - [ ] Hover actions (delete, pin)
  - [ ] Active state styling
  - [ ] Right-click context menu

## 7. WindowSideBar Refactor

- [ ] Update `src/renderer/src/components/WindowSideBar.vue`
  - [ ] Replace mock data with real stores
  - [ ] Integrate AgentPanel
  - [ ] Integrate SessionPanel
  - [ ] Handle resize between panels (optional)

## 8. Event Handling

- [ ] Agent selection
  - [ ] Update selectedAgentId in store
  - [ ] Trigger session list refresh

- [ ] Session actions
  - [ ] Click to activate session
  - [ ] Right-click context menu
  - [ ] Delete session
  - [ ] Pin/unpin session

- [ ] New chat
  - [ ] Navigate to new-thread with agentId

## 9. SessionPresenter Updates

- [ ] Update `src/main/presenter/sessionPresenter/index.ts`
  - [ ] Add `getSessionsByAgent(agentId)` method
  - [ ] Support filtering in `getSessionList()`

## 10. i18n

- [ ] Add sidebar i18n keys to language files

## 11. Testing

- [ ] Agent selection updates session list
- [ ] Session grouping by project
- [ ] Session grouping by time
- [ ] Session search functionality
- [ ] Session pin/unpin
- [ ] Session delete
- [ ] New chat creation

---

## Dependencies
- Phase 1 (AgentConfigPresenter)
- Phase 2 (Settings - for agent creation link)

## Estimated Effort
- 4-5 days
