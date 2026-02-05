# ACP Agent 服务独立架构设计

**版本**: v1.0-draft
**日期**: 2026-01-25
**状态**: 讨论中

## 背景与动机

### 当前问题

ACP (Agent Client Protocol) 的核心设计理念是：**数据持久化与存储完全由外部 Agent 实现**。DeepChat 作为 ACP Client，只负责：
1. 启动和管理 Agent 进程
2. 通过 ACP 协议与 Agent 通信
3. 展示 Agent 返回的内容

然而，当前实现存在以下问题：

#### 1. ACP 被错误地嵌入 LLM Provider 体系

**现状**：
- `AcpProvider` 继承自 `BaseLLMProvider`
- ACP Agent 被当作 "模型" 注册到 Provider 系统
- 通过 `fetchProviderModels()` 将 Agent 转换为 `MODEL_META`

**问题**：
- ACP Agent 不是 LLM Provider，它是完整的 Agent 系统
- Agent 有自己的模型选择（通过 `setSessionModel`）
- 这种设计导致概念混淆和不必要的耦合

```
当前架构（错误）:
LLMProviderPresenter
└── AcpProvider (extends BaseLLMProvider)
    └── ACP Agents (作为 "models")

正确架构:
LLMProviderPresenter          AcpPresenter (独立)
└── OpenAI, Claude, etc.      └── ACP Agents
```

#### 2. 消息处理逻辑混乱

**现状** (`acpMessageFormatter.ts:10-52`):
```typescript
format(messages: ChatMessage[], modelConfig: ModelConfig): schema.ContentBlock[] {
  // 将所有历史消息格式化为 ContentBlock[]
  messages.forEach((message) => {
    const prefix = (message.role || 'unknown').toUpperCase()
    // ... 格式化每条消息
  })
}
```

**问题**：
- DeepChat 将完整对话历史传递给 ACP Agent
- 违反 ACP 协议设计：`prompt` 字段应该只是 "the user's message"
- ACP Session 应该自己管理上下文（如 Claude Code 的 `.claude/sessions/`）
- 消息处理逻辑与 LLM Provider 混在一起（通过 `AgentPresenter` → `LLMProviderPresenter` → `AcpProvider`）

**正确做法**：
- 只传递当前用户输入
- 让 ACP Agent 自己管理会话历史
- 消息处理逻辑应该独立，不经过 LLM Provider 体系

#### 3. 数据存储职责混乱

**现状**：
- `acp_sessions` 表存储 ACP 会话元数据（sessionId, workdir, status 等）
- DeepChat 的 `conversations` 表存储消息历史
- 两套数据存储系统并存，职责不清

**问题**：
- **ACP Session 的持久化应该完全由 Agent 自己管理**（如 `.claude/sessions/`）
- DeepChat 不应该持久化任何 ACP Session 数据
- 当前的 `acp_sessions` 表是多余的，违反了 ACP 的设计原则
- Session 生命周期应该与进程生命周期一致，进程退出后 Session 自然失效

#### 4. Session 与 Conversation 概念混淆

**现状** (`acpSessionManager.ts`):
- `conversationId` 作为 Session 的 key
- Session 与 DeepChat 的 Conversation 绑定

**问题**：
- ACP Session 是 Agent 端的概念
- DeepChat Conversation 是客户端的概念
- 两者不应该强绑定

## 架构调整目标

### 核心原则

1. **ACP 服务完全独立**：不依赖 LLM Provider 体系
2. **零持久化**：DeepChat 不持久化任何 ACP Session 数据，所有数据由 Agent 管理
3. **内存管理**：Session 状态只在内存中维护，与进程生命周期一致
4. **职责清晰**：DeepChat 只负责 UI 展示和进程管理
5. **协议正确性**：严格遵循 ACP 协议规范

