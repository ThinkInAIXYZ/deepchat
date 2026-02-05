# ACP Integration Architecture Specification

> DeepChat ACP (Agent Client Protocol) 集成架构规格文档
>
> 版本: 1.0
> 状态: 已实现
> 最后更新: 2025-01

## 1. 概述

### 1.1 什么是 ACP

ACP (Agent Client Protocol) 是一个用于客户端应用与本地 AI Agent 交互的协议。DeepChat 将 ACP 集成为一个功能完整的本地 Agent 执行系统，允许用户运行和管理本地 AI Agents（如 Kimi CLI、Claude Code、Codex）。

### 1.2 设计目标

- 将 ACP Agents 作为 LLM Provider 集成，复用现有的 Provider 架构
- 支持多 Agent、多 Profile 配置管理
- 实现 Agent 会话的生命周期管理
- 提供权限请求和安全沙箱机制
- 支持 Mode/Model 动态切换
- 与 MCP 工具系统无缝集成

### 1.3 架构概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Renderer Process                             │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │ AcpSettings  │  │ useAcpMode   │  │ Chat Input / Message List  │ │
│  │    .vue      │  │  Composable  │  │      Components            │ │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬───────────────┘ │
└─────────┼─────────────────┼───────────────────────┼─────────────────┘
          │ IPC             │ IPC                   │ IPC
┌─────────▼─────────────────▼───────────────────────▼─────────────────┐
│                          Main Process                                │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    LLMProviderPresenter                         ││
│  │  ┌─────────────────────────────────────────────────────────┐   ││
│  │  │                    AcpProvider                          │   ││
│  │  │   (extends BaseAgentProvider)                           │   ││
│  │  │  ┌─────────────────┐  ┌────────────────────────────┐   │   ││
│  │  │  │ AcpSession      │  │ AcpProcessManager          │   │   ││
│  │  │  │ Manager         │  │  - Subprocess spawning     │   │   ││
│  │  │  │  - Session      │  │  - ndJson RPC              │   │   ││
│  │  │  │    lifecycle    │  │  - FS/Terminal handlers    │   │   ││
│  │  │  └─────────────────┘  └────────────────────────────┘   │   ││
│  │  │  ┌─────────────────┐  ┌────────────────────────────┐   │   ││
│  │  │  │ AcpContent      │  │ AcpMessage                 │   │   ││
│  │  │  │ Mapper          │  │ Formatter                  │   │   ││
│  │  │  └─────────────────┘  └────────────────────────────┘   │   ││
│  │  └─────────────────────────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    ConfigPresenter                              ││
│  │  ┌─────────────────┐  ┌────────────────────────────────────┐   ││
│  │  │ AcpConfHelper   │  │ AcpInitHelper                      │   ││
│  │  │  - Agent store  │  │  - Installation                    │   ││
│  │  │  - Profile mgmt │  │  - Dependency check                │   ││
│  │  └─────────────────┘  └────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼ Subprocess (ndJson RPC)
┌─────────────────────────────────────────────────────────────────────┐
│                     ACP Agent Process                               │
│                  (kimi-cli / claude-code-acp / codex-acp)           │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. 核心组件详解

### 2.1 AcpProvider

**文件位置**: `src/main/presenter/llmProviderPresenter/providers/acpProvider.ts`

AcpProvider 是 ACP 集成的核心类，继承自 `BaseAgentProvider`，将 ACP Agents 暴露为可选择的 "模型"。

```typescript
class AcpProvider extends BaseAgentProvider<
  AcpSessionManager,
  AcpProcessManager,
  schema.RequestPermissionRequest,
  schema.RequestPermissionResponse
>
```

#### 核心方法

