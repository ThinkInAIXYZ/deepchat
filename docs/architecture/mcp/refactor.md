# MCP 架构重构方案

## 文档目的

本文档记录 MCP (Model Context Protocol) 相关功能的架构重构方案，重点阐述**架构分层原则**、**职责边界划分**和**关键设计洞察**。

---

## 核心问题

### 当前架构的根本性缺陷

1. **职责混乱**：`useMcpStoreService` 混合了多种不同性质的功能
   - MCP 特定功能（Tools、Resources、Servers）
   - 通用领域功能（Prompts）
   - 基础设施功能（NPM Registry）

2. **分层错误**：核心业务逻辑位于 Renderer Process
   - 违反了 DeepChat 的 Presenter Pattern 原则
   - 每个窗口独立执行业务逻辑，导致状态不一致
   - 安全性问题：Renderer 层可被篡改

3. **领域边界不清**：MCP 和 Prompt 的关系混淆
   - Prompt 是独立的领域概念，不应属于 MCP
   - MCP Prompts 只是 Prompt 的一种数据源

---

## 架构洞察

### 洞察 1：Prompt 是独立的领域概念

**关键认知：**
- **Prompt 是一个通用的领域概念**，类似于"文档"、"模板"
- **MCP Prompts 只是 Prompt 的一种数据源**，类似于"从 MCP 获取的文档"
- Prompt 可以来自多种来源：MCP、本地配置、数据库、API 等

**错误的理解：**
```
❌ Prompt 属于 MCP
   └─ MCP Service 管理 Prompts
```

**正确的理解：**
```
✓ Prompt 是独立的领域
   ├─ Prompt Service 管理所有 Prompts
   └─ MCP 是 Prompt 的数据源之一
```

### 洞察 2：业务逻辑必须在 Main Process

**Electron 架构的本质：**
- **Main Process**：可信的、单例的、有完整权限的
- **Renderer Process**：不可信的、多实例的、权限受限的

**职责划分：**
```
Main Process (Presenter Layer)
  ├─ 核心业务逻辑（数据聚合、验证、转换）
  ├─ 数据访问（数据库、文件系统、外部 API）
  └─ 状态管理（单一数据源，所有窗口共享）

Renderer Process (View Layer)
  ├─ UI 交互逻辑
  ├─ 查询缓存（React Query / Pinia Colada）
  └─ UI 状态（loading、error、selected）
```

**为什么必须在 Main Process？**
1. **多窗口一致性**：所有窗口共享同一份业务逻辑和状态
2. **安全性**：业务逻辑在可信环境中执行，无法被篡改
3. **性能**：避免每个窗口重复执行相同的业务逻辑
4. **架构一致性**：符合 DeepChat 的 Presenter Pattern

### 洞察 3：数据转换应在基础设施层完成

**分层职责：**
```
Domain Layer (领域层)
  └─ 定义领域模型（Prompt Entity）
  └─ 定义领域接口（PromptProvider Interface）
  └─ 不知道数据来源

Infrastructure Layer (基础设施层)
  └─ 实现领域接口（McpPromptProvider）
  └─ 从外部系统获取数据（MCP Protocol）
  └─ 转换为领域模型（MCP PromptListEntry → Domain Prompt）
```

**关键原则：领域层不依赖基础设施层**
- 领域层定义 `PromptProvider` 接口
- 基础设施层实现 `McpPromptProvider`、`LocalPromptProvider` 等
- 依赖倒置原则（DIP）：高层模块不依赖低层模块

---

## 重构方案：Prompt 架构

### 架构分层

