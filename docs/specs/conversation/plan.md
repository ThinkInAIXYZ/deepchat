# Conversation Domain Plan

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 设计摘要
- Conversation 为持久化记录，Session 为运行态绑定。
- ACP 运行态作为 provider 内部实现，不建模为 Conversation 域对象。
- Export/NowledgeMem、MCP/Skills 保持独立通路，不污染核心会话状态。

## 代码现状分析（收敛点）
- 核心状态与消息流主要集中在 `src/renderer/src/stores/chat.ts`，包含会话列表、消息缓存、流式处理与部分 ACP/MCP 相关状态。
- 会话操作与消息流拆散在多个 composables（如 `useThreadManagement`、`useMessageStreaming`、`useThreadExport`）。
- ACP 相关能力集中在 chat-input 组合函数，并依赖 `ACP_WORKSPACE_EVENTS` 事件。
- 导出与 NowledgeMem 通过 `exporter` presenter 实现，UI 入口位于线程条目组件。
- 主进程会话能力集中在 `sessionPresenter`，消息执行由 `agentPresenter` 驱动，事件通过 `events.ts` 广播。

## 结构与边界
- **Conversation Core**：会话生命周期与消息访问（基于 IThreadPresenter）。
- **Session Runtime**：绑定与运行态（status/bindings/context）。
- **Execution Adapter**：消息发送与流式消费（IAgentPresenter + STREAM_EVENTS）。
- **Tooling Adapter**：工具结果消费（MCP_EVENTS.TOOL_CALL_RESULT）。
- **ACP Runtime Adapter**：workdir/mode/model 查询与设置（ISessionPresenter）。
- **Export Adapter**：导出与 NowledgeMem（IConversationExporter）。

## 事件与数据流
- Conversation 列表更新：main -> CONVERSATION_EVENTS.LIST_UPDATED -> store。
- 激活会话：UI -> setActiveConversation -> CONVERSATION_EVENTS.ACTIVATED -> store。
- 消息流：IAgentPresenter -> STREAM_EVENTS -> message cache。
- 工具结果：MCP_EVENTS.TOOL_CALL_RESULT -> message flow。
- ACP 运行态：ACP_WORKSPACE_EVENTS.* -> ACP UI state。

## 事件命名空间来源
- Renderer 端定义：`src/renderer/src/events.ts`
- Main 端定义：`src/main/events.ts`

## 迁移策略
- 先固化 Conversation/Session 边界与协议文档，再迁移调用路径。
- ACP/Export/Tooling 作为独立适配层逐步抽离。

## 架构变更步骤与涉及文件范围

### 1) 收敛术语与模型边界（Conversation vs Session）
目标：统一渲染端对 Conversation/Session 的理解，避免 thread/session 混用。
影响范围：
```txt
docs/specs/conversation/spec.md
docs/specs/conversation/data-model.md
docs/specs/conversation/protocol.md
docs/specs/conversation/acp-runtime.md
src/shared/types/presenters/thread.presenter.d.ts
src/shared/types/presenters/session.presenter.d.ts
```

### 2) Conversation Core 抽离（生命周期 + 消息访问）
目标：将会话生命周期与消息访问从 UI 逻辑中拆出，store 只保留状态。
影响范围：
```txt
src/renderer/src/stores/chat.ts
src/renderer/src/composables/chat/useThreadManagement.ts
src/renderer/src/composables/chat/useChatConfig.ts
src/renderer/src/composables/chat/useMessageCache.ts
src/renderer/src/lib/messageRuntimeCache.ts
```

### 3) Execution Adapter 统一（消息发送 + 流式事件）
目标：把 `agentPresenter` 调用与流式事件消费集中，减少分散监听。
影响范围：
```txt
src/renderer/src/composables/chat/useMessageStreaming.ts
src/renderer/src/composables/chat/useChatEvents.ts
src/renderer/src/stores/chat.ts
src/renderer/src/events.ts
src/main/events.ts
```

### 4) ACP Runtime 适配层隔离
目标：ACP 运行态只通过专用适配层进入 UI，Conversation 域保持稳定。
影响范围：
```txt
src/renderer/src/components/chat-input/composables/useAcpMode.ts
src/renderer/src/components/chat-input/composables/useAcpSessionModel.ts
src/renderer/src/components/chat-input/composables/useAcpWorkdir.ts
src/renderer/src/components/chat-input/composables/useAcpCommands.ts
src/renderer/src/components/chat-input/composables/useAgentWorkspace.ts
src/renderer/src/events.ts
src/main/events.ts
src/main/presenter/sessionPresenter/
```

### 5) Tooling 与 Export 独立通路
目标：工具结果与导出路径与 Conversation Core 解耦，避免状态污染。
影响范围：
```txt
src/renderer/src/stores/mcp.ts
src/renderer/src/components/message/MessageBlockToolCall.vue
src/renderer/src/components/message/MessageBlockPermissionRequest.vue
src/renderer/src/components/message/MessageBlockMcpUi.vue
src/renderer/src/composables/chat/useThreadExport.ts
src/renderer/src/components/ThreadItem.vue
src/main/presenter/mcpPresenter/
src/main/presenter/exporter/
src/shared/types/presenters/exporter.presenter.d.ts
```

### 6) UI 路径重连与清理
目标：UI 只依赖 Conversation Core 与适配层，收敛调用路径。
影响范围：
```txt
src/renderer/src/views/ChatTabView.vue
src/renderer/src/components/ThreadView.vue
src/renderer/src/components/ThreadsView.vue
src/renderer/src/components/ChatLayout.vue
src/renderer/src/components/chat-input/ChatInput.vue
src/renderer/src/components/message/MessageList.vue
```

## 测试策略
- Store 单测：会话列表、激活切换、分支会话创建。
- 集成测试：消息流、ACP 运行态查询、工具结果接入、导出路径。
- 测试文件位置建议：`test/renderer/conversation/`
- 关键边界用例：多窗口同会话、分支生成新会话、ACP workdir/mode 切换、工具结果进入消息流、导出不改状态。
