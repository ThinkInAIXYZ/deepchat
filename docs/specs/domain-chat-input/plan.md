# Chat Input & Composer Plan

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 设计摘要
- Chat Input 负责草稿、附件、快捷能力与提交触发。
- 提交路径仅调用 Conversation 域的适配层（不直连 presenter）。
- ACP/模型选择属于输入入口，但通过专用适配层读取与写入。

## 代码现状分析（收敛点）
- `ChatInput.vue` 聚合了输入、附件、技能与模型选择的交互。
- 多个 composables 分散管理草稿、输入历史、mentions 与拖拽行为。
- 部分输入相关能力仍存在 `window.electron` 或 `usePresenter` 直连风险。

## 结构与边界
- **Composer State**：草稿、附件、标记（think/search）与输入编辑器状态。
- **Composer Services**：输入历史、mentions、拖拽与文件组织。
- **Submission Path**：构建 `UserMessageContent` 并提交给 chat store。
- **Mode/ACP Selectors**：仅负责 UI 与设置写入，不参与执行。

## 事件与数据流
- 输入变更 -> 更新草稿状态（会话级绑定）。
- 提交触发 -> 组装消息内容 -> `chatStore.sendMessage`。
- 模式/ACP 选择变更 -> 适配层写入配置。

## 迁移策略
- 先固化草稿与提交结构，再逐步收敛 composables 的职责。
- 输入层不直连 presenter，统一经适配层访问。

## 架构变更步骤与涉及文件范围

### 1) 固化 Composer 状态与提交结构
目标：明确草稿与附件结构，统一提交入口。
影响范围：
```txt
src/renderer/src/components/chat-input/ChatInput.vue
src/renderer/src/components/chat-input/InputEditor.vue
src/renderer/src/components/chat-input/composables/usePromptInputEditor.ts
src/renderer/src/components/chat-input/composables/usePromptInputConfig.ts
```

### 2) 收敛输入服务与适配层访问
目标：输入相关能力不直连 presenter/IPC。
影响范围：
```txt
src/renderer/src/components/chat-input/composables/useInputHistory.ts
src/renderer/src/components/chat-input/composables/usePromptInputFiles.ts
src/renderer/src/components/chat-input/composables/useDragAndDrop.ts
src/renderer/src/components/chat-input/composables/useMentionData.ts
src/renderer/src/components/chat-input/composables/useWorkspaceMention.ts
```

### 3) 统一模式/ACP 入口
目标：模式与 ACP 设置只通过专用适配层读写。
影响范围：
```txt
src/renderer/src/components/chat-input/ModeSelector.vue
src/renderer/src/components/chat-input/AcpModeSelector.vue
src/renderer/src/components/chat-input/AcpSessionModelSelector.vue
src/renderer/src/components/chat-input/composables/useChatMode.ts
src/renderer/src/components/chat-input/composables/useAcpMode.ts
src/renderer/src/components/chat-input/composables/useAcpSessionModel.ts
src/renderer/src/components/chat-input/composables/useAcpWorkdir.ts
```

### 4) UI 入口收敛与清理
目标：减少 ChatInput.vue 内部耦合，模块化 UI 区块。
影响范围：
```txt
src/renderer/src/components/chat-input/InputToolbar.vue
src/renderer/src/components/chat-input/InputActions.vue
src/renderer/src/components/chat-input/InputFooter.vue
src/renderer/src/components/chat-input/SkillsPanel.vue
```

## 测试策略
- 重点测试草稿恢复、附件组织与提交构建。
- 测试文件位置建议：`test/renderer/chat-input/`。
- 关键用例：切换会话草稿恢复、附件拖拽追加、提交构建结果正确。
