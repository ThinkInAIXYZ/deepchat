# Agent 系统架构详解

本文档详细介绍 Agent 系统的设计和实现，包括 Session 管理、Agent Loop、流生成、事件处理和权限协调。

## 架构概览

DeepChat 采用两层 Agent 架构：

```
┌─────────────────────────────────────────────────────────────────┐
│                        Renderer (IPC)                           │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NewAgentPresenter                            │
│  (Session Manager - IPC-facing, routing, orchestration)         │
│                                                                 │
│  - Owns AgentRegistry (maps agentId -> implementation)          │
│  - Owns NewSessionManager (session records + window bindings)   │
│  - Routes calls to appropriate agent implementation             │
│  - Handles multi-agent support (deepchat + ACP agents)          │
└───────────────────────────────┬─────────────────────────────────┘
                                │ resolves via AgentRegistry
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  DeepChatAgentPresenter                         │
│  (Agent Loop - IAgentImplementation for "deepchat" agent)       │
│                                                                 │
│  - Owns SessionStore (runtime state per session)                │
│  - Owns MessageStore (message persistence)                      │
│  - Owns CompactionManager (context summarization)               │
│  - Implements processMessage() -> processStream() loop          │
│  - Handles tool execution via ToolPresenter                     │
└─────────────────────────────────────────────────────────────────┘
```

## 核心组件

### NewAgentPresenter - Session Manager Layer

**文件位置**: `src/main/presenter/newAgentPresenter/`

```
newAgentPresenter/
├── index.ts              # Main presenter - orchestrates sessions
├── sessionManager.ts     # Session CRUD operations
├── messageManager.ts     # Message lookup across agents
├── agentRegistry.ts      # Agent registration and resolution
└── legacyImportService.ts # Legacy chat import functionality
```

#### 主要方法

| 方法 | 用途 |
|------|------|
| `createSession(input, webContentsId)` | 创建新会话并发送第一条消息 |
| `sendMessage(sessionId, content)` | 向现有会话发送消息 |
| `retryMessage(sessionId, messageId)` | 从某条消息重试生成 |
| `editUserMessage(sessionId, messageId, text)` | 编辑用户消息并重新生成 |
| `forkSession(sourceSessionId, targetMessageId)` | 从某条消息分叉会话 |
| `getSessionList(filters)` | 获取会话列表 |
| `activateSession(webContentsId, sessionId)` | 绑定会话到窗口 |
| `deleteSession(sessionId)` | 删除会话并清理资源 |
| `cancelGeneration(sessionId)` | 取消正在进行的生成 |
| `respondToolInteraction(...)` | 响应权限/问题提示 |
| `setSessionModel(sessionId, providerId, modelId)` | 更换模型 |
| `getAgents()` | 获取可用的 agent 列表 |

### DeepChatAgentPresenter - Agent Loop Implementation

**文件位置**: `src/main/presenter/deepchatAgentPresenter/`

```
deepchatAgentPresenter/
├── index.ts              # Agent implementation (IAgentImplementation)
├── process.ts            # Core stream processing loop
├── dispatch.ts           # Tool execution and finalization
├── types.ts              # Stream state, process params, results
├── accumulator.ts        # Stream event -> block accumulator
├── contextBuilder.ts     # Build LLM context from history
├── messageStore.ts       # Message persistence (SQLite wrapper)
├── sessionStore.ts       # Session runtime state
├── echo.ts               # Real-time block streaming to renderer
├── toolOutputGuard.ts    # Tool output validation/truncation
├── compactionManager.ts  # Context compaction via summarization
└── pendingInteractions.ts # Manage paused tool interactions
```

#### 主要方法

| 方法 | 用途 |
|------|------|
| `initSession(sessionId, config)` | 初始化会话运行时状态 |
| `destroySession(sessionId)` | 清理会话资源 |
| `processMessage(sessionId, input, options)` | 处理用户消息（生成主入口） |
| `getMessages(sessionId)` | 获取会话所有消息 |
| `cancelGeneration(sessionId)` | 中止当前生成 |
| `respondToolInteraction(...)` | 恢复暂停的交互（权限批准/回答问题） |
| `setSessionModel(...)` | 切换 provider/model |
| `setPermissionMode(...)` | 更改权限模式 |

#### 内部模块职责

| 模块 | 职责 |
|------|------|
| `processStream()` | 核心 LLM 循环: stream -> accumulate -> tool_use loop -> finalize |
| `executeTools()` | 执行工具调用，处理权限，构建工具消息 |
| `finalize/finalizeError/finalizePaused` | 消息完成状态处理 |
| `StreamState` | 流式过程中的可变状态（blocks, metadata, tool calls） |
| `accumulate()` | 纯函数: LLM events -> assistant message blocks |
| `DeepChatMessageStore` | 持久化消息到 SQLite |
| `DeepChatSessionStore` | 持久化会话运行时状态 |
| `buildContext()` | 构建 LLM 上下文，包含 token 预算和历史选择 |
| `startEcho()` | 实时流式传输 blocks 到 renderer |
| `ToolOutputGuard` | 验证/截断工具输出 |
| `CompactionManager` | 当上下文过长时总结旧消息 |