```
┌─────────────────────────────────────────────────────────┐
│  Main Process                                           │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  PromptPresenter (新增)                         │    │
│  │  职责：                                          │    │
│  │  - 聚合所有来源的 Prompts                        │    │
│  │  - 执行 Prompt（参数验证、模板替换）              │    │
│  │  - 管理自定义 Prompts（CRUD）                    │    │
│  │                                                 │    │
│  │  依赖：                                          │    │
│  │  - McpPresenter (获取 MCP Prompts)              │    │
│  │  - ConfigPresenter (获取 Custom Prompts)        │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  McpPresenter (现有，职责收缩)                   │    │
│  │  职责：                                          │    │
│  │  - 只负责 MCP 协议相关的操作                      │    │
│  │  - 提供 getAllPrompts() 给 PromptPresenter      │    │
│  │  - 不再直接暴露给 Renderer                       │    │
│  └────────────────────────────────────────────────┘    │
└────────────────────┬────────────────────────────────────┘
                     │ IPC (contextBridge)
┌────────────────────▼────────────────────────────────────┐
│  Preload                                                │
│  - 暴露 promptPresenter 接口                             │
│  - 不再暴露 mcpPresenter.getAllPrompts()                │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│  Renderer Process                                       │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  usePromptStore (简化)                          │    │
│  │  职责：                                          │    │
│  │  - 调用 promptPresenter                         │    │
│  │  - 缓存查询结果                                  │    │
│  │  - 管理 UI 状态                                  │    │
│  │                                        │    │
│  │  不再包含：                                      │    │
│  │  - ✗ 数据聚合逻辑                                │    │
│  │  - ✗ 参数验证逻辑                                │    │
│  │  - ✗ 模板替换逻辑                                │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 职责划分

#### PromptPresenter (Main Process)

**核心职责：**
1. **数据聚合**：从多个来源获取 Prompts（MCP + Custom + 未来可能的其他来源）
2. **业务逻辑**：参数验证、模板替换、错误处理
3. **状态管理**：单一数据源，所有窗口共享
4. **CRUD 操作**：管理自定义 Prompts

**关键方法：**
```typescript
interface IPromptPresenter {
  // 查询
  getAllPrompts(): Promise<PromptListEntry[]>
  getPrompt(promptId: string, args?: Record<string, unknown>): Promise<PromptResult>

  // CRUD（仅针对自定义 Prompts）
  createPrompt(prompt: Prompt): Promise<void>
  updatePrompt(id: string, updates: Partial<Prompt>): Promise<void>
  deletePrompt(id: string): Promise<void>
}
```

**内部实现要点：**
- 从 `McpPresenter.getAllPrompts()` 获取 MCP Prompts
- 从 `ConfigPresenter.getCustomPrompts()` 获取自定义 Prompts
- 聚合两者，返回统一的 `PromptListEntry[]`
- 执行 Prompt 时，根据来源路由到不同的处理逻辑
- 自定义 Prompts 的模板替换在此完成
- MCP Prompts 委托给 `McpPresenter.getPrompt()`

#### McpPresenter (Main Process)

**职责收缩：**
- 只负责 MCP 协议相关的操作
- 提供 `getAllPrompts()` 方法供 `PromptPresenter` 调用
- 不再直接暴露给 Renderer（通过 PromptPresenter 间接访问）

**保持不变：**
- MCP 服务器管理（启动、停止、配置）
- MCP Tools 管理和调用
- MCP Resources 管理和读取

#### usePromptStore (Renderer Process)

**职责简化：**
- 只负责调用 `promptPresenter`
- 使用 `useIpcQuery` 缓存查询结果
- 管理 UI 状态（loading、error）

**移除的职责：**
- ✗ 数据聚合（`[...customPrompts, ...mcpPrompts]`）
- ✗ 参数验证
- ✗ 模板替换
- ✗ 业务逻辑判断

---

## 架构优势

### 1. 职责清晰

**之前：**
```
useMcpStoreService (168 行)
  ├─ MCP 配置管理
  ├─ MCP 服务器管理
  ├─ MCP Tools 管理
  ├─ MCP Resources 管理
  ├─ Prompts 管理 ← 职责混乱
  └─ NPM Registry 管理
```

**之后：**
```
PromptPresenter (专注于 Prompts)
  └─ 所有 Prompt 相关的业务逻辑

McpPresenter (专注于 MCP 协议)
  └─ 只负责 MCP 特定的功能
