# Agentic 系统统一架构设计

本文档描述 ACP Agent 和 DeepChat Agent 的统一架构设计，使渲染进程能够以统一的方式与不同类型的 agent 交互。

> **设计原则**: 不考虑迁移和兼容性，直接构建新的统一架构。

## 背景

### 当前状态

| 特性 | ACP Agent | DeepChat Agent |
|------|-----------|----------------|
| **Presenter** | `AcpPresenter` | `AgentPresenter` |
| **会话管理** | `SessionManager` (内存) | `SessionPresenter` (SQLite) |
| **事件系统** | `ACP_EVENTS` | `STREAM_EVENTS` |
| **持久化** | Agent 端负责（`loadSession` 流式推送历史） | SQLite 持久化 |
| **进程模型** | 独立 Node.js 进程 | 共享主进程 |
| **工具调用** | ACP 协议内置 | MCP + Agent 工具 |

### 问题

1. **接口不统一** - 渲染进程需要区分 agent 类型，调用不同的 presenter
2. **事件系统分裂** - 两套事件格式，前端需要分别处理
3. **会话语义不一致** - ACP 的 sessionId vs DeepChat 的 conversationId

## 设计目标

1. **统一接口** - 渲染进程使用单一接口与任意 agent 交互
2. **统一事件** - 所有 agent 发出格式一致的事件
3. **可扩展性** - 便于添加新的 agent 类型
4. **关注点分离** - 模型配置、权限策略等不在此层处理

## 核心概念

### Agent 标识

使用 `agent_id` 唯一标识一个 agent：

| agent_id | 对应实现 | 说明 |
|----------|---------|------|
| `deepchat.default` | AgentPresenter | DeepChat 内置 agent |
| `acp.anthropic.claude-code` | AcpPresenter | Claude Code ACP agent |
| `acp.custom.my-agent` | AcpPresenter | 自定义 ACP agent |

### 统一会话标识

所有 agent 使用 `sessionId` 作为统一会话标识：

| 实现 | sessionId 来源 |
|-----|---------------|
| DeepChat | conversationId（从 SQLite 获取） |
| ACP | Agent 生成的 sessionId |

### 统一事件流

所有 agent 遵循相同的事件流协议：

```typescript
// 主进程 → 渲染进程 事件
enum AgenticEventType {
  // 会话生命周期
  SESSION_CREATED = 'agentic.session.created',
  SESSION_UPDATED = 'agentic.session.updated',
  SESSION_CLOSED = 'agentic.session.closed',

  // 消息流
  MESSAGE_DELTA = 'agentic.message.delta',       // 内容增量
  MESSAGE_BLOCK = 'agentic.message.block',       // 新的块
  MESSAGE_END = 'agentic.message.end',           // 消息结束

  // 工具调用
  TOOL_START = 'agentic.tool.start',
  TOOL_RUNNING = 'agentic.tool.running',
  TOOL_END = 'agentic.tool.end',

  // 状态
  STATUS_CHANGED = 'agentic.status.changed',
  ERROR = 'agentic.error',
}
```

## 模块设计

### 1. 统一协议接口

所有 Agentic Presenter 遵循相同的接口协议：

```typescript
// 统一的 Agentic Presenter 协议
interface IAgenticPresenter {
  // 会话管理
  createSession(agentId: string, config: SessionConfig): Promise<string>
  getSession(sessionId: string): SessionInfo | null
  loadSession(sessionId: string, context: LoadContext): Promise<void>  // ACP: 流式推送历史; DeepChat: 从 SQLite 加载
  closeSession(sessionId: string): Promise<void>

  // 消息发送
  sendMessage(sessionId: string, content: MessageContent): Promise<void>

  // 控制
  cancelMessage(sessionId: string, messageId: string): Promise<void>

  // 模型/模式选择（仅选择 ID，不处理配置）
  setModel(sessionId: string, modelId: string): Promise<void>
  setMode(sessionId: string, modeId: string): Promise<void>  // modeId 来自 availableModes（即权限策略选项）
}
```

**模式即权限策略**：
```typescript
// availableModes 本身就是可用的权限策略选项
interface ModeInfo {
  id: string        // 权限策略 ID，如 'always_ask', 'always_allow', 'remember_choice'
  name: string      // 显示名称
  description: string
}
```

**关键设计决策**：

