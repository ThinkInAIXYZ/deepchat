# Phase 4 Tasks: NewThread Adaptation

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Completed

## Style Checklist

在开始实现前，确保理解并遵循以下样式规范：

- [x] 阅读 `src/renderer/src/components/NewThreadMock.vue` 源码
- [x] 阅读 `src/renderer/src/components/mock/MockInputBox.vue` 源码
- [x] 阅读 `src/renderer/src/components/mock/MockInputToolbar.vue` 源码
- [x] 阅读 `src/renderer/src/components/mock/MockStatusBar.vue` 源码
- [x] 理解 InputBox 容器样式 (rounded-xl bg-card/30 backdrop-blur-lg)
- [x] 理解 Toolbar 按钮样式 (h-7 w-7 rounded-lg)
- [x] 理解 Project Selector 样式 (h-7 px-2.5 text-xs)

---

## 1. NewThread Composable

- [x] Create `src/renderer/src/composables/useNewThread.ts`
  - [x] `selectedAgent` computed (directly from `agentStore.selectedAgent`)
  - [x] `workdir` ref
  - [x] `userInput` ref
  - [x] `loading` ref
  - [x] `handleSubmit()` function
  - [x] Remove agent selector related logic (`selectedAgentId`, `selectAgent`, query `agentId`)
  - [x] Keep workdir/recent workdirs flow
  - [x] Session creation inherits settings from selected sidebar agent

## 2. NewThreadStatusBar Composable

- [x] Create `src/renderer/src/composables/useNewThreadStatusBar.ts`
  - [x] Get current agent from sidebar store
  - [x] Get all enabled models from modelStore
  - [x] Get active model from chatStore
  - [x] Handle model selection with persistence
  - [x] Handle effort/permission selection
  - [x] Normalize reasoning effort sync (`minimal` -> `low`)
  - [x] ACP agent display (readonly with icon + name)
  - [x] Normal/Local agent display (Model selector + Effort selector)

## 3. NewThread Page Update

- [x] Update `src/renderer/src/components/NewThread.vue`
  - [x] Hardcode heading `"Build and explore"` (no i18n)
  - [x] Remove Agent selector UI
  - [x] Keep Workdir selector
  - [x] Update input handling

- [x] Update `src/renderer/src/components/mock/StatusBar.vue` (renamed from `MockStatusBar.vue`)
  - [x] Fix select import path (`@shadcn/components/ui/select`)
  - [x] Display ACP agent (readonly with icon + name)
  - [x] Display Model selector for normal agents
  - [x] Display Effort selector
  - [x] Display Permissions selector on right side
  - [x] Hide model/effort selectors for ACP agents

## 4. Session Creation Flow

- [x] Update `src/renderer/src/composables/useNewThread.ts`
  - [x] `handleSubmit()` to pass agent config to session creation
  - [x] Handle Template agent (providerId, modelId, systemPrompt, temperature, etc.)
  - [x] Handle ACP agent (providerId='acp', modelId=agent.id, acpWorkdirMap)

## 5. i18n

- [x] Remove NewThread heading i18n key from all locale files
  - [x] Remove `newThread.greeting`
  - [x] Keep existing keys required by Workdir/StatusBar

## 6. Component References

- [x] Update `src/renderer/src/views/ChatTabView.vue`
  - [x] Import NewThread from `@/components/NewThread.vue` (replace `NewThreadMock.vue`)

## 7. Component Rename Cleanup

- [x] Rename `src/renderer/src/components/mock/MockStatusBar.vue` -> `src/renderer/src/components/mock/StatusBar.vue`
- [x] Rename `src/renderer/src/components/mock/MockWorkdirSelector.vue` -> `src/renderer/src/components/mock/WorkdirSelector.vue`
- [x] Rename `src/renderer/src/components/mock/MockInputBox.vue` -> `src/renderer/src/components/mock/InputBox.vue`
- [x] Rename `src/renderer/src/components/mock/MockInputToolbar.vue` -> `src/renderer/src/components/mock/InputToolbar.vue`
- [x] Update all related imports

---

## Implementation Summary

### 主要变更

1. **NewThread.vue**: 使用固定标题 `Build and explore`，移除 AgentSelector，直接跟随 sidebar 当前 agent
2. **StatusBar.vue**: 根据 agent 类型显示不同内容
   - ACP Agent: 显示 Agent 名称+图标（不可切换模型）
   - Normal/Local Agent: Model Selector + Effort Selector
   - 右侧统一显示 Permissions Selector
3. **useNewThreadStatusBar.ts**: 新的 composable 处理 StatusBar 状态
4. **useNewThread.ts**: 处理 session 创建和 agent 配置继承，移除 agent 选择逻辑
5. **i18n**: 移除 heading 翻译键（`newThread.greeting`）
6. **Import Fix**: 修复 `@/shadcn/components/ui/select` 路径错误

## Dependencies
- Phase 1 (AgentConfigPresenter) ✅
- Phase 2 (Agent Settings) ✅
- Phase 3 (WindowSideBar) ✅

## Testing

- [x] NewThread page displays with hardcoded heading `Build and explore`
- [x] StatusBar shows ACP agent for ACP type
- [x] StatusBar shows Model/Effort for normal agents
- [x] Permissions selector renders on right side
- [x] Model selection updates chatStore and persists preference
- [x] Session creation with agent config inheritance
- [x] `pnpm run format`
- [x] `pnpm run lint`
- [x] `pnpm run build`