```

### 2. 多窗口一致性

**之前：**
- 每个窗口有独立的 `useMcpStoreService` 实例
- 每个窗口独立执行数据聚合逻辑
- 状态不同步

**之后：**
- `PromptPresenter` 在 Main Process 单例
- 所有窗口共享同一份数据和逻辑
- 状态自动同步（通过 EventBus）

### 3. 安全性

**之前：**
- 参数验证在 Renderer，可被绕过
- 模板替换在 Renderer，可被篡改

**之后：**
- 所有验证逻辑在 Main Process
- Renderer 只能通过 IPC 调用，无法绕过

### 4. 扩展性

**之前：**
- 新增 Prompt 来源需要修改 `useMcpStoreService`
- 需要修改 Renderer 层的业务逻辑

**之后：**
- 新增 Prompt 来源只需修改 `PromptPresenter`
- Renderer 层无需任何修改
- 符合开闭原则（OCP）

### 5. 可测试性

**之前：**
- 业务逻辑在 Renderer，难以测试
- 需要 Mock Electron IPC

**之后：**
- 业务逻辑在 Main Process，易于单元测试
- 可以直接测试 `PromptPresenter`

---

## 迁移策略

### 阶段 1：创建 PromptPresenter

1. 在 `src/main/presenter/promptPresenter/` 创建新的 Presenter
2. 实现核心方法：`getAllPrompts()`、`getPrompt()`
3. 从 `McpPresenter` 和 `ConfigPresenter` 获取数据
4. 实现数据聚合和业务逻辑

### 阶段 2：更新 Preload

1. 在 `src/preload/index.ts` 暴露 `promptPresenter`
2. 更新类型定义

### 阶段 3：简化 Renderer

1. 创建新的 `usePromptStore`，只调用 `promptPresenter`
2. 移除 `useMcpStoreService` 中的 Prompt 相关逻辑
3. 更新所有使用 Prompts 的组件

### 阶段 4：清理

1. 从 `useMcpStoreService` 移除 Prompt 相关代码
2. 更新文档和类型定义
3. 添加单元测试

---

## 关键设计原则

### 1. 依赖倒置原则 (DIP)

```
高层模块（PromptPresenter）不依赖低层模块（McpPresenter）
两者都依赖抽象（PromptProvider Interface）
```

### 2. 单一职责原则 (SRP)

```
PromptPresenter：只负责 Prompt 相关的业务逻辑
McpPresenter：只负责 MCP 协议相关的操作
```

### 3. 开闭原则 (OCP)

```
对扩展开放：新增 Prompt 来源只需添加新的 Provider
对修改关闭：不需要修改现有的 PromptPresenter 代码
```

### 4. 接口隔离原则 (ISP)

```
Renderer 只依赖它需要的接口（IPromptPresenter）
不需要知道 MCP 的存在
```

---

---

## 重构方案：Tools 架构

### 核心洞察

#### 洞察 1：Tools 不是独立的领域概念

**与 Prompts 的本质区别：**

```
Prompts（独立领域）
  ├─ 是通用的领域概念（类似"文档"、"模板"）
  ├─ 可以有多种来源（MCP、本地、数据库、API）
  └─ 需要独立的 PromptPresenter

Tools（MCP 特定）
  ├─ 是 MCP 协议的核心能力
  ├─ 工具的定义、调用、结果都是 MCP 特定的
  └─ 不需要独立的 Presenter，属于 McpPresenter
```

**关键认知：**
- Tools 是 MCP 协议的一部分，不应该抽象为独立的领域
- 工具的生命周期与 MCP 服务器绑定
- 工具的调用依赖 MCP 协议的实现细节

#### 洞察 2：参数预处理属于基础设施层

**当前问题：**

```typescript
// ❌ 在 Renderer 层（useMcpStoreService.ts lines 745-791）
const callTool = async (toolName: string) => {
  const params = { ...rawParams }

  // 业务逻辑在 Renderer！
  if (toolName === 'glob_search') {
    // 默认值设置
    if (!pattern) params.pattern = '**/*.md'

    // 参数清理
    if (params.root?.trim() === '') delete params.root

    // 类型转换
    if (typeof params.excludePatterns === 'string') {
      params.excludePatterns = params.excludePatterns.split(',').map(s => s.trim())
    }

    // 数字转换
    if (typeof params.maxResults === 'string') {
      params.maxResults = Number(params.maxResults)
    }
  }

  return await callToolWithParams(toolName, params)
}
```

**问题分析：**
1. **分层错误**：参数转换是业务逻辑，不应在 Renderer
2. **可扩展性差**：硬编码 `if (toolName === 'glob_search')`，新增工具需要修改核心代码
3. **多窗口重复执行**：每个窗口都会执行相同的转换逻辑
4. **安全性问题**：参数转换可以被绕过（直接调用 `callToolWithParams`）

**正确的分层：**

```
Main Process (ToolManager)
  ├─ 工具定义管理（缓存、冲突检测、重命名）✓ 已实现
  ├─ 参数预处理 ← 应该在这里！
  ├─ 参数验证 ← 应该在这里！
  ├─ 权限检查 ✓ 已实现
  ├─ 调用路由 ✓ 已实现
  └─ 结果格式化 ✓ 已实现