### 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Process                              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              独立的 ACP 服务层                          │  │
│  │                                                         │  │
│  │  ┌─────────────────┐  ┌─────────────────────────────┐  │  │
│  │  │  AcpPresenter   │  │     AcpProcessManager       │  │  │
│  │  │  (对外接口)      │  │     (进程生命周期管理)       │  │  │
│  │  └────────┬────────┘  └─────────────────────────────┘  │  │
│  │           │                                             │  │
│  │  ┌────────▼────────┐  ┌─────────────────────────────┐  │  │
│  │  │ AcpSessionMgr   │  │     AcpFsHandler            │  │  │
│  │  │ (会话管理)       │  │     AcpTerminalManager      │  │  │
│  │  └─────────────────┘  └─────────────────────────────┘  │  │
│  │                                                         │  │
│  │  数据存储：无持久化，所有状态在内存中                    │  │
│  │  Session 生命周期：与进程生命周期一致                    │  │
│  │  消息历史：完全由 ACP Agent 自己管理                    │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              LLM Provider 层（独立）                    │  │
│  │  - OpenAI, Claude, Gemini, Ollama, etc.                │  │
│  │  - 不包含 ACP                                          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              基础设施（复用）                           │  │
│  │  EventBus | MCP | SQLite | RuntimeHelper | Lifecycle  │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 基础设施复用说明

ACP 服务层复用以下基础设施模块：

#### 1. EventBus
- **用途**：跨进程事件通信（Main Process → Renderer Process）
- **复用内容**：
  - 发送 ACP 事件到 UI 层（Session 更新、权限请求、错误通知等）
  - 发送 Workspace 事件（文件变化、模式/模型就绪等）

#### 2. MCP Presenter
- **用途**：MCP 服务器配置和镜像源管理
- **复用内容**：
  - `getNpmRegistry()` - 获取最快的 npm 镜像源（用于 Agent 依赖安装）
  - `getUvRegistry()` - 获取最快的 Python uv 镜像源
  - `getMcpServers()` - 获取 MCP 服务器配置，通过 `convertMcpConfigToAcpFormat()` 转换为 ACP 格式传递给 Agent

#### 3. RuntimeHelper
- **用途**：管理内置运行时环境
- **复用内容**：
  - 管理内置的 Node.js、Python uv、ripgrep 等运行时
  - 为 ACP Agent 进程提供运行时环境准备
  - 支持用户选择使用内置运行时或系统运行时

#### 4. ConfigPresenter
- **用途**：配置管理
- **复用内容**：
  - `getAcpEnabled()` - 获取 ACP 启用状态
  - `getAcpAgents()` - 获取 ACP Agent 配置列表
  - `getAcpUseBuiltinRuntime()` - 是否使用内置运行时
  - `setProviderModels()` - 设置 Provider 的模型列表

#### 5. Agent 工具系统（核心复用）
- **用途**：为 Agent 提供文件系统、命令执行、Skill 等工具能力
- **复用内容**：
  - `AgentToolManager` - 统一的工具管理器
  - `AgentFileSystemHandler` - 文件系统工具（read_file, write_file, glob_search 等）
  - `AgentBashHandler` - Bash 命令执行工具
  - `ChatSettingsToolHandler` - DeepChat 设置工具
  - Skill 工具、YoBrowser 工具等
- **重要说明**：
  - 这套工具系统是 **DeepChat Agent 服务的核心组件**
  - 两种 Agent 模式都使用这套工具：
    - `chatMode: 'agent'` - 普通 LLM Agent 模式
    - `chatMode: 'acp agent'` - ACP Agent 模式
  - ACP 通过 ToolPresenter 调用这些工具，不是 ACP 专用的

#### 6. Lifecycle Presenter
- **用途**：应用生命周期管理
- **复用内容**：
  - `beforeQuit` hook - 应用退出前清理 ACP 进程
  - `acpCleanupHook` - 确保所有 ACP Agent 进程正确关闭

## 工具调用架构

### 两种 Agent 模式的工具调用流程

