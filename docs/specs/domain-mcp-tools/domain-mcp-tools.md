# MCP & Tools Specification

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 背景与目标
MCP 工具链涉及服务管理、工具列表与结果订阅。目标是限定工具相关的状态边界与事件处理路径，避免对 Conversation 域造成污染。

## 术语与边界
- **MCP Server**：工具服务实例。
- **Tool**：可调用的 MCP 工具定义。
- **Tool Result**：由事件通道送达的执行结果。

## 相关文档
- `docs/specs/domain-conversation/domain-conversation.md`

## 范围（In Scope）
- MCP 服务列表与状态同步。
- 工具列表加载与选择持久化（会话级）。
- 工具结果事件订阅与转发。
- MCP 相关 UI 状态管理。

## 非目标（Out of Scope）
- 工具执行的业务逻辑与编排。
- Conversation 消息结构定义。

## 用户故事
- 用户启用/禁用工具，状态在会话内保持一致。
- 工具结果进入消息流并可追踪来源。

## 验收标准
- 工具结果订阅集中在适配层，支持取消订阅。
- 会话级工具选择与 Conversation 核心状态解耦。

## 约束与假设
- Tool Result 通过 MCP_EVENTS 进入渲染端。

## 开放问题
无。
