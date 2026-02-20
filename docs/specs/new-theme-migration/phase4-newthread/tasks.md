# Phase 4 Tasks: NewThread Adaptation (Final)

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Completed

## 1. NewThread Core

- [x] `NewThread.vue` 标题固定为 `Build and explore`（不走 i18n）
- [x] 移除 NewThread 页面内 Agent 选择器，直接使用 `agentStore.selectedAgent`
- [x] 保留并接入 Workdir 选择

## 2. StatusBar Logic

- [x] 实现 `useNewThreadStatusBar.ts`
- [x] ACP Agent 仅显示 icon + name（只读）
- [x] Local/Template Agent 显示 Model Selector + Effort Selector
- [x] 右侧统一显示 Permissions
- [x] 模型切换同步 `chatStore.updateChatConfig` 并持久化 preferred model

## 3. Session Creation Flow

- [x] `useNewThread.ts` 支持继承当前侧边栏 Agent 配置创建会话
- [x] Template agent 配置继承（provider/model/systemPrompt/temperature 等）
- [x] ACP agent 配置继承（`providerId='acp'` + `acpWorkdirMap`）

## 4. Post-Phase Cleanup (with Phase5)

- [x] `StatusBar.vue` 正式路径切换到 `src/renderer/src/components/StatusBar.vue`
- [x] `WorkdirSelector.vue` 正式路径切换到 `src/renderer/src/components/WorkdirSelector.vue`
- [x] NewThread 输入接入真实 `InputBox`：`src/renderer/src/components/chat-input/InputBox.vue`
- [x] 清理 `src/renderer/src/components/mock/` 目录

## 5. i18n

- [x] 移除 `newThread.greeting`
- [x] 保留 Workdir/StatusBar 需要的 `newThread.*` 词条

## 6. Validation

- [x] `pnpm run format`
- [x] `pnpm run lint`
- [x] `pnpm run build`

## Notes

- NewThread UI 已与 Phase5 的输入组件迁移保持一致。
- mock 目录清理后，组件引用统一为正式路径。