DeepChat 支持两种 Agent 模式，它们共享同一套工具系统：

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent 对话流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  用户输入                                                     │
│    ↓                                                         │
│  AgentPresenter (统一的对话管理层)                           │
│    ↓                                                         │
│  根据 chatMode 分发：                                        │
│    ├─ chatMode: 'agent'      → LLM Provider (OpenAI/Claude) │
│    └─ chatMode: 'acp agent'  → ACP Agent (外部进程)         │
│                                                              │
│  Agent 返回 tool_use                                         │
│    ↓                                                         │
│  ToolPresenter (统一的工具调度层)                            │
│    ↓                                                         │
│  根据工具类型路由：                                          │
│    ├─ MCP 工具        → McpPresenter                        │
│    ├─ Agent 工具      → AgentToolManager                    │
│    └─ 其他工具        → YoBrowserPresenter 等               │
│                                                              │
│  工具执行结果                                                │
│    ↓                                                         │
│  返回给 Agent (LLM 或 ACP Agent)                            │
│    ↓                                                         │
│  Agent 继续处理                                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Agent 工具系统详解

**位置**：`src/main/presenter/agentPresenter/tools/` (Phase 5 后)

**组成**：
```
agentPresenter/tools/
├── toolManager.ts           # 统一的工具管理器
├── fileSystemHandler.ts     # 文件系统工具
│   ├── read_file           # 读取文件
│   ├── write_file          # 写入文件
│   ├── list_directory      # 列出目录
│   ├── glob_search         # Glob 搜索
│   ├── grep_search         # 内容搜索
│   └── ...                 # 其他文件操作
├── bashHandler.ts          # Bash 命令执行
│   └── execute_command     # 执行 Shell 命令
├── settingsTools.ts        # DeepChat 设置工具
│   ├── deepchat_settings_toggle
│   ├── deepchat_settings_set_language
│   └── ...
└── commandProcessTracker.ts # 命令进程跟踪
```

**关键特性**：
1. **通用性**：两种 Agent 模式都使用这套工具
2. **权限管理**：统一的权限检查机制
3. **Workdir 隔离**：每个 Session 有独立的工作目录
4. **进程管理**：命令执行的进程生命周期管理

### ACP 协议的工具调用机制

**重要理解**：ACP 协议设计上，Client（DeepChat）就是要"代理"工具执行的。

```
┌─────────────────┐                    ┌─────────────────┐
│   ACP Agent     │                    │  DeepChat       │
│  (外部进程)      │                    │  (ACP Client)   │
└────────┬────────┘                    └────────┬────────┘
         │                                      │
         │ 1. 用户输入                          │
         │◄─────────────────────────────────────┤
         │                                      │
         │ 2. Agent 决策：需要读取文件          │
         │                                      │
         │ 3. 返回 tool_use                     │
         │  { name: "read_file", args: {...} }  │
         ├─────────────────────────────────────►│
         │                                      │
         │                                      │ 4. DeepChat 执行工具
         │                                      │    AgentToolManager.callTool()
         │                                      │    ├─ 权限检查
         │                                      │    ├─ 文件读取
         │                                      │    └─ 返回内容
         │                                      │
         │ 5. 工具执行结果                      │
         │◄─────────────────────────────────────┤
         │                                      │
         │ 6. Agent 继续处理                    │
         │                                      │
```

**为什么这样设计？**
- ✅ **安全性**：Agent 不直接访问文件系统，所有操作由 Client 控制
- ✅ **权限管理**：Client 可以统一管理权限，用户确认后才执行
- ✅ **跨平台**：Agent 不依赖本地环境，可以在任何平台运行
- ✅ **审计**：所有工具调用都经过 Client，便于记录和审计

## 详细设计

### 1. 新建 AcpPresenter

**职责**：
- ACP Agent 的注册、发现、配置管理
- 对外提供统一的 ACP 服务接口
- 不继承任何 LLM Provider 相关类

