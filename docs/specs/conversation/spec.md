# Conversation Domain Specification

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 背景与目标
Conversation 是渲染端最核心的业务域，当前职责与事件分散在组件与 store 中。该规范的目标是用最小清晰结构定义边界与最低可用功能集，为后续整理与拆分提供稳定参照。

## 术语与边界
- **Conversation**：持久化记录，跨重启存在（标题、settings、消息历史）。
- **Session**：运行态绑定，跨重启不保留（窗口/标签绑定、运行状态、上下文）。
- **Thread**：历史命名，仅用于兼容现有代码，不作为独立概念。

## 相关文档
- `docs/specs/conversation/data-model.md`
- `docs/specs/conversation/protocol.md`
- `docs/specs/conversation/acp-runtime.md`

## 范围（In Scope）
- 会话生命周期：创建、列出、激活、重命名、删除、置顶。
- 消息生命周期：发送（由执行层触发）、流式更新消费、编辑、删除、列表读取。
- 分支：从指定消息派生新会话（仅生成新会话，不维护子会话关系）。
- ACP：会话级模式与 workdir 的配置持久化；运行时查询/预热由 Session 触发。
- Workspace：会话级工作区路径绑定。
- MCP/Skills：会话级工具选择持久化；工具结果通过事件进入消息流。
- 导出与 NowledgeMem：独立能力，只读 Conversation 数据。

## 非目标（Out of Scope）
- 消息变体能力。
- 子会话（child session）与基于选区的派生能力。
- Search/RAG 与检索助手能力。
- Artifacts 相关能力。
- 语音与音频能力。

## 用户故事
- 用户可以创建并切换会话，列表与激活状态保持一致。
- 用户发送消息后可以看到流式更新，并最终形成稳定消息记录。
- 用户可从消息派生新会话，派生后即为独立会话。
- 用户可为会话设置 ACP 模式与 workdir。
- 用户可选择启用/禁用工具，并在对话中消费工具结果。
- 用户可导出会话或提交到 NowledgeMem，且不影响对话流。

## 验收标准
- Conversation 与 Session 生命周期分离，运行态不写回持久化记录。
- 会话与消息的核心操作通过 Presenter 入口完成并驱动 UI 更新。
- 分支会话生成新会话 ID，不需要维护子会话树或父子导航。
- ACP 与 Workspace 的会话级配置可读写，且生命周期与会话一致。
- 工具结果通过 MCP 事件进入消息流，不在 Conversation 内执行工具。
- 导出与 NowledgeMem 操作为独立路径，不修改会话/消息核心状态。

## 约束与假设
- Renderer 仅通过 `IThreadPresenter`/`ISessionPresenter` 与主进程交互，不直接访问持久层。
- ACP 运行态作为 provider 内部实现，不建模为 Conversation 域对象。
- `CONVERSATION_SETTINGS` 包含的搜索、变体、artifacts 等字段视为兼容字段，不属于本域需求。
- `parentConversationId`/`parentMessageId` 仅用于记录派生来源，不建立树形导航或子会话关系。

## 开放问题
无。如需纳入非目标功能，请先确认范围。
