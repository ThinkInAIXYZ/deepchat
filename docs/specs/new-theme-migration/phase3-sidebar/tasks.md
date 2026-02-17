# Phase 3 Tasks: WindowSideBar Refactor

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Completed

## Style Checklist

在开始实现前，确保理解并遵循以下样式规范：

- [x] 阅读 `src/renderer/src/components/WindowSideBar.vue` 源码
- [x] 理解 Agent Icon 按钮样式 (w-9 h-9 rounded-xl)
- [x] 理解 Session Item 样式 (px-2 py-1.5 rounded-md)
- [x] 理解 Group 标题样式 (text-xs font-medium text-muted-foreground)
- [x] 理解折叠/展开动画 (transition-all duration-200)

---

## 1. Agent Store

- [x] Create `src/renderer/src/stores/agent.ts`
  - [x] `agents` ref for agent list
  - [x] `selectedAgentId` ref
  - [x] `loading` ref
  - [x] `selectedAgent` computed
  - [x] `templateAgents` computed
  - [x] `acpAgents` computed
  - [x] `loadAgents()` function
  - [x] `selectAgent(id)` function

## 2. Session List Composable

- [x] Create `src/renderer/src/composables/useSessionList.ts`
  - [x] `allSessions` ref
  - [x] `groupBy` ref ('project' | 'time')
  - [x] `searchQuery` ref
  - [x] `filteredSessions` computed (by agent + search)
  - [x] `groupedSessions` computed
  - [x] `groupByProject()` function
  - [x] `groupByTime()` function
  - [x] `loadSessions()` function
  - [x] `refreshSessions()` function

## 3. Sidebar Components Structure

- [x] Keep single file `WindowSideBar.vue` (simplified approach)

## 4-6. AgentPanel/SessionPanel/SessionList Components

- [x] Merged into WindowSideBar.vue for simplicity
- [x] Agent icon list with real data
- [x] Session list with real data
- [x] Group toggle (project/time)
- [x] Empty state handling

## 7. WindowSideBar Refactor

- [x] Update `src/renderer/src/components/WindowSideBar.vue`
  - [x] Replace mock data with real stores
  - [x] Integrate agent store
  - [x] Integrate session list composable
  - [x] Handle agent selection

## 8. Event Handling

- [x] Agent selection
  - [x] Update selectedAgentId in store
  - [x] Trigger session list refresh via computed

- [x] Session actions
  - [x] Click to activate session

- [x] New chat
  - [x] Navigate to new-thread

## 9. SessionPresenter Updates

- [x] Use existing `getSessionList()` method
- [x] Filter by agent in composable

## 10. i18n

- [x] Add sidebar i18n keys to language files
  - [x] en-US/common.json
  - [x] zh-CN/common.json

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

## Implementation Notes

Phase 3 completed with a simplified approach:
1. Created `useAgentStore` in `src/renderer/src/stores/agent.ts` - manages agent list and selection
2. Created `useSessionList` composable in `src/renderer/src/composables/useSessionList.ts` - handles session loading, filtering, and grouping
3. Updated `WindowSideBar.vue` to use real data from stores while preserving all original styles and interactions
4. Added i18n keys for sidebar UI strings