**接口设计**：
```typescript
interface IAcpPresenter {
  // Agent 管理
  getAgents(): Promise<AcpAgentConfig[]>
  getAgentById(agentId: string): Promise<AcpAgentConfig | null>

  // Session 管理（核心）
  // 注意：返回的是 Plain Object，不包含 connection 等可调用对象
  createSession(agentId: string, workdir: string): Promise<AcpSessionInfo>
  loadSession(agentId: string, sessionId: string, workdir: string): Promise<AcpSessionInfo>
  getSessionInfo(sessionId: string): AcpSessionInfo | null
  closeSession(sessionId: string): Promise<void>

  // 消息发送（支持多模态）
  sendPrompt(sessionId: string, input: AcpPromptInput): Promise<void>
  cancelPrompt(sessionId: string): Promise<void>

  // Mode/Model 管理
  setSessionMode(sessionId: string, modeId: string): Promise<void>
  setSessionModel(sessionId: string, modelId: string): Promise<void>

  // 权限处理
  resolvePermission(requestId: string, granted: boolean): Promise<void>

  // 进程管理
  warmupProcess(agentId: string, workdir: string): Promise<void>
  releaseProcess(agentId: string): Promise<void>
}

// 返回给 UI 的 Plain Object（可以通过 IPC 传递）
interface AcpSessionInfo {
  sessionId: string           // Agent 生成的 Session ID
  agentId: string
  workdir: string             // 不可变
  status: 'active' | 'idle'
  createdAt: number

  // Agent 提供的能力（Plain Data）
  availableModes?: Array<{ id: string; name: string; description: string }>
  currentModeId?: string
  availableModels?: Array<{ id: string; name: string; description?: string }>
  currentModelId?: string
  availableCommands?: Array<{ name: string; description: string }>
}

// 多模态输入支持
interface AcpPromptInput {
  text?: string
  images?: Array<{
    type: 'url' | 'base64' | 'file'
    data: string
  }>
  files?: Array<{
    path: string
    name: string
  }>
}
```

**消息处理流程**：
1. UI 调用 `sendPrompt(sessionId, input)`
2. AcpPresenter 通过 `AcpInputFormatter` 将多模态输入格式化为 `ContentBlock[]`
3. 直接发送给 Agent 的 `connection.prompt()`
4. Agent 响应通过 `SessionNotification` 事件返回
5. `AcpContentMapper` 将 Agent 响应映射为 UI 事件

### 2. 重构 AcpSessionManager

**关键改动**：

#### 2.1 移除 conversationId 依赖，Workdir 不可变

```typescript
// 当前（错误）
interface AcpSessionRecord {
  conversationId: string  // 与 DeepChat Conversation 绑定
  // ...
}

// 调整后
interface AcpSessionRecord {
  sessionId: string       // ACP Session ID（由 Agent 生成）
  agentId: string
  workdir: string         // 不可变！Session 隶属于 Workdir
  connection: ClientSideConnection  // 内部使用，不暴露给 UI
  // 不再与 DeepChat Conversation 绑定
}

// 关键约束：
// 1. Workdir 在 Session 创建后不可变
// 2. 要切换 Workdir 必须创建新的 Session
// 3. Session 生命周期完全由 ACP Agent 管理
```

#### 2.2 修正消息传递

**当前（错误）**：传递完整历史消息
**调整后**：只传递当前用户输入，历史由 Agent 自己管理

#### 2.3 拆分消息处理流程

**当前流程（错误）**：
```
用户输入
  ↓
AgentPresenter.sendMessage()
  ↓
StreamGenerationHandler.startStreamCompletion()
  ↓
LLMProviderPresenter.getProviderInstance('acp')
  ↓
AcpProvider.coreStream()
  ↓
AcpMessageFormatter.format(allMessages)  ← 传递完整历史
  ↓
connection.prompt()
```

**调整后流程（正确）**：
```
用户输入
  ↓
AcpPresenter.sendPrompt()  ← 直接调用，不经过 LLM Provider
  ↓
AcpInputFormatter.formatUserInput(currentInput)  ← 只格式化当前输入
  ↓
connection.prompt()
```

**关键改动**：
1. **移除 AgentPresenter 对 ACP 的调用**：`AgentPresenter` 只处理普通 LLM 对话
2. **新建独立的 ACP 消息入口**：UI 直接调用 `AcpPresenter.sendPrompt()`
3. **简化输入格式化**：`AcpInputFormatter` 只处理当前用户输入，不涉及历史消息