| 方法 | 职责 |
|------|------|
| `fetchProviderModels()` | 从配置获取启用的 Agents，生成模型列表 |
| `coreStream()` | 核心流生成，处理 Agent 通知并转换为事件流 |
| `handlePermissionRequest()` | 处理 Agent 的权限请求 |
| `resolvePermissionRequest()` | 处理用户的权限决策 |
| `setSessionMode()` / `setSessionModel()` | 切换会话的 Mode/Model |
| `getSessionModes()` / `getSessionModels()` | 查询可用的 Modes/Models |
| `runDebugAction()` | 调试功能，执行低级别 ACP 操作 |

#### Stream 流程

```
用户消息 → coreStream()
    │
    ├─ getOrCreateSession(agentId)
    │      └─ SessionManager.getOrCreateSession()
    │
    ├─ messageFormatter.format(messages)
    │      └─ 转换为 ACP ContentBlock[]
    │
    ├─ session.connection.prompt(contentBlocks)
    │      └─ 启动 Agent 处理循环
    │
    └─ 监听 SessionNotification
           │
           ├─ contentMapper.map(notification)
           │      └─ 转换为 LLMCoreStreamEvent
           │
           ├─ 处理 permission 请求
           │
           └─ yield 事件到 stream
```

### 2.2 AcpSessionManager

**文件位置**: `src/main/presenter/agentPresenter/acp/acpSessionManager.ts`

管理 ACP 会话的生命周期。

#### 数据结构

```typescript
interface AcpSessionRecord extends AgentSessionState {
  connection: ClientSideConnectionType
  workdir: string
  availableModels?: Array<{ id: string; name: string; description?: string }>
  currentModelId?: string
  availableModes?: Array<{ id: string; name: string; description: string }>
  currentModeId?: string
  detachHandlers: Array<() => void>
}
```

#### 核心功能

1. **会话创建与复用**
   - 检查现有会话是否可复用（相同 agent + workdir）
   - 创建新会话时初始化 protocol 握手
   - 应用持久化的首选 mode/model

2. **会话初始化流程**
   ```
   getOrCreateSession()
       │
       ├─ processManager.getConnection(agent, workdir)
       │
       ├─ connection.initialize()
       │      └─ ACP 协议握手
       │
       ├─ connection.newSession()
       │      └─ 创建新会话，获取 modes/models
       │
       └─ applyPreferredSettings()
              └─ 设置首选的 mode/model
   ```

### 2.3 AcpProcessManager

**文件位置**: `src/main/presenter/agentPresenter/acp/acpProcessManager.ts`

管理 ACP Agent 子进程的生命周期和通信。

#### 进程状态

| 状态 | 说明 |
|------|------|
| `warmup` | 预热状态，用于查询 modes/models |
| `bound` | 绑定状态，已关联到特定 conversation |

#### 进程缓存策略

```
┌──────────────────────────────────────────────────────────┐
│              Process Cache (per agentId::workdir)        │
├──────────────────────────────────────────────────────────┤
│  warmup processes:                                       │
│    "kimi-cli::/path/to/project" → Process1               │
│    "claude-code-acp::/path/to/work" → Process2           │
├──────────────────────────────────────────────────────────┤
│  bound processes:                                        │
│    "kimi-cli::/path/to/project" → Process1 (bound)       │
└──────────────────────────────────────────────────────────┘
```

#### 通信机制

- 使用 **ndJson RPC** 与 Agent 进程通信
- 支持 FS 请求处理 (`acpFsHandler.ts`)
- 支持 Terminal 命令执行 (`acpTerminalManager.ts`)

### 2.4 AcpContentMapper

**文件位置**: `src/main/presenter/agentPresenter/acp/acpContentMapper.ts`

将 ACP `SessionNotification` 映射为标准的 `LLMCoreStreamEvent`。

#### 映射表

| ACP Notification | LLMCoreStreamEvent |
|-----------------|-------------------|
| `agent_message_chunk` | `text` |
| `agent_thought_chunk` | `reasoning` |
| `tool_call` / `tool_call_update` | `toolCall` |
| `plan` | `plan` (结构化 plan entries) |
| `current_mode_update` | mode 变更通知 |

