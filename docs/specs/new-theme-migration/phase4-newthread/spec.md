# Phase 4: NewThread Adaptation (Final)

## Overview

NewThread 页面在新主题下的最终行为：
1. 固定标题 `Build and explore`
2. 不在页面内选择 Agent，直接跟随左侧 sidebar 当前 Agent
3. 使用 WorkdirSelector 管理工作目录
4. 使用 StatusBar 根据 Agent 类型展示模型/参数能力
5. 发送时继承当前 Agent 配置创建会话

## UI Rules

### Header
- 标题文案固定：`Build and explore`

### Workdir
- 使用 `src/renderer/src/components/WorkdirSelector.vue`
- 支持最近目录、浏览目录、清空选择

### StatusBar
- 使用 `src/renderer/src/components/StatusBar.vue`
- 规则：
```ts
if (selectedAgent.type === 'acp') {
  // 仅显示 ACP Agent 图标+名称（只读）
  // 右侧显示 Permissions
} else {
  // 显示 Model Selector（所有 enabled models）
  // 显示 Effort Selector
  // 右侧显示 Permissions
}
```

## Data Flow

### Agent Source
- `agentStore.selectedAgent`

### NewThread Submit
- 由 `src/renderer/src/composables/useNewThread.ts` 处理：
  - Template agent: 继承 provider/model/systemPrompt/temperature/context/maxTokens 等
  - ACP agent: `providerId='acp'` + `modelId=agent.id` + `acpWorkdirMap`

### StatusBar State
- 由 `src/renderer/src/composables/useNewThreadStatusBar.ts` 处理：
  - enabledModels
  - activeModel
  - reasoning effort
  - permission

## Final File Mapping

- `src/renderer/src/components/NewThread.vue`
- `src/renderer/src/components/StatusBar.vue`
- `src/renderer/src/components/WorkdirSelector.vue`
- `src/renderer/src/composables/useNewThread.ts`
- `src/renderer/src/composables/useNewThreadStatusBar.ts`

## Notes

- 与 Phase5 对齐后，NewThread 输入区域使用真实 `InputBox`（`src/renderer/src/components/chat-input/InputBox.vue`），不再依赖 mock 目录。