### 3. 数据存储调整

#### 3.1 移除 acp_sessions 表

```sql
-- 当前表结构（需要删除）
CREATE TABLE acp_sessions (
  id INTEGER PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT UNIQUE,
  workdir TEXT,
  status TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  metadata TEXT
);

-- 调整后：完全移除此表
-- ACP Session 不需要持久化，所有状态在内存中维护
```

**理由**：
- ACP Session 的持久化由 Agent 自己管理（如 `.claude/sessions/`）
- DeepChat 只需要在内存中维护活跃的 Session 状态
- Session 生命周期与进程生命周期一致
- 进程退出后，Session 自然失效，由 Agent 负责恢复

#### 3.2 内存中的 Session 管理

**数据结构**：
```typescript
// Session 记录（仅内存，不持久化）
interface AcpSessionRecord {
  sessionId: string           // Agent 生成的 Session ID
  agentId: string
  workdir: string
  connection: ClientSideConnection  // 内部使用，不暴露给 UI
  status: 'active' | 'idle'
  createdAt: number

  // Agent 提供的能力
  availableModes?: AcpMode[]
  currentModeId?: string
  availableModels?: AcpModel[]
  currentModelId?: string
}
```

**管理策略**：
- 使用 `Map<sessionId, AcpSessionRecord>` 在内存中维护活跃 Session
- Session 生命周期与进程生命周期一致
- 应用重启后，Session 需要通过 `loadSession` 从 Agent 恢复

### 4. 消息处理流程调整

#### 4.1 当前流程（错误）
```
用户输入
  ↓
AgentPresenter.sendMessage()
  ↓
StreamGenerationHandler.startStreamCompletion()
  ↓
LLMProviderPresenter.getProviderInstance('acp')
  ↓
AcpProvider.coreStream()
  ↓
AcpMessageFormatter.format(allMessages)  ← 传递完整历史
  ↓
connection.prompt()
```

#### 4.2 调整后流程（正确）
```
用户输入
  ↓
AcpPresenter.sendPrompt()  ← 直接调用，不经过 LLM Provider
  ↓
AcpInputFormatter.formatUserInput(currentInput)  ← 只格式化当前输入
  ↓
connection.prompt()
```

**关键改动**：
1. **移除 AgentPresenter 对 ACP 的调用**：`AgentPresenter` 只处理普通 LLM 对话
2. **新建独立的 ACP 消息入口**：UI 直接调用 `AcpPresenter.sendPrompt()`
3. **简化输入格式化**：`AcpInputFormatter` 只处理当前用户输入，不涉及历史消息

#### 4.3 移除 AcpProvider

**当前位置**：`src/main/presenter/llmProviderPresenter/providers/acpProvider.ts`

**改动**：
- 删除 `AcpProvider` 类（1289 行代码）
- 从 `ProviderInstanceManager` 中移除 ACP 相关逻辑
- 将核心功能迁移到独立的 `AcpPresenter`：
  - 进程管理 → `AcpProcessManager`
  - 会话管理 → `AcpSessionManager`
  - 消息发送 → `AcpPresenter.sendPrompt()`
  - 权限处理 → `AcpPermissionHandler`

### 5. UI 层调整

#### 5.1 独立的 ACP 会话视图

```
当前 UI 流程（混合）:
选择 Provider → 选择 Model (ACP Agent) → 对话

调整后 UI 流程（分离）:
[普通对话]
选择 Provider → 选择 Model → 对话

[ACP Agent]
选择 Agent → 选择 Workspace → 创建/加载 Session → 对话
```

#### 5.2 事件系统调整