Renderer Process (useMcpStoreService)
  ├─ UI 状态管理（loading、error、results）✓ 正确
  ├─ 用户输入收集（toolInputs）✓ 正确
  └─ ✗ 参数转换逻辑 ← 应该移除！
```

#### 洞察 3：参数预处理应该是可扩展的

**设计原则：**
- 每个工具可以有自己的参数预处理器
- 预处理器是可插拔的，符合开闭原则（OCP）
- 新增工具不需要修改 ToolManager 核心代码

**架构设计：**

```typescript
// 参数预处理器接口
interface ToolParameterPreprocessor {
  preprocess(params: Record<string, unknown>): Record<string, unknown>
}

// 针对特定工具的预处理器
class GlobSearchPreprocessor implements ToolParameterPreprocessor {
  preprocess(params: Record<string, unknown>): Record<string, unknown> {
    // 默认值
    if (!params.pattern || typeof params.pattern !== 'string' || !params.pattern.trim()) {
      params.pattern = '**/*.md'
    }

    // 清理空字符串
    if (typeof params.root === 'string' && params.root.trim() === '') {
      delete params.root
    }

    // 类型转换
    if (typeof params.excludePatterns === 'string') {
      const parsed = params.excludePatterns.split(',').map(s => s.trim()).filter(Boolean)
      params.excludePatterns = parsed.length > 0 ? parsed : undefined
    }

    if (typeof params.maxResults === 'string') {
      const num = Number(params.maxResults)
      params.maxResults = !Number.isNaN(num) ? num : undefined
    }

    return params
  }
}

// ToolManager 集成预处理器
class ToolManager {
  private preprocessors: Map<string, ToolParameterPreprocessor> = new Map()

  constructor() {
    // 注册预处理器
    this.preprocessors.set('glob_search', new GlobSearchPreprocessor())
    // 未来可以注册更多...
  }

  async callTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
    // 解析参数
    let args = JSON.parse(toolCall.function.arguments)

    // 应用预处理器
    const preprocessor = this.preprocessors.get(toolCall.function.name)
    if (preprocessor) {
      args = preprocessor.preprocess(args)
    }

    // 继续现有的权限检查、调用等逻辑...
  }
}
```

### 架构对比

#### 当前架构（有问题）

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer Process                                           │
│                                                              │
│  useMcpStoreService.callTool()                              │
│    ├─ ❌ 参数转换（glob_search 特殊处理）                    │
│    ├─ ❌ 默认值设置                                          │
│    ├─ ❌ 类型转换                                            │
│    └─ callToolWithParams()                                  │
└────────────────────────┬────────────────────────────────────┘
                         │ IPC
┌────────────────────────▼────────────────────────────────────┐
│  Main Process                                               │
│                                                              │
│  ToolManager.callTool()                                     │
│    ├─ ✓ 参数解析（JSON.parse + jsonrepair）                 │
│    ├─ ✓ 权限检查                                             │
│    ├─ ✓ 工具名称映射                                         │
│    ├─ ✓ 调用 McpClient                                      │
│    └─ ✓ 结果格式化                                           │
└─────────────────────────────────────────────────────────────┘
```

#### 重构后架构（正确）

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer Process                                           │
│                                                              │
│  useMcpStoreService.callTool()                              │
│    ├─ ✓ 收集用户输入（toolInputs）                           │
│    ├─ ✓ 管理 UI 状态（loading、error）                       │
│    └─ callToolWithParams() ← 直接传递原始参数                │
└────────────────────────┬────────────────────────────────────┘
                         │ IPC
┌────────────────────────▼────────────────────────────────────┐
│  Main Process                                               │
│                                                              │
│  ToolManager.callTool()                                     │
│    ├─ ✓ 参数解析（JSON.parse + jsonrepair）                 │
│    ├─ ✓ 参数预处理（可插拔的 Preprocessor）← 新增！          │
│    ├─ ✓ 参数验证（基于 tool schema）← 新增！                 │
│    ├─ ✓ 权限检查                                             │
│    ├─ ✓ 工具名称映射                                         │
│    ├─ ✓ 调用 McpClient                                      │
│    └─ ✓ 结果格式化                                           │
└─────────────────────────────────────────────────────────────┘
```

### 职责划分

#### ToolManager (Main Process)

**新增职责：**
1. **参数预处理**：应用工具特定的预处理器
2. **参数验证**：基于工具的 JSON Schema 验证参数

**保持不变：**
- 工具定义管理（缓存、冲突检测、重命名）
- 权限检查
- 调用路由
- 结果格式化

**关键方法更新：**
```typescript
class ToolManager {
  private preprocessors: Map<string, ToolParameterPreprocessor>

