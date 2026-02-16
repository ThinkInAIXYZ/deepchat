# Phase 4 Tasks: NewThread Adaptation

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Completed

## Style Checklist

在开始实现前，确保理解并遵循以下样式规范：

- [ ] 阅读 `src/renderer/src/components/NewThreadMock.vue` 源码
- [ ] 阅读 `src/renderer/src/components/mock/MockInputBox.vue` 源码
- [ ] 阅读 `src/renderer/src/components/mock/MockInputToolbar.vue` 源码
- [ ] 阅读 `src/renderer/src/components/mock/MockStatusBar.vue` 源码
- [ ] 理解 InputBox 容器样式 (rounded-xl bg-card/30 backdrop-blur-lg)
- [ ] 理解 Toolbar 按钮样式 (h-7 w-7 rounded-lg)
- [ ] 理解 Project Selector 样式 (h-7 px-2.5 text-xs)

---

## 1. NewThread Composable

- [ ] Create `src/renderer/src/composables/useNewThread.ts`
  - [ ] `selectedAgentId` ref
  - [ ] `selectedAgent` computed
  - [ ] `workdir` ref
  - [ ] `userInput` ref
  - [ ] `loading` ref
  - [ ] Agent change watcher (update workdir default)
  - [ ] URL query param initialization (agentId)
  - [ ] `handleSubmit()` function
  - [ ] Default agent selection logic

## 2. AgentSelector Component

- [ ] Create `src/renderer/src/components/NewThread/AgentSelector.vue`
  - [ ] Dropdown trigger button
  - [ ] Template agents section
  - [ ] ACP agents section
  - [ ] Agent item with icon, name, meta info
  - [ ] Selected indicator
  - [ ] "Manage Agents" link
  - [ ] Popover styling

## 3. WorkdirSelector Component

- [ ] Create `src/renderer/src/components/NewThread/WorkdirSelector.vue`
  - [ ] Dropdown trigger button
  - [ ] Display path (truncated)
  - [ ] Recent directories list
  - [ ] Browse other directory button
  - [ ] Native directory picker integration
  - [ ] Popover styling

## 4. NewThread Page Update

- [ ] Update `src/renderer/src/views/ChatTabView.vue` or `NewThread.vue`
  - [ ] Import useNewThread composable
  - [ ] Add AgentSelector to toolbar
  - [ ] Add WorkdirSelector to toolbar
  - [ ] Update input handling
  - [ ] Update suggestions (optional)

## 5. Session Creation Flow

- [ ] Update `src/renderer/src/stores/chat.ts`
  - [ ] Modify `createThread()` to accept agentId
  - [ ] Pass agent config to session creation
  - [ ] Store agentId in session config

- [ ] Update `src/main/presenter/sessionPresenter/index.ts`
  - [ ] Support `agentId` in createSession
  - [ ] Store agent config snapshot

## 6. Agent Config Inheritance

- [ ] Implement config inheritance logic
  - [ ] Get providerId, modelId from agent
  - [ ] Get systemPrompt from agent (if set)
  - [ ] Get temperature, maxTokens from agent (if set)
  - [ ] Get thinkingBudget, reasoningEffort from agent (if set)

## 7. Recent Workdirs Integration

- [ ] Update configPresenter
  - [ ] Implement `getRecentWorkdirs()`
  - [ ] Implement `addRecentWorkdir(path)`
  - [ ] Store in electron-store

## 8. Navigation Integration

- [ ] Handle navigation from sidebar
  - [ ] Pass agentId in query params
  - [ ] Initialize selected agent from query

- [ ] Handle navigation after session creation
  - [ ] Navigate to chat view with new threadId

## 9. i18n

- [ ] Add NewThread i18n keys to language files

## 10. Testing

- [ ] Agent selector displays all agents
- [ ] Agent selection updates workdir default
- [ ] Workdir selector shows recent directories
- [ ] Workdir browse opens native picker
- [ ] Session creation binds agent correctly
- [ ] Session inherits agent configuration
- [ ] Navigation from sidebar works

---

## Dependencies
- Phase 1 (AgentConfigPresenter)
- Phase 2 (Agent Settings)
- Phase 3 (WindowSideBar)

## Estimated Effort
- 2-3 days