**ACP 独立事件**：
```typescript
export const ACP_EVENTS = {
  // Session 生命周期
  SESSION_CREATED: 'acp:session-created',
  SESSION_LOADED: 'acp:session-loaded',
  SESSION_CLOSED: 'acp:session-closed',

  // 消息流
  PROMPT_STARTED: 'acp:prompt-started',
  SESSION_UPDATE: 'acp:session-update',      // Agent 返回的内容更新
  PROMPT_COMPLETED: 'acp:prompt-completed',
  PROMPT_CANCELLED: 'acp:prompt-cancelled',

  // 权限请求
  PERMISSION_REQUEST: 'acp:permission-request',
  PERMISSION_RESOLVED: 'acp:permission-resolved',

  // Mode/Model 变化
  MODE_CHANGED: 'acp:mode-changed',
  MODEL_CHANGED: 'acp:model-changed',
  COMMANDS_UPDATE: 'acp:commands-update',

  // 错误
  ERROR: 'acp:error'
}
```

#### 5.3 UI 组件使用示例

**基本流程**：
1. 用户选择 Agent 和 Workdir
2. 尝试加载上次的 Session（通过 localStorage 记录的 sessionId）
3. 如果加载失败，创建新 Session
4. 发送消息（支持多模态）
5. 监听 `ACP_EVENTS.SESSION_UPDATE` 获取 Agent 返回的内容

**注意**：`AcpSessionInfo` 是 Plain Object，可以安全地通过 IPC 传递和存储

### 6. 多模态输入支持

**输入接口**：
```typescript
interface AcpPromptInput {
  text?: string
  images?: Array<{
    type: 'url' | 'base64' | 'file'
    data: string
  }>
  files?: Array<{
    path: string
    name: string
  }>
}
```

**格式化流程**：
1. `AcpInputFormatter` 将多模态输入转换为 `ContentBlock[]`
2. 文本 → `{ type: 'text', text: string }`
3. 图片 → `{ type: 'resource_link', uri: string, name: 'image' }`
4. 文件 → `{ type: 'resource_link', uri: 'file://...', name: string }`

### 7. 并发控制设计

**核心原则**：
- **进程级并发**：支持多个 Agent 进程同时运行（不同 Agent 或不同 Workdir）
- **Session 级并发**：支持多个 Session 同时活跃（不同 Workdir）
- **UI 级唯一性**：同一个 Session 只能有一个活跃的 UI 交互界面（由 UI 层实现）

**Session-UI 绑定协议（UI 层实现）**：

这是一个 **UI 层协议**，不在 Presenter 中实现。UI 组件需要遵循以下约定：

1. **UI 标识生成**：每个 UI 组件（Tab/Window）生成唯一的 `uiId`
2. **Session 绑定检查**：在使用 Session 前，检查是否已被其他 UI 占用
3. **绑定状态管理**：UI 组件维护 Session 到 UI 的绑定关系（可使用 Pinia store）
4. **生命周期管理**：
   - `onMounted`: 尝试绑定 Session
   - `onUnmounted`: 解绑 Session（但不关闭 Session）

**绑定数据结构（UI 层）**：
```typescript
// 在 Pinia store 中维护
interface SessionUIBinding {
  sessionId: string
  uiId: string        // Tab ID 或 Window ID
  boundAt: number
}
```

**并发场景示例**：
```
场景 1：多个 Workdir
- Tab 1: Agent A + Workdir /project1 → Session S1 ✅
- Tab 2: Agent A + Workdir /project2 → Session S2 ✅
- 两个 Session 可以同时活跃

场景 2：同一个 Workdir，不同 Session
- Tab 1: Agent A + Workdir /project1 → Session S1 ✅
- Tab 2: Agent A + Workdir /project1 → Session S3 (新建) ✅
- 两个 Session 可以同时活跃

场景 3：同一个 Session，多个 UI（由 UI 层控制）
- Tab 1: Session S1 → 已绑定 ✅
- Tab 2: 尝试使用 Session S1 → UI 层检测到冲突，提示用户 ❌
- 提示用户：Session 正在其他窗口使用
```

### 8. 异常处理设计

#### 8.1 进程级异常