### 2.5 AcpMessageFormatter

**文件位置**: `src/main/presenter/agentPresenter/acp/acpMessageFormatter.ts`

将 `ChatMessage[]` 转换为 ACP `ContentBlock[]` 格式。

```typescript
format(messages: ChatMessage[]): ContentBlock[] {
  // 1. 构建配置信息
  // 2. 规范化消息内容
  // 3. 处理工具调用
  return contentBlocks
}
```

## 3. 配置管理

### 3.1 AcpConfHelper

**文件位置**: `src/main/presenter/configPresenter/acpConfHelper.ts`

#### 存储结构

```typescript
interface AcpStoreData {
  builtins: AcpBuiltinAgent[]   // 内置 agents
  customs: AcpCustomAgent[]      // 自定义 agents
  enabled: boolean               // 全局启用状态
  version: string
}

interface AcpBuiltinAgent {
  id: AcpBuiltinAgentId
  name: string
  enabled: boolean
  activeProfileId: string | null
  profiles: AcpAgentProfile[]    // 多 profile 支持
  mcpSelections?: string[]       // 关联的 MCP servers
}

interface AcpAgentProfile {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}
```

#### 内置 Agents

| Agent ID | 名称 | 默认命令 |
|----------|------|----------|
| `kimi-cli` | Kimi CLI | `uv tool install --python 3.13 kimi-cli` |
| `claude-code-acp` | Claude Code | `npm i -g @zed-industries/claude-code-acp` |
| `codex-acp` | Codex | `npm i -g @zed-industries/codex-acp` |

### 3.2 AcpInitHelper

**文件位置**: `src/main/presenter/configPresenter/acpInitHelper.ts`

处理 Agent 的初始化安装流程。

#### 初始化流程

```
initializeAgent(agentId)
    │
    ├─ checkDependencies()
    │      └─ 检查外部依赖 (如 Git Bash)
    │
    ├─ buildEnvironment()
    │      └─ 配置 PATH, npm registry 等
    │
    ├─ executeInstallCommands()
    │      └─ 执行安装命令
    │
    └─ createDefaultProfile()
           └─ 创建默认配置
```

### 3.3 会话持久化

**文件位置**: `src/main/presenter/agentPresenter/acp/acpSessionPersistence.ts`

在 SQLite 中持久化 ACP 会话信息。

```typescript
interface AcpSessionEntity {
  conversationId: string
  agentId: string
  sessionId: string | null
  workdir: string | null
  status: 'active' | 'completed' | 'error'
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}
```

## 4. 权限与安全

### 4.1 客户端能力

**文件位置**: `src/main/presenter/agentPresenter/acp/acpCapabilities.ts`

```typescript
const clientCapabilities: ClientCapabilities = {
  fs: {
    readTextFile: true,
    writeTextFile: true
  },
  terminal: true
}
```

### 4.2 文件系统安全

**文件位置**: `src/main/presenter/agentPresenter/acp/acpFsHandler.ts`

- 所有文件操作限制在会话的 workdir 内
- 阻止路径遍历攻击
- 提供 fallback 限制

### 4.3 权限请求处理

```typescript
// 权限请求流程
Agent 请求权限
    │
    ├─ AcpProvider.handlePermissionRequest()
    │      └─ 映射到 UI 权限请求
    │
    ├─ 用户决策 (allow/deny)
    │
    └─ AcpProvider.resolvePermissionRequest()
           └─ 选择合适的权限选项并响应 Agent
```

## 5. UI 集成

### 5.1 ACP Mode Composable

**文件位置**: `src/renderer/src/components/chat-input/composables/useAcpMode.ts`

```typescript
export function useAcpMode(options: UseAcpModeOptions) {
  // 可用 modes 列表
  const availableModes = ref<AcpMode[]>([])

  // 当前 mode
  const currentMode = ref<AcpMode | null>(null)

  // 切换 mode
  const cycleMode = async () => { ... }

  // 设置特定 mode
  const setMode = async (modeId: string) => { ... }

  // 加载 modes
  const loadModes = async () => { ... }

  return { availableModes, currentMode, cycleMode, setMode, loadModes }
}
```