## 核心流程

### 发送消息流程

```
Renderer IPC -> NewAgentPresenter.sendMessage()
  -> resolveAgentImplementation(session.agentId)  // via AgentRegistry
  -> agent.processMessage(sessionId, input)       // DeepChatAgentPresenter
    -> buildContext()                             // history -> ChatMessage[]
    -> processStream()                            // LLM loop
      -> accumulate()                             // events -> blocks
      -> executeTools()                           // MCP tool calls
      -> finalize()                               // persist to DB
```

### Agent Loop 主循环

```mermaid
flowchart TD
    Start([processStream 开始]) --> InitState[初始化 StreamState]
    InitState --> BuildContext[构建上下文 buildContext]
    BuildContext --> CallLLM[调用 provider.coreStream]
    
    CallLLM --> LoopEvents{遍历 LLM Stream 事件}
    
    LoopEvents --> EventText{text 事件
累积 content block}
    EventText --> LoopEvents
    
    LoopEvents --> EventReasoning{reasoning 事件
累积 reasoning block}
    EventReasoning --> LoopEvents
    
    LoopEvents --> EventToolStart{tool_call_start
初始化 tool block}
    EventToolStart --> LoopEvents
    
    LoopEvents --> EventToolEnd{tool_call_end}
    EventToolEnd --> CheckPermission{需要权限?}
    
    CheckPermission -->|是| PauseStream[暂停流
发送 permission block]
    PauseStream --> WaitUser[等待用户响应]
    WaitUser --> UserResponse{用户批准?}
    UserResponse -->|是| ExecuteTool
    UserResponse -->|否| DenyTool[记录拒绝]
    DenyTool --> LoopEvents
    
    CheckPermission -->|否| ExecuteTool[执行工具]
    ExecuteTool --> AddResult[添加工具结果到上下文]
    AddResult --> LoopEvents
    
    LoopEvents --> EventStop{stop 事件}
    EventStop --> CheckReason{stop_reason?}
    
    CheckReason -->|tool_use| SetContinue[needContinue = true]
    CheckReason -->|end| SetStop[needContinue = false]
    
    SetContinue --> CheckToolCalls{有待执行工具?}
    CheckToolCalls -->|是| ExecuteTools[executeTools]
    ExecuteTools --> BuildContext
    
    CheckToolCalls -->|否| Finalize[finalize]
    SetStop --> Finalize
    
    Finalize --> PersistDB[持久化到 SQLite]
    PersistDB --> SendEnd([发送 END 事件])
```

### 权限流程

```mermaid
sequenceDiagram
    participant L as Agent Loop
    participant D as dispatch.ts
    participant P as PermissionService
    participant E as EventBus
    participant R as Renderer
    
    L->>D: executeTools(toolCalls)
    
    loop 遍历每个 toolCall
        D->>P: checkPermission(toolCall)
        
        alt 需要权限
            P-->>D: {needsPermission: true}
            D->>E: 发送 permission block
            E->>R: 显示权限对话框
            R-->>D: respondToolInteraction()
            
            alt 用户批准
                D->>P: grantPermission()
                D->>D: 执行工具
            else 用户拒绝
                D->>P: denyPermission()
                D->>D: 记录拒绝
            end
        else 已有权限/全权限模式
            D->>D: 直接执行工具
        end
    end
    
    D-->>L: 返回工具结果
```

## 权限模式

### 三种权限模式

| 模式 | 行为 |
|------|------|
| `default` | 每次工具调用都需要用户批准 |
| `ask` | 首次询问，之后记住决策 |
| `full` | 自动批准所有工具调用（受 projectDir 限制） |

### 权限类型

| 类型 | 说明 |
|------|------|
| `read` | 读取文件权限 |
| `write` | 写入文件权限 |
| `all` | 完全访问权限 |
| `command` | 执行命令权限 |

## P0 功能实现状态

| 功能 | 状态 | 说明 |
|------|------|------|
| Session 状态跟踪 | ✅ 完成 | 通过 `session.status` + `messageStore.isStreaming` |
| 输入禁用 + Stop | ✅ 完成 | Stop UX 在 `ChatInputToolbar.vue` |
| 取消生成 | ✅ 完成 | Abort controller 集成 |
| 权限审批流程 | 🟡 部分 | 核心流程已实现，remember 持久化待完成 |
| Session 列表刷新 | ✅ 完成 | 事件驱动 `SESSION_EVENTS.LIST_UPDATED` |
| 乐观消息 | ✅ 完成 | `addOptimisticUserMessage()` |
| 缓存版本 | ⚪ 延迟 | 内存缓存足够 P0 |

详见 [P0 Implementation Summary](../P0_IMPLEMENTATION_SUMMARY.md)

## 关键文件位置

### 新架构

