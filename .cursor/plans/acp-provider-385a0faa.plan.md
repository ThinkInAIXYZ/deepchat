<!-- 385a0faa-3899-4927-8459-e625e6c224e0 43c21d5c-ed7b-49cf-9608-29352044b89c -->
# ACP Provider 架构重构方案（内存 Session + Agent/LLM 分离）

## 问题分析

1. Session 需作为热数据，切换 Agent/模型或应用重启后应失效
2. ACP 内容、工具调用、计划等事件尚未标准化，UI 无法正确渲染
3. 进程复用、错误恢复缺失，资源浪费
4. Agent Provider 与普通 LLM Provider 共用同一抽象，职责混杂

## 目标

- 引入 Agent Provider 专用抽象与 Renderer Store
- 内存化 Session 管理，保证在应用生命周期内复用
- 完整映射 ACP 内容/工具/计划事件
- 复用 Agent 进程，提升性能

## 高层架构

```
+-------------------------------+          +---------------------------+
| Main Process                  |          | Renderer Process          |
|                               |          |                           |
|  LLMProviderPresenter         |          |  ModelStore               |
|    ├─ BaseLLMProvider (LLM)   |          |    ├─ 普通模型            |
|    └─ BaseAgentProvider (Agent)|<--IPC-->|    └─ AgentModelStore     |
|         ├─ AcpProvider        |          |          └─ Agent 状态    |
|         │    ├─ AcpSessionMgr |          |                           |
|         │    ├─ AcpProcessMgr |          |                           |
|         │    ├─ AcpContentMap |          |                           |
|         │    └─ AcpMsgFmt     |          |                           |
+-------------------------------+          +---------------------------+
```

## 核心流程时序

```
User → Renderer → AgentModelStore → IPC: start stream
Renderer → LLMProviderPresenter → BaseAgentProvider
BaseAgentProvider → AcpSessionManager: getOrCreateSession
BaseAgentProvider → AcpProcessManager: getConnection(agent)
BaseAgentProvider → ACP Agent: prompt(stream)
ACP Agent → BaseAgentProvider: sessionUpdate
BaseAgentProvider → AcpContentMapper: map events
BaseAgentProvider → LLMProviderPresenter: yield LLMCoreStreamEvent
LLMProviderPresenter → Renderer: STREAM_EVENTS.RESPONSE
```

## 组件设计

### 1. 抽象层

- **BaseAgentProvider** (`src/main/presenter/llmProviderPresenter/baseAgentProvider.ts`)
  - 继承 `BaseLLMProvider`
  - 新增保护方法：`getSessionManager()`, `getProcessManager()`, `requestPermission()`
  - 统一 Agent Provider 生命周期钩子

- **ProviderInstanceManager** 重构
  - 根据 provider 配置识别 Agent/LLM 类型
  - 暴露 `isAgentProvider(providerId)`

- **类型定义** (`src/shared/types/presenters/agent-provider.d.ts`)
  - `AgentSessionState`, `AgentProcessHandle`, `AgentProviderMetadata`

### 2. Renderer Store

- **AgentModelStore** (`src/renderer/src/stores/agentModelStore.ts`)
  - 状态：`agentModels`, `sessionStatus`, `processStatus`
  - 方法：`refreshAgentModels`, `getSessionStatus(conversationId)`, `clearSessions`

- **ModelStore 重构**
  - 判断 provider 是否 Agent
  - Agent 模型刷新、状态查询委托给 AgentModelStore

### 3. ACP Provider 子模块

- **AcpProcessManager**
  - `Map<agentId, ProcessHandle>`
  - 负责 spawn、health check、重启、kill
  - API：`getConnection(agent)`, `release(agent)`

- **AcpSessionManager（内存）**
  - `Map<conversationId|agentId, SessionState>`
  - API：`getOrCreate(conversationId, agentId, initFn)`, `load`, `clear`, `clearAll`
  - 监听：provider 切换、窗口关闭、app before-quit → `clearAll`

- **AcpContentMapper**
  - 输入：`schema.SessionNotification`
  - 输出：`LLMCoreStreamEvent[]` + `AssistantMessageBlock[]`
  - 处理：`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `plan`, `image/audio/resource`

- **AcpMessageFormatter**
  - 输入：DeepChat `ChatMessage[]`
  - 输出：ACP prompt ContentBlock[]
  - 处理：系统提示、多模态、tool history、config（temperature 等）

- **AcpProvider**
  - 继承 `BaseAgentProvider`
  - `coreStream` 流程：

    1. 通过 SessionManager 获取 sessionId（无则 `session/new`）
    2. 获取 ProcessManager 连接
    3. `AcpMessageFormatter.formatMessages`
    4. 发起 `prompt` 调用
    5. 对 `sessionUpdate` 使用 `AcpContentMapper`，yield 标准事件
    6. 停止时清理 stream/queue，保留 session 于内存 Map

### 4. Session 生命周期图

```
          ┌────────────┐
  create ─►  ACTIVE     │
          │ (in-memory) │
          └─────┬───────┘
                │ Provider/model change / App exit
        clear() │
                ▼
          ┌────────────┐
          │ INVALID    │
          └────────────┘
```

## 实施步骤

1. 创建 `BaseAgentProvider`
2. 重构 `ProviderInstanceManager` 支持 Agent/LLM 区分
3. 添加 Agent Provider 类型定义
4. 实现 `AgentModelStore`
5. 重构 `ModelStore` 与 Agent store 协作
6. 实现 `AcpProcessManager`
7. 实现内存型 `AcpSessionManager`
8. 实现 `AcpContentMapper`
9. 实现 `AcpMessageFormatter`
10. 重构 `AcpProvider` 整合所有组件
11. 测试：session 切换、内容映射、工具调用、进程复用

## Todo 顺序

1. [x] step-1-base-agent
2. [x] step-2-instance-manager
3. [ ] step-3-agent-types
4. [ ] step-4-agent-store
5. [ ] step-5-model-store
6. [ ] step-6-process-manager
7. [ ] step-7-session-manager
8. [ ] step-8-content-mapper
9. [ ] step-9-message-formatter
10. [ ] step-10-acp-provider
11. [ ] step-11-testing

### To-dos

- [ ] 实现 AcpSessionManager，管理 session 生命周期和与 conversationId 的映射
- [ ] 实现 AcpProcessManager，管理 ACP agent 进程和连接复用
- [ ] 实现 AcpContentMapper，完整映射 ACP ContentBlock 到 DeepChat AssistantMessageBlock
- [ ] 实现 AcpMessageFormatter，将 DeepChat 消息格式化为 ACP prompt 格式
- [ ] 重构 AcpProvider，整合所有组件，支持 session/load 和完整的内容映射
- [ ] 测试 session 持久化、内容映射、工具调用等所有功能