### 5.2 事件系统

```typescript
// ACP 相关事件
ACP_WORKSPACE_EVENTS = {
  SESSION_MODES_READY: 'acp-workspace:session-modes-ready',
  SESSION_MODELS_READY: 'acp-workspace:session-models-ready'
}

ACP_DEBUG_EVENTS = {
  EVENT: 'acp-debug:event'
}
```

### 5.3 设置界面

**文件位置**: `src/renderer/settings/components/AcpSettings.vue`

功能包括：
- ACP 全局开关
- Builtin agents 管理
- Custom agents 管理
- Profile 配置
- MCP server 关联
- 初始化/调试 dialogs

## 6. 数据流与生命周期

### 6.1 完整 Stream 流程

```
┌─────────────┐
│ 用户输入消息 │
└──────┬──────┘
       ▼
┌──────────────────────────────────────┐
│ ThreadPresenter.sendMessage()        │
│   - 创建 conversation/message        │
└──────┬───────────────────────────────┘
       ▼
┌──────────────────────────────────────┐
│ LLMProviderPresenter                 │
│   .startStreamCompletion()           │
│   - providerId = 'acp'               │
└──────┬───────────────────────────────┘
       ▼
┌──────────────────────────────────────┐
│ AcpProvider.coreStream()             │
│                                      │
│  ┌──────────────────────────────┐   │
│  │ SessionManager               │   │
│  │   .getOrCreateSession()      │   │
│  │   - warmup/bind process      │   │
│  │   - initialize RPC           │   │
│  │   - newSession RPC           │   │
│  │   - apply mode/model         │   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌──────────────────────────────┐   │
│  │ MessageFormatter.format()    │   │
│  │   - messages → ContentBlock[]│   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌──────────────────────────────┐   │
│  │ connection.prompt()          │   │
│  │   - 启动 Agent Loop          │   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌──────────────────────────────┐   │
│  │ 监听 SessionNotification     │   │
│  │   - ContentMapper.map()      │   │
│  │   - 生成事件                  │   │
│  │   - 处理权限请求              │   │
│  └──────────────────────────────┘   │
└──────┬───────────────────────────────┘
       ▼
┌──────────────────────────────────────┐
│ AgentLoopHandler                     │
│   - 积累 content                     │
│   - 处理 tool_calls                  │
│   - 处理 permissions                 │
│   - 更新数据库/UI                    │
└──────┬───────────────────────────────┘
       ▼
┌──────────────┐
│ 渲染层显示响应│
└──────────────┘
```

### 6.2 Mode/Model 切换流程

```
┌────────────────────────────────────────────────────────────┐
│                     预启动阶段                              │
├────────────────────────────────────────────────────────────┤
│  用户选择 agent + workdir                                  │
│      │                                                     │
│      ▼                                                     │
│  useAcpMode.loadWarmupModes()                             │
│      │                                                     │
│      ├─ processManager.getProcessModes()                  │
│      │     └─ 从 warmup 进程读取                          │
│      │                                                     │
│      └─ 显示 mode button                                  │
│           └─ 用户可切换首选 mode                          │
│                  │                                         │
│                  ▼                                         │
│           processManager.setPreferredMode()               │
│                  └─ 存储首选项                            │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│                   Session 启动后                           │
├────────────────────────────────────────────────────────────┤
│  开始 streaming                                            │
│      │                                                     │
│      ▼                                                     │
│  Session 创建                                              │
│      │                                                     │
│      ├─ 发送 SESSION_MODES_READY 事件                      │
│      │                                                     │
│      └─ useAcpMode.handleModesReady()                     │
│           ├─ 更新 availableModes                          │
│           └─ 应用首选 mode                                │
│                                                            │
│  用户切换 mode                                             │
│      │                                                     │
│      ▼                                                     │
│  AcpProvider.setSessionMode()                             │
│      └─ session.connection.setSessionMode()               │
│           └─ ACP RPC 调用                                 │
└────────────────────────────────────────────────────────────┘
```