| 接口 | 包含 | 不包含 |
|-----|------|--------|
| `setModel()` | 模型 ID 选择 | 模型配置（temperature、maxTokens 等）|
| `setMode()` | 设置权限策略，modeId 来自 `availableModes`（即权限策略选项） | 具体权限处理实现在各 agent 内部 |
| `loadSession()` | ACP: 触发流式推送; DeepChat: 从 SQLite 加载 | 历史消息的具体存储方式 |

### 2. Agent 注册机制

AgenticPresenter 通过注册机制知道 `agent_id` 与具体 Presenter 的映射关系：

```typescript
// Presenter 注册接口
interface IAgentPresenter {
  readonly agentId: string              // 此 presenter 处理的 agent_id
  createSession(config: SessionConfig): Promise<string>
  sendMessage(sessionId: string, content: MessageContent): Promise<void>
  // ... 其他 IAgenticPresenter 方法
}

// AgenticPresenter 维护注册表
class AgenticPresenter {
  private agents = new Map<string, IAgentPresenter>()

  registerAgent(presenter: IAgentPresenter): void {
    this.agents.set(presenter.agentId, presenter)
  }

  private getPresenter(agentId: string): IAgentPresenter {
    // 精确匹配或前缀匹配
    // 如 'deepchat.default' 或 'acp.*' 前缀
  }
}
```

### 3. 现有 Presenter 实现统一协议

#### AgentPresenter

处理 `deepchat.*` agent，实现 `IAgenticPresenter` 协议：
- `sessionId` = `conversationId`（SQLite）
- 历史消息从 SQLite 查询
- `availableModes` 权限策略选项：**TODO**（需要 DeepChat agent 设计）

#### AcpPresenter

处理 `acp.*` agent，实现 `IAgenticPresenter` 协议：
- `sessionId` 由 Agent 生成
- 历史消息通过 `loadSession` 触发 Agent 流式推送
- `availableModes` 从 Agent 返回（如 plan/act 等模式即权限策略）

### 4. 统一数据模型

#### SessionInfo

```typescript
interface SessionInfo {
  sessionId: string
  agentId: string           // 创建此会话的 agent ID
  status: 'idle' | 'generating' | 'paused' | 'error'

  // availableModes = 可用的权限策略选项
  availableModes?: Array<{ id: string; name: string; description: string }>

  // availableModels = 可用的模型列表
  availableModels?: Array<{ id: string; name: string; description?: string }>

  // 当前选择
  currentModeId?: string      // 当前权限策略
  currentModelId?: string     // 当前模型

  // 能力声明
  capabilities: {
    supportsVision: boolean
    supportsTools: boolean
    supportsModes: boolean
  }
}
```

#### MessageContent

```typescript
interface MessageContent {
  text?: string
  images?: Array<{ type: 'url' | 'base64' | 'file'; data: string }>
  files?: Array<{ path: string; name: string }>
}
```

### 5. 事件标准化

各 Presenter 内部将事件转换为统一的 `AgenticEventType` 格式：
- **AgentPresenter**: `STREAM_EVENTS` → `AgenticEventType`
- **AcpPresenter**: `ACP_EVENTS` → `AgenticEventType`

**注意**: 不需要统一的 EventNormalizer 类，各 Presenter 内部自行处理事件转换。

## 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         渲染进程 (Renderer)                          │
│                                                                      │
│   useAgentic()  ← 统一 composable                                    │
│        │                                                            │
│        ▼                                                            │
│   AgentWorkspace UI                                                 │
└────────────────────────────────────┬────────────────────────────────┘
                                     │ IPC (usePresenter)
┌────────────────────────────────────▼────────────────────────────────┐
│                      主进程 (Main)                                   │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │           AgenticPresenter (统一入口)                       │     │
│  │                                                              │     │
│  │  + registerAgent(presenter)  ← Agent 注册                   │     │
│  │  + getPresenter(agentId)     ← 路由查找                     │     │
│  └───────────────────┬──────────────────────────────────────┘     │
│                      │                                             │
│         ┌────────────┴────────────┐                                │
│         ▼                          ▼                                │
│  ┌──────────────────┐      ┌──────────────────┐                   │
│  │  AgentPresenter  │      │   AcpPresenter   │  ← 实现 IAgentic   │
│  │  (deepchat.*)    │      │   (acp.*)        │     Presenter      │
│  └────────┬─────────┘      └────────┬─────────┘                   │
│           │                         │                               │
│           ▼                         ▼                               │
│  ┌──────────────────────────────────────────────┐                   │
│  │         各自内部事件标准化 → AgenticEventType  │                   │
│  └──────────────────────┬───────────────────────┘                   │
│                         ▼                                           │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │                    EventBus                                  │     │
│  │         AgenticEventType (统一事件格式)                      │     │
│  └────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────┐
│                      渲染进程 (Renderer)                              │
│                                                                      │
│   EventBus.on(AgenticEventType.*, ...)  ← 统一事件监听                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## 架构说明