| 异常类型 | 触发条件 | 影响范围 | 处理策略 |
|---------|---------|---------|---------|
| **进程启动失败** | Agent 可执行文件不存在、权限不足 | 单个 Agent | 显示错误提示，禁用该 Agent |
| **进程崩溃** | Agent 进程意外退出 | 该 Agent 的所有 Session | 通知所有相关 UI，提供重启选项 |
| **进程超时** | 进程启动超过 5 分钟无响应 | 单个 Agent | 终止进程，显示超时错误 |
| **进程僵死** | 进程无响应但未退出 | 该 Agent 的所有 Session | 强制终止进程，重启 |

**处理流程**：
1. `AcpProcessManager` 启动健康检查（每 5 秒检查进程状态）
2. 检测到进程崩溃时，清理所有相关 Session
3. 通过 `ACP_EVENTS.PROCESS_CRASHED` 通知所有相关 UI
4. UI 显示错误提示，提供重启选项

#### 8.2 Session 级异常

| 异常类型 | 触发条件 | 影响范围 | 处理策略 |
|---------|---------|---------|---------|
| **Session 创建失败** | Agent 拒绝创建 Session | 单个 Session | 显示错误提示，允许重试 |
| **Session 加载失败** | Session ID 不存在或已过期 | 单个 Session | 自动创建新 Session |
| **Session 超时** | Prompt 请求超过 10 分钟无响应 | 单个 Session | 取消请求，Session 保持活跃 |
| **Session 失效** | Agent 主动关闭 Session | 单个 Session | 通知 UI，提供重新创建选项 |

**处理流程**：
1. `loadSession` 失败时，自动回退到 `createSession`
2. `sendPrompt` 设置 10 分钟超时，超时后自动调用 `cancel`
3. 通过 `ACP_EVENTS.PROMPT_TIMEOUT` 通知 UI
4. UI 层捕获异常，根据错误类型执行相应处理

#### 8.3 网络/通信异常

| 异常类型 | 触发条件 | 影响范围 | 处理策略 |
|---------|---------|---------|---------|
| **IPC 通信失败** | 进程间通信中断 | 单个进程 | 重启进程 |
| **协议错误** | Agent 返回非法响应 | 单个请求 | 记录错误，显示提示 |
| **权限被拒绝** | Agent 拒绝权限请求 | 单个操作 | 通知 UI，继续执行 |

#### 8.4 异常事件定义

```typescript
export const ACP_EVENTS = {
  // 核心事件
  SESSION_UPDATE: 'acp:session-update',
  PERMISSION_REQUEST: 'acp:permission-request',

  // 异常事件
  PROCESS_CRASHED: 'acp:process-crashed',
  SESSION_FAILED: 'acp:session-failed',
  PROMPT_TIMEOUT: 'acp:prompt-timeout',
  ERROR: 'acp:error'
}
```

**UI 层异常处理策略**：
- `SESSION_NOT_FOUND`: 尝试重新创建 Session
- `PROCESS_CRASHED`: 显示错误提示，提供重启按钮
- `Prompt timeout`: 显示超时警告
- 其他错误: 显示通用错误提示

## 迁移策略

### Phase 1: 创建独立的 ACP 服务层

1. 新建 `src/main/presenter/acpPresenter/` 目录
2. 实现 `AcpPresenter` 接口及相关组件
3. 迁移现有 ACP 相关代码（不删除旧代码）
4. 新旧系统并存，通过配置切换

### Phase 2: 拆分消息处理逻辑

**关键改动**：
1. 实现 `AcpInputFormatter`：支持多模态输入格式化
2. 在 `AcpPresenter` 中实现独立的消息发送流程
3. 移除 `AgentPresenter` 对 ACP 的调用
4. 更新事件监听：从 `STREAM_EVENTS` 迁移到 `ACP_EVENTS`
5. 确保所有通过 IPC 传递的对象都是可序列化的 Plain Object

### Phase 3: 移除数据持久化

**改动清单**：
1. 删除 `acp_sessions` 表及相关代码
2. 移除 `AcpSessionPersistence` 类
3. 将 Session 管理改为纯内存实现
4. 清理与 `conversations` 表的关联

### Phase 4: 移除旧代码