### 6.3 清理与关闭

**文件位置**: `src/main/presenter/lifecyclePresenter/hooks/beforeQuit/acpCleanupHook.ts`

```
应用关闭
    │
    ├─ sessionManager.clearAllSessions()
    │      └─ 取消所有活跃会话
    │
    └─ processManager.shutdown()
           └─ 关闭所有子进程
```

## 7. 文件清单

| 功能模块 | 文件路径 | 主要职责 |
|---------|---------|---------|
| **Provider** | `src/main/presenter/llmProviderPresenter/providers/acpProvider.ts` | Agent Provider 实现 |
| **Session** | `src/main/presenter/agentPresenter/acp/acpSessionManager.ts` | 会话生命周期管理 |
| **Process** | `src/main/presenter/agentPresenter/acp/acpProcessManager.ts` | 进程管理与通信 |
| **Mapper** | `src/main/presenter/agentPresenter/acp/acpContentMapper.ts` | 内容映射 |
| **Formatter** | `src/main/presenter/agentPresenter/acp/acpMessageFormatter.ts` | 消息格式化 |
| **Config** | `src/main/presenter/configPresenter/acpConfHelper.ts` | 配置存储管理 |
| **Init** | `src/main/presenter/configPresenter/acpInitHelper.ts` | Agent 初始化 |
| **Persistence** | `src/main/presenter/agentPresenter/acp/acpSessionPersistence.ts` | 会话持久化 |
| **Capabilities** | `src/main/presenter/agentPresenter/acp/acpCapabilities.ts` | 客户端能力定义 |
| **FS Handler** | `src/main/presenter/agentPresenter/acp/acpFsHandler.ts` | 文件系统处理 |
| **Terminal** | `src/main/presenter/agentPresenter/acp/acpTerminalManager.ts` | 终端命令管理 |
| **UI Mode** | `src/renderer/src/components/chat-input/composables/useAcpMode.ts` | Mode 管理 composable |
| **UI Settings** | `src/renderer/settings/components/AcpSettings.vue` | 设置界面 |

## 8. 类型定义

### 8.1 核心类型

```typescript
// Agent 配置
interface AcpAgentConfig {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

// Profile
interface AcpAgentProfile extends AcpAgentConfig {
  id: string
  name: string
}

// Builtin Agent
interface AcpBuiltinAgent {
  id: AcpBuiltinAgentId
  name: string
  enabled: boolean
  activeProfileId: string | null
  profiles: AcpAgentProfile[]
  mcpSelections?: string[]
}

// Session Entity
interface AcpSessionEntity {
  conversationId: string
  agentId: string
  sessionId: string | null
  workdir: string | null
  status: AgentSessionLifecycleStatus
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

// Workdir Info
interface AcpWorkdirInfo {
  path: string
  isCustom: boolean
}
```

## 9. 扩展点与改进方向

### 9.1 当前限制

1. **权限系统**：基础实现，可进一步细化权限粒度
2. **会话复用**：当前策略较简单，可优化复用逻辑
3. **错误恢复**：可增强进程崩溃后的自动恢复机制

### 9.2 可扩展方向

1. **新增内置 Agent**：在 `BUILTIN_INIT_COMMANDS` 添加配置
2. **自定义能力**：扩展 `acpCapabilities.ts` 中的能力定义
3. **新增 Notification 类型**：在 `acpContentMapper.ts` 添加映射
4. **UI 增强**：扩展 `useAcpMode.ts` 和设置界面

## 10. 参考资料

- [Agent Client Protocol Specification](https://github.com/ArcCompute/acp)
- DeepChat 架构文档: `docs/architecture/`
- MCP 集成文档: `docs/specs/skills-system/`
