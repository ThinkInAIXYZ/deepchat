# MessageToolbar 功能补齐实施计划（不含 Trace 落库）

## 1. 关键决策

1. 新页面消息操作以 `agentSessionPresenter` 为唯一目标接口。
2. 新架构下线 variants，不再做版本切换状态维护。
3. 交付拆两阶段：
   - Phase 1：前端接线、显隐与禁用策略。
   - Phase 2：补齐后端 API 并完成动作闭环。
4. Trace 设计独立推进，不阻塞 toolbar 主流程。

## 2. 组件与状态改造范围

### 渲染层

1. `src/renderer/src/components/chat/MessageList.vue`
   - 补齐 toolbar 事件透传与 action handler。
2. `src/renderer/src/components/message/MessageToolbar.vue`
   - 引入统一 capabilities/disabled 输入，移除 variants UI。
3. `src/renderer/src/components/message/MessageItemUser.vue`
   - 从旧 `sessionPresenter` 编辑链路切到新消息操作接口（Phase 2）。
4. `src/renderer/src/components/message/MessageItemAssistant.vue`
   - 从旧 `chatStore` 动作切到新消息操作接口（Phase 2）。
5. `src/renderer/src/pages/ChatPage.vue`
   - 汇总生成态/待交互态，向 MessageList 提供禁用控制。

### 状态层

1. `src/renderer/src/stores/ui/message.ts`
   - 增加消息操作后的本地刷新策略（optimistic + reload 边界）。
2. `src/renderer/src/stores/ui/session.ts`
   - Fork 后会话激活与页面切换策略。

## 3. 新 API 设计（Phase 2）

在 `IAgentSessionPresenter` 增加：

1. `editUserMessage(sessionId: string, messageId: string, newText: string): Promise<void>`
2. `retryFromUserMessage(sessionId: string, messageId: string): Promise<void>`
3. `retryFromAssistantMessage(sessionId: string, messageId: string): Promise<void>`
4. `deleteMessage(sessionId: string, messageId: string): Promise<void>`
5. `forkSessionFromMessage(sessionId: string, messageId: string): Promise<string>`

后端语义：

1. `editUserMessage`：更新该用户消息文本，删除其后消息，自动触发生成。
2. `retryFromUserMessage`：删除该消息后的全部消息，触发重新生成。
3. `retryFromAssistantMessage`：定位关联上下文边界，删除其后消息并重生成。
4. `deleteMessage`：仅删除当前消息，不级联删除其他消息。
5. `forkSessionFromMessage`：复制到目标 assistant（含本条）并返回新 `sessionId`。

## 4. 交互与禁用规则

1. 当会话 `isGenerating` 或有 pending tool interaction 时：
   - 禁用：`edit/retry/delete/fork`
   - 可用：`copy/copyImage`
2. 用户编辑模式下：
   - `save` 与 `cancel` 保持可用。
   - 其他动作隐藏或禁用，防止状态竞争。
3. 复制图片语义不变：短按当前组，长按从顶部到当前。

## 5. 数据兼容与迁移策略

1. 新接口落地前，Phase 1 中所有未闭环按钮必须降级处理（隐藏或 disabled），禁止 no-op。
2. 不改历史消息存储结构，仅新增消息操作入口。
3. 不引入 variants 兼容层，避免双语义并存。

## 6. 测试策略

### Main

1. `editUserMessage`：截断范围、重生触发、异常回滚。
2. `retryFromUserMessage` / `retryFromAssistantMessage`：边界与顺序正确。
3. `deleteMessage`：仅当前消息删除，不影响相邻消息。
4. `forkSessionFromMessage`：复制到目标点（含本条）并保持新旧会话隔离。

### Renderer

1. toolbar 在生成中禁用策略正确。
2. 用户编辑流程（进入/保存/取消）状态正确。
3. user/assistant retry 触发正确 API。
4. Fork 成功后页面切换到新会话。

## 7. 风险与回退

1. 风险：新旧链路并存导致行为漂移。
   - 缓解：新页面只读写新接口，Phase 1 明确禁用未闭环动作。
2. 风险：消息截断边界错误导致上下文污染。
   - 缓解：Main 层单测覆盖多轮消息结构。
3. 回退：保留旧组件分支，必要时通过 feature flag 关闭新 toolbar 动作映射。
