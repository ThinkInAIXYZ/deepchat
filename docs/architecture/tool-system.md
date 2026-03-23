# 工具系统架构详解

本文档反映 retirement 后的工具系统分层。agent tools 已经从旧
`agentPresenter/acp/` 迁移到当前活跃目录。

## 当前组件

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| `ToolPresenter` | `src/main/presenter/toolPresenter/index.ts` | 聚合工具定义、建立映射、路由调用 |
| `ToolMapper` | `src/main/presenter/toolPresenter/toolMapper.ts` | `toolName -> source` 映射 |
| `AgentToolManager` | `src/main/presenter/toolPresenter/agentTools/agentToolManager.ts` | 本地 agent tools 装配与执行 |
| `AgentFileSystemHandler` | `src/main/presenter/toolPresenter/agentTools/agentFileSystemHandler.ts` | 文件系统类工具 |
| `AgentBashHandler` | `src/main/presenter/toolPresenter/agentTools/agentBashHandler.ts` | 命令执行与后台 session |
| `chatSettingsTools` | `src/main/presenter/toolPresenter/agentTools/chatSettingsTools.ts` | chat/session settings 工具 |
| `McpPresenter` | `src/main/presenter/mcpPresenter/` | 外部 MCP servers 与 tools |
| `ACP helpers` | `src/main/presenter/llmProviderPresenter/acp/` | ACP provider runtime、workdir、config、MCP 映射 |

## 路由关系

```mermaid
graph LR
    DeepChat["DeepChatAgentPresenter"] --> ToolPresenter["ToolPresenter"]
    ToolPresenter --> Mapper["ToolMapper"]
    ToolPresenter --> Mcp["McpPresenter"]
    ToolPresenter --> AgentTools["AgentToolManager"]
    AgentTools --> Fs["AgentFileSystemHandler"]
    AgentTools --> Bash["AgentBashHandler"]
    AgentTools --> Settings["chatSettingsTools"]
```

## 获取工具定义

`ToolPresenter.getAllToolDefinitions()` 会按顺序做三件事：

1. 从 `mcpPresenter` 拉取 MCP tools。
2. 从 `AgentToolManager` 拉取本地 agent tools。
3. 用 `ToolMapper` 记录来源，并在重名时优先保留 MCP tool。

这意味着 `deepchatAgentPresenter` 不需要知道 tool 的真实来源，只需要持有统一的
`MCPToolDefinition[]`。

## 调用工具

```mermaid
sequenceDiagram
    participant D as DeepChatAgentPresenter
    participant T as ToolPresenter
    participant Map as ToolMapper
    participant M as MCP tools
    participant A as Agent tools

    D->>T: callTool(request)
    T->>Map: getToolSource(name)

    alt source = mcp
        T->>M: callTool(request)
        M-->>T: tool response
    else source = agent
        T->>A: callTool(name, args, conversationId)
        A-->>T: tool response
    end

    T-->>D: { content, rawData }
```

## 权限与 runtime port

本地 agent tools 不再直接依赖旧 presenter runtime，而是通过明确的 port 注入：

- `src/main/presenter/toolPresenter/runtimePorts.ts`
- `AgentToolRuntimePort`

port 负责提供：

- conversation workdir 解析
- 已批准路径查询
- settings approval 消费
- `newAgentPresenter` 会话上下文桥接

权限能力拆分：

- 文件访问：`filePermissionService`
- settings 变更：`settingsPermissionService`
- shell/command：`CommandPermissionService`

## ACP 相关 helper

ACP provider 仍然是活跃能力，但它的 helper 已经迁到 provider 层：

```text
src/main/presenter/llmProviderPresenter/acp/
├── acpProcessManager.ts
├── acpSessionManager.ts
├── acpSessionPersistence.ts
├── acpConfigState.ts
├── acpCapabilities.ts
├── acpContentMapper.ts
├── acpFsHandler.ts
├── acpMessageFormatter.ts
├── acpTerminalManager.ts
├── mcpConfigConverter.ts
├── mcpTransportFilter.ts
└── types.ts
```

这些模块现在只服务于 `LLMProviderPresenter` / `AcpProvider`，不再依附 legacy
`AgentPresenter`。

## 调试建议

排查工具问题时，优先顺序：

1. `src/main/presenter/toolPresenter/index.ts`
2. `src/main/presenter/toolPresenter/toolMapper.ts`
3. `src/main/presenter/toolPresenter/agentTools/agentToolManager.ts`
4. 具体 handler
5. `src/main/presenter/mcpPresenter/toolManager.ts`

如果看到旧路径 `src/main/presenter/agentPresenter/acp/*`，那属于已经归档的历史实现。