  async callTool(toolCall: MCPToolCall): Promise<MCPToolResponse> {
    // 1. 参数解析（现有）
    let args = JSON.parse(jsonrepair(toolCall.function.arguments))

    // 2. 参数预处理（新增）
    const preprocessor = this.preprocessors.get(toolCall.function.name)
    if (preprocessor) {
      args = preprocessor.preprocess(args)
    }

    // 3. 参数验证（新增）
    const toolDef = this.getToolDefinition(toolCall.function.name)
    if (toolDef) {
      this.validateParameters(args, toolDef.function.parameters)
    }

    // 4. 权限检查（现有）
    // 5. 调用路由（现有）
    // 6. 结果格式化（现有）
  }

  private validateParameters(
    args: Record<string, unknown>,
    schema: JSONSchema
  ): void {
    // 基于 JSON Schema 验证参数
    // 检查必填字段
    // 检查类型
    // 抛出详细的验证错误
  }
}
```

#### useMcpStoreService (Renderer Process)

**移除的职责：**
- ✗ 参数转换逻辑（`glob_search` 特殊处理）
- ✗ 默认值设置
- ✗ 类型转换

**保持的职责：**
- ✓ UI 状态管理（`toolLoadingStates`、`toolInputs`、`toolResults`）
- ✓ 调用 `callToolWithParams`
- ✓ 缓存工具结果

**简化后的代码：**
```typescript
const callTool = async (toolName: string): Promise<CallToolResult> => {
  toolLoadingStates.value[toolName] = true
  try {
    // 直接传递原始参数，不做任何转换
    const rawParams = toolInputs.value[toolName] || {}
    return await callToolWithParams(toolName, rawParams)
  } finally {
    toolLoadingStates.value[toolName] = false
  }
}
```

### 架构优势

#### 1. 职责清晰

**之前：**
- Renderer 层混合了 UI 逻辑和业务逻辑
- 参数转换逻辑散落在 Renderer

**之后：**
- Renderer 只负责 UI 状态
- 所有业务逻辑在 Main Process

#### 2. 可扩展性

**之前：**
```typescript
// 硬编码，新增工具需要修改这里
if (toolName === 'glob_search') {
  // 特殊处理
}
```

**之后：**
```typescript
// 可插拔，新增工具只需注册预处理器
this.preprocessors.set('new_tool', new NewToolPreprocessor())
```

#### 3. 安全性

**之前：**
- 参数转换在 Renderer，可以被绕过
- 直接调用 `callToolWithParams` 可以跳过转换

**之后：**
- 所有参数处理在 Main Process
- Renderer 无法绕过验证和预处理

#### 4. 多窗口一致性

**之前：**
- 每个窗口独立执行参数转换
- 可能产生不一致的行为

**之后：**
- 参数处理在 Main Process 单例
- 所有窗口行为一致

### 迁移策略

#### 阶段 1：在 ToolManager 添加预处理器支持

1. 创建 `ToolParameterPreprocessor` 接口
2. 实现 `GlobSearchPreprocessor`
3. 在 `ToolManager.callTool()` 中集成预处理逻辑
4. 添加参数验证逻辑

#### 阶段 2：简化 Renderer 层

1. 从 `useMcpStoreService.callTool()` 移除参数转换逻辑
2. 直接传递原始参数给 `callToolWithParams`
3. 更新相关测试

#### 阶段 3：验证和清理

1. 测试所有工具调用是否正常
2. 确认参数预处理在 Main Process 正确执行
3. 移除 Renderer 层的冗余代码

---

## 后续讨论

本文档目前涵盖了：
- ✓ **Prompt 架构重构**
- ✓ **Tools 架构重构**

以下内容待后续讨论：

1. **MCP Resources 架构**：资源管理的职责划分
2. **MCP 服务器管理**：配置和生命周期管理
3. **事件系统**：跨窗口的状态同步机制
4. **性能优化**：缓存策略和查询优化

---

## 参考

- [Tool System Architecture](./tool-system.md)
- [Event System Architecture](./event-system.md)
- [DeepChat CLAUDE.md](../../CLAUDE.md)
