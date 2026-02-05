# MCP & Tools Plan

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 设计摘要
- MCP 域负责服务/工具状态与结果订阅。
- 工具执行由主进程或工具链负责，渲染端仅消费结果。

## 代码现状分析（收敛点）
- MCP 状态集中在 store，但事件订阅与 UI 分散。
- 工具结果入口需要统一管理与可取消订阅。

## 结构与边界
- **MCP Config**：服务列表与启用状态。
- **Tool Registry**：工具定义与可用性。
- **Tool Result Stream**：结果订阅与分发。

## 事件与数据流
- MCP 配置变更 -> 服务状态同步 -> 工具列表刷新。
- Tool Result 事件 -> 适配层 -> UI/消息流消费。

## 迁移策略
- 先集中工具结果订阅入口，再收敛 UI 入口。

## 架构变更步骤与涉及文件范围

### 1) 工具结果订阅入口固化
目标：Tool Result 订阅集中与可取消。
影响范围：
```txt
src/renderer/src/composables/mcp/useMcpToolingAdapter.ts
src/renderer/src/stores/mcp.ts
```

### 2) MCP 配置与工具状态收敛
目标：MCP 状态统一在 store，UI 只消费状态。
影响范围：
```txt
src/renderer/src/stores/mcp.ts
src/renderer/src/stores/mcpSampling.ts
src/renderer/src/components/mcp-config/
src/renderer/src/components/McpToolsList.vue
```

### 3) 消息与工具 UI 协作边界
目标：工具结果进入消息流的路径清晰。
影响范围：
```txt
src/renderer/src/components/message/MessageBlockToolCall.vue
src/renderer/src/components/message/MessageBlockMcpUi.vue
src/renderer/src/components/message/MessageBlockPermissionRequest.vue
```

## 测试策略
- 工具结果订阅与 key 规则单测。
- MCP 配置变更后的工具刷新逻辑测试。
