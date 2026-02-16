# Phase 2 Tasks: Settings - Agent Management

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Completed

## Pre-requisites: 复用现有能力

在开始实现前，确保理解以下现有代码：

- [ ] 阅读 `src/renderer/settings/App.vue` - 理解设置框架布局
- [ ] 阅读 `src/renderer/settings/components/` 目录下现有设置组件
- [ ] 阅读 `src/renderer/src/stores/chat.ts` - 理解 provider/model 选择逻辑
- [ ] 阅读 `src/main/presenter/llmProviderPresenter/index.ts` - 理解获取 provider 列表
- [ ] 阅读 `src/main/presenter/filePresenter/index.ts` - 理解目录选择器
- [ ] 阅读 `src/renderer/src/i18n/` - 理解 i18n 使用模式

---

## 1. Settings Navigation

- [ ] Update `src/renderer/settings/App.vue`
  - [ ] Add "Agents" menu item to navigation
  - [ ] Add route for agent settings

- [ ] Update `src/renderer/settings/components/SettingsNav.vue`
  - [ ] Add Agents icon and label
  - [ ] Add click handler to navigate

## 2. AgentSettings Main Component

- [ ] Create `src/renderer/settings/components/AgentSettings.vue`
  - [ ] Layout with header and content areas
  - [ ] New Agent button
  - [ ] Search input
  - [ ] Template Agents section
  - [ ] ACP Agents section (read-only)
  - [ ] Loading and error states

## 3. AgentList Component

- [ ] Create `src/renderer/settings/components/AgentList.vue`
  - [ ] Display template agents list
  - [ ] Display ACP agents list (read-only)
  - [ ] Edit/Delete actions for template agents
  - [ ] View action for ACP agents

## 4. AgentEditorDialog Component

- [ ] Create `src/renderer/settings/components/AgentEditorDialog.vue`
  - [ ] Dialog layout
  - [ ] Name input field
  - [ ] Icon picker trigger
  - [ ] Provider dropdown (populate from providers)
  - [ ] Model dropdown (populate based on provider)
  - [ ] Workdir picker
  - [ ] Advanced settings collapse panel
    - [ ] System prompt textarea
    - [ ] Temperature slider
    - [ ] Max tokens input
  - [ ] Create/Update actions
  - [ ] Validation logic

## 5. WorkdirPicker Component

- [ ] Create `src/renderer/settings/components/WorkdirPicker.vue`
  - [ ] Display current selected path
  - [ ] Recent directories list
  - [ ] Browse button (open native picker)
  - [ ] Select/Cancel actions

## 6. AgentIconPicker Component

- [ ] Create `src/renderer/settings/components/AgentIconPicker.vue`
  - [ ] Icon preview
  - [ ] Icon search input
  - [ ] Icon grid (using iconify)
  - [ ] Select action

## 7. Data Integration

- [ ] Create agent settings store or composable
  - [ ] Load agents from presenter
  - [ ] Handle create/update/delete operations
  - [ ] Handle loading states

- [ ] Update configPresenter for recent workdirs
  - [ ] Add `getRecentWorkdirs()` method
  - [ ] Add `addRecentWorkdir(path)` method

## 8. Default Agent Handling

- [ ] Show default "Local Agent" in list
- [ ] Allow editing default agent
- [ ] Prevent deletion of default agent (optional)

## 9. i18n

- [ ] Add i18n keys to `en/settings.json`
- [ ] Add i18n keys to `zh-CN/settings.json`
- [ ] Add i18n keys to other language files

## 10. Testing

- [ ] Agent creation flow
- [ ] Agent editing flow
- [ ] Agent deletion flow
- [ ] Workdir picker functionality
- [ ] ACP agents read-only display
- [ ] Default agent display

---

## Dependencies
- Phase 1 (AgentConfigPresenter)

## Estimated Effort
- 3-4 days