| 组件 | 位置 |
|------|------|
| NewAgentPresenter | `src/main/presenter/newAgentPresenter/index.ts` |
| DeepChatAgentPresenter | `src/main/presenter/deepchatAgentPresenter/index.ts` |
| processStream | `src/main/presenter/deepchatAgentPresenter/process.ts` |
| executeTools | `src/main/presenter/deepchatAgentPresenter/dispatch.ts` |
| buildContext | `src/main/presenter/deepchatAgentPresenter/contextBuilder.ts` |
| accumulate | `src/main/presenter/deepchatAgentPresenter/accumulator.ts` |
| MessageStore | `src/main/presenter/deepchatAgentPresenter/messageStore.ts` |
| SessionStore | `src/main/presenter/deepchatAgentPresenter/sessionStore.ts` |

### 前端组件

| 组件 | 位置 |
|------|------|
| ChatPage | `src/renderer/src/pages/ChatPage.vue` |
| ChatInputToolbar | `src/renderer/src/components/chat/ChatInputToolbar.vue` |
| ChatToolInteractionOverlay | `src/renderer/src/components/chat/ChatToolInteractionOverlay.vue` |
| sessionStore | `src/renderer/src/stores/ui/session.ts` |
| messageStore | `src/renderer/src/stores/ui/message.ts` |

---

## Legacy Architecture (旧架构)

以下内容描述旧的 AgentPresenter 架构，保留作为历史参考。新开发应使用上述新架构。

### 旧架构组件概览

| 组件 | 文件位置 | 职责 |
|------|---------|------|
| **AgentPresenter** | `src/main/presenter/agentPresenter/index.ts` | Agent 编排主入口，实现 IAgentPresenter 接口 |
| **agentLoopHandler** | `src/main/presenter/agentPresenter/loop/agentLoopHandler.ts` | Agent Loop 主循环（while 循环） |
| **streamGenerationHandler** | `src/main/presenter/agentPresenter/streaming/streamGenerationHandler.ts` | 流生成协调 |
| **loopOrchestrator** | `src/main/presenter/agentPresenter/loop/loopOrchestrator.ts` | Loop 状态管理器 |
| **toolCallProcessor** | `src/main/presenter/agentPresenter/loop/toolCallProcessor.ts` | 工具调用执行 |
| **llmEventHandler** | `src/main/presenter/agentPresenter/streaming/llmEventHandler.ts` | 标准化 LLM 事件 |
| **permissionHandler** | `src/main/presenter/agentPresenter/permission/permissionHandler.ts` | 权限请求响应协调 |

### 旧架构关系图

```mermaid
graph TB
    subgraph "AgentPresenter 主入口"
        AgentP[AgentPresenter]
    end

    subgraph "Agent Loop 执行层"
        StreamGen[streamGenerationHandler]
        AgentLoop[agentLoopHandler]
        LoopOrch[loopOrchestrator]
        ToolCallProc[toolCallProcessor]
    end

    subgraph "事件处理层"
        LLMEvent[llmEventHandler]
        ToolCall[toolCallHandler]
        BufHandler[contentBufferHandler]
    end

    subgraph "辅助组件"
        MessageBuilder[messageBuilder]
        PermHandler[permissionHandler]
        Utility[utilityHandler]
    end

    AgentP --> StreamGen
    AgentP --> PermHandler
    AgentP --> Utility

    StreamGen --> AgentLoop
    StreamGen --> LLMEvent
    StreamGen --> MessageBuilder

    AgentLoop --> LoopOrch
    AgentLoop --> ToolCallProc
    AgentLoop --> ToolCall

    ToolCallProc --> AgentP
    ToolCall --> LLMEvent
    LLMEvent --> BufHandler

    LoopOrch --> LLMEvent

    classDef entry fill:#e3f2fd
    classDef loop fill:#fff3e0
    classDef event fill:#f3e5f5
    classDef util fill:#e8f5e9

    class AgentP entry
    class StreamGen,AgentLoop,LoopOrch,ToolCallProc loop
    class LLMEvent,ToolCall,BufHandler event
    class MessageBuilder,PermHandler,Utility util
```

### 旧架构关键文件位置

- **AgentPresenter**: `src/main/presenter/agentPresenter/index.ts`
- **agentLoopHandler**: `src/main/presenter/agentPresenter/loop/agentLoopHandler.ts`
- **streamGenerationHandler**: `src/main/presenter/agentPresenter/streaming/streamGenerationHandler.ts`
- **loopOrchestrator**: `src/main/presenter/agentPresenter/loop/loopOrchestrator.ts`
- **toolCallProcessor**: `src/main/presenter/agentPresenter/loop/toolCallProcessor.ts`
- **llmEventHandler**: `src/main/presenter/agentPresenter/streaming/llmEventHandler.ts`
- **permissionHandler**: `src/main/presenter/agentPresenter/permission/permissionHandler.ts`
- **messageBuilder**: `src/main/presenter/agentPresenter/message/messageBuilder.ts`
- **contentBufferHandler**: `src/main/presenter/agentPresenter/streaming/contentBufferHandler.ts`

---

## 相关阅读

- [整体架构概览](../ARCHITECTURE.md)
- [工具系统详解](./tool-system.md)
- [核心流程](../FLOWS.md)
- [会话管理详解](./session-management.md)
- [事件系统](./event-system.md)