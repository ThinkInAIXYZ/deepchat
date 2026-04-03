# DeepChat 当前核心流程

本文档只描述 retirement 后仍然有效的主流程。旧 `AgentPresenter` 流程已移到
[archives/legacy-agentpresenter-flows.md](./archives/legacy-agentpresenter-flows.md)。

## 1. 创建会话并发送消息

```mermaid
sequenceDiagram
    participant R as Renderer
    participant N as AgentSessionPresenter
    participant A as AgentRegistry
    participant D as AgentRuntimePresenter
    participant S as NewSessionManager

    R->>N: createSession(input, webContentsId)
    N->>A: resolve agent implementation
    N->>S: create session record
    N->>D: initSession(sessionId, config)
    N->>S: bindWindow(webContentsId, sessionId)
    N-->>R: SessionWithState
    N->>D: queuePendingInput()/processMessage()
```

关键文件：

- `src/main/presenter/agentSessionPresenter/index.ts`
- `src/main/presenter/agentSessionPresenter/sessionManager.ts`
- `src/main/presenter/agentRuntimePresenter/index.ts`

## 2. DeepChat 消息处理主循环

```mermaid
flowchart TD
    Start["processMessage"] --> Context["buildContext / buildResumeContext"]
    Context --> Stream["processStream"]
    Stream --> Acc["accumulate stream events"]
    Acc --> ToolCheck{"tool calls?"}
    ToolCheck -->|no| Finalize["finalize assistant message"]
    ToolCheck -->|yes| Dispatch["dispatch.executeTools"]
    Dispatch --> Resume{"paused for interaction?"}
    Resume -->|yes| Wait["wait respondToolInteraction"]
    Resume -->|no| Continue["append tool results"]
    Wait --> Continue
    Continue --> Context
    Finalize --> Persist["messageStore / sessionStore"]
```

关键文件：

- `src/main/presenter/agentRuntimePresenter/process.ts`
- `src/main/presenter/agentRuntimePresenter/dispatch.ts`
- `src/main/presenter/agentRuntimePresenter/contextBuilder.ts`
- `src/main/presenter/agentRuntimePresenter/messageStore.ts`

## 3. 工具调用与权限

```mermaid
sequenceDiagram
    participant D as AgentRuntimePresenter
    participant T as ToolPresenter
    participant M as MCP Presenter
    participant G as AgentToolManager
    participant P as Permission Services
    participant R as Renderer

    D->>T: getAllToolDefinitions()
    D->>T: preCheckToolPermission()/callTool()

    alt agent tool
        T->>G: callTool(name, args, conversationId)
        G->>P: check/consume approvals
        G-->>T: tool result
    else mcp tool
        T->>M: callTool(request)
        M-->>T: tool result
    end

    alt requires interaction
        D-->>R: emit paused interaction
        R->>D: respondToolInteraction()
    end
```

关键文件：

- `src/main/presenter/toolPresenter/index.ts`
- `src/main/presenter/toolPresenter/agentTools/agentToolManager.ts`
- `src/main/presenter/toolPresenter/agentTools/agentFileSystemHandler.ts`
- `src/main/presenter/mcpPresenter/toolManager.ts`

## 4. ACP draft session / runtime preparation

```mermaid
sequenceDiagram
    participant R as Renderer
    participant N as AgentSessionPresenter
    participant D as AgentRuntimePresenter
    participant L as LLMProviderPresenter
    participant A as ACP helpers

    R->>N: ensureAcpDraftSession(agentId, projectDir)
    N->>D: initSession(... providerId='acp')
    N->>L: prepareAcpSession(sessionId, agentId, projectDir)
    L->>A: process/session persistence + config helpers
    L-->>N: ACP session ready
    N-->>R: SessionWithState
```

关键文件：

- `src/main/presenter/agentSessionPresenter/index.ts`
- `src/main/presenter/llmProviderPresenter/index.ts`
- `src/main/presenter/llmProviderPresenter/acp/`

## 5. Legacy 数据导入

```mermaid
sequenceDiagram
    participant Hook as lifecycle import hook
    participant N as AgentSessionPresenter
    participant I as LegacyChatImportService
    participant DB as SQLite / legacy tables

    Hook->>N: startLegacyImport()
    N->>I: importLegacyChats()
    I->>DB: read legacy conversations/messages
    I->>DB: write new_sessions / new_messages
    I-->>N: import status
```

这个流程仍然保留，但只负责历史数据迁移，不再恢复旧 runtime。

关键文件：

- `src/main/presenter/agentSessionPresenter/legacyImportService.ts`
- `src/main/presenter/lifecyclePresenter/hooks/after-start/legacyImportHook.ts`