### 核心思想

**统一协议 + Agent 注册** - 定义 `IAgenticPresenter` 协议接口，各 Presenter 通过 `registerAgent()` 注册，AgenticPresenter 根据 `agent_id` 路由到对应实现。

### 职责划分

| 组件 | 职责 |
|-----|------|
| **AgenticPresenter** | 统一入口；维护 agent 注册表；根据 agent_id 路由请求 |
| **AgentPresenter** | 注册为 `deepchat.*` agent；实现 IAgenticPresenter 协议；内部处理 SQLite、MCP 等 |
| **AcpPresenter** | 注册为 `acp.*` agent；实现 IAgenticPresenter 协议；内部管理进程、Agent 端持久化 |
| **EventNormalizer** | 各 Presenter 内部组件，转换事件为统一格式 |

## 数据流

### Agent 注册（应用启动时）

```
应用启动
    │
    ▼
AgentPresenter: agentic.registerAgent(this)
AcpPresenter: agentic.registerAgent(this)
    │
    ▼
AgenticPresenter: 维护 agent_id → Presenter 映射表
    │   - 'deepchat.default' → AgentPresenter
    │   - 'acp.*' → AcpPresenter (前缀匹配)
    │
    ▼
注册完成，可以接收请求
```

### 创建会话

```
Renderer: agentic.createSession('acp.anthropic.claude-code', config)
    │
    ▼
AgenticPresenter: getPresenter('acp.anthropic.claude-code')
    │
    ▼
返回 AcpPresenter
    │
    ▼
AcpPresenter.createSession(...)
    │
    ▼
返回 sessionId
```

### 发送消息

```
Renderer: agentic.sendMessage(sessionId, content)
    │
    ▼
AgenticPresenter: 根据 sessionId 找到对应的 Presenter
    │   （内部维护 sessionId → Presenter 映射）
    │
    ▼
对应 Presenter.sendMessage(...)
    │
    ▼
内部 EventNormalizer 转换事件
    │
    ▼
EventBus.sendToRenderer(AgenticEventType.MESSAGE_DELTA, ...)
```

## 职责边界

| 功能 | 本层处理 | 不处理 |
|-----|---------|--------|
| **模型管理** | 选择模型 ID | temperature、maxTokens、topP 等配置 |
| **模式管理（权限策略）** | 通过 `setMode(modeId)` 选择策略，modeId 来自 `availableModes` | 具体权限请求处理由各 agent 内部实现 |
| **历史消息加载** | 提供统一接口 `loadSession` | ACP: Agent 流式推送; DeepChat: SQLite 查询 |
| **会话持久化** | 不处理 | DeepChat 的 SQLite 持久化在 AgentPresenter 内部 |

**权限策略说明**：
- `availableModes` = 可用的权限策略选项（如 `always_ask`, `always_allow`, `remember_choice`）
- `setMode(modeId)` = 选择当前使用的权限策略
- **不包含**：具体的权限请求处理逻辑（由各 agent 内部实现）

## 关键文件结构

```
src/main/presenter/
├── agentic/
│   ├── index.ts                    # AgenticPresenter 统一入口
│   ├── types.ts                    # IAgenticPresenter 协议接口
│   └── registry.ts                 # agent_id → Presenter 映射
│
├── agentPresenter/
│   ├── index.ts                    # 实现 IAgenticPresenter 协议
│   └── normalizer.ts               # DeepChat 事件 → Agentic 事件
│
└── acpPresenter/
    ├── index.ts                    # 实现 IAgenticPresenter 协议
    └── normalizer.ts               # ACP 事件 → Agentic 事件

src/shared/types/presenters/
└── agentic.presenter.d.ts          # IAgenticPresenter 接口定义
```

## 下一步

1. 审阅本设计文档，确认架构方向
2. 定义 `IAgenticPresenter` 协议接口
3. 实现 `AgenticPresenter` 和 agent 注册机制
4. `AgentPresenter` 和 `AcpPresenter` 实现协议并注册
5. **DeepChat agent 设计 availableModes**（权限策略选项）
6. 迁移渲染进程到 `useAgentic()`