**清理范围**：
1. 删除 `AcpProvider` 类（1289 行）
2. 清理 `LLMProviderPresenter` 中的 ACP 相关逻辑
3. 更新 UI 组件，使用新的 ACP 服务接口

## 兼容性考虑

### 对现有用户的影响

1. **会话持久化**：调整后，DeepChat 不再持久化 ACP Session
   - 影响：应用重启后，需要重新创建或加载 Session
   - 解决方案：由 ACP Agent 自己管理 Session 恢复（通过 `loadSession`）

2. **历史数据清理**：现有的 `acp_sessions` 表数据将被清理
   - 影响：旧的 Session 元数据将丢失
   - 解决方案：这些数据本来就不应该存在，清理是正确的

3. **配置迁移**：ACP Agent 配置需要迁移到新的存储位置
   - 解决方案：自动迁移脚本

4. **UI 变化**：ACP 会话入口将与普通对话分离
   - 解决方案：提供清晰的 UI 引导

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 迁移过程中数据丢失 | 高 | 完整备份，分阶段迁移 |
| 新旧系统不兼容 | 中 | 并存期间充分测试 |
| UI 变化导致用户困惑 | 低 | 提供迁移指南和 UI 提示 |

## 附录

### A. 当前代码结构

```
src/main/presenter/
├── llmProviderPresenter/
│   ├── providers/
│   │   └── acpProvider.ts          # 需要移除
│   ├── managers/
│   │   └── providerInstanceManager.ts  # 需要清理 ACP 相关代码
│   └── index.ts
├── agentPresenter/
│   ├── acp/
│   │   ├── acpProcessManager.ts    # 保留，迁移到 acpPresenter
│   │   ├── acpSessionManager.ts    # 重构（改为纯内存）
│   │   ├── acpSessionPersistence.ts # 删除（不需要持久化）
│   │   ├── acpMessageFormatter.ts  # 重构
│   │   ├── acpContentMapper.ts     # 保留
│   │   ├── acpFsHandler.ts         # 保留
│   │   └── acpTerminalManager.ts   # 保留
│   └── session/
│       └── sessionManager.ts       # 清理 ACP 相关代码
└── sqlitePresenter/
    └── tables/
        └── acpSessions.ts          # 重构表结构
```

### B. 目标代码结构

```
src/main/presenter/
├── acpPresenter/                   # 新建
│   ├── index.ts                    # AcpPresenter 主入口
│   ├── managers/
│   │   ├── processManager.ts       # 进程管理
│   │   └── sessionManager.ts       # 会话管理
│   ├── handlers/
│   │   ├── fsHandler.ts            # 文件系统
│   │   ├── terminalManager.ts      # 终端管理
│   │   └── permissionHandler.ts    # 权限处理
│   ├── formatters/
│   │   └── inputFormatter.ts       # 输入格式化（只处理当前输入，不涉及历史）
│   ├── mappers/
│   │   └── contentMapper.ts        # 内容映射（Agent 响应 → UI 事件）
│   └── types.ts
├── llmProviderPresenter/           # 清理 ACP 相关代码
│   └── ...
└── sqlitePresenter/
    └── tables/
        └── acpSessions.ts          # 删除此文件
```

### C. 关键接口定义

```typescript
// ACP Session（内存中维护，不持久化）
interface AcpSession {
  sessionId: string           // Agent 生成的 Session ID
  agentId: string
  workdir: string
  status: 'active' | 'idle'
  connection: ClientSideConnection
  createdAt: number           // 仅用于内存管理

  // 由 Agent 提供的能力
  availableModes?: AcpMode[]
  currentModeId?: string
  availableModels?: AcpModel[]
  currentModelId?: string
  availableCommands?: AcpCommand[]
}

// 注意：DeepChat 不持久化任何 ACP Session 数据
// Session 的持久化完全由 ACP Agent 自己管理

// 用户输入（传递给 Agent）
interface AcpPromptInput {
  sessionId: string
  prompt: ContentBlock[]      // 只包含当前用户输入
  // 不包含历史消息
}
```
