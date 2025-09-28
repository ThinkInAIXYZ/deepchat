# LLM Agent 消息架构设计文档

## 概述

本文档详细描述了DeepChat系统中LLM消息的抽象架构和设计理念。随着系统从单一的LLM聊天能力向支持多种Agent能力的演进，我们需要一个统一的、可扩展的消息体系来支持不同的Agent类型（如炒股Agent、编程Agent等）。

## 当前消息架构分析

### 现有的消息层次结构

DeepChat目标采用分层的强类型抽象设计，从底层的流式事件到高层UI组件：

```
LLMCoreStreamEvent (底层强类型流事件)
    ↓
LLMAgentEvent (Agent事件)
    ↓
AssistantMessageBlock (助手消息块)
    ↓
MessageItemAssistant.vue (UI组件)
```

#### 1. LLMCoreStreamEvent (底层流式事件)

定义在 `src/shared/types/core/llm-events.ts` 中，这是最底层的流式事件接口：
// 使用严格的联合类型设计，确保类型安全
export type LLMCoreStreamEvent =
  | TextStreamEvent
  | ReasoningStreamEvent
  | ToolCallStartEvent
  | ToolCallChunkEvent
  | ToolCallEndEvent
  | ErrorStreamEvent
  | UsageStreamEvent
  | StopStreamEvent
  | ImageDataStreamEvent
  | RateLimitStreamEvent

// 基础事件类型定义
export type StreamEventType =
  | 'text'
  | 'reasoning'
  | 'tool_call_start'
  | 'tool_call_chunk'
  | 'tool_call_end'
  | 'error'
  | 'usage'
  | 'stop'
  | 'image_data'
  | 'rate_limit'

// 文本事件 - 只能设置content字段
export interface TextStreamEvent {
  type: 'text'
  content: string
}

// 推理事件 - 只能设置reasoning_content字段
export interface ReasoningStreamEvent {
  type: 'reasoning'
  reasoning_content: string
}

// 工具调用开始事件 - 必须设置tool_call_id和tool_call_name
export interface ToolCallStartEvent {
  type: 'tool_call_start'
  tool_call_id: string
  tool_call_name: string
}

// 工具调用分块事件 - 必须设置tool_call_id和tool_call_arguments_chunk
export interface ToolCallChunkEvent {
  type: 'tool_call_chunk'
  tool_call_id: string
  tool_call_arguments_chunk: string
}

// 工具调用结束事件 - 必须设置tool_call_id，可选设置tool_call_arguments_complete
export interface ToolCallEndEvent {
  type: 'tool_call_end'
  tool_call_id: string
  tool_call_arguments_complete?: string
}

// 错误事件 - 只能设置error_message字段
export interface ErrorStreamEvent {
  type: 'error'
  error_message: string
}

// 使用统计事件 - 只能设置usage字段
export interface UsageStreamEvent {
  type: 'usage'
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// 停止事件 - 只能设置stop_reason字段
export interface StopStreamEvent {
  type: 'stop'
  stop_reason: 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error' | 'complete'
}

// 图像数据事件 - 只能设置image_data字段
export interface ImageDataStreamEvent {
  type: 'image_data'
  image_data: {
    data: string // Base64 编码的图像数据
    mimeType: string
  }
}

// 速率限制事件 - 只能设置rate_limit字段
export interface RateLimitStreamEvent {
  type: 'rate_limit'
  rate_limit: {
    providerId: string
    qpsLimit: number
    currentQps: number
    queueLength: number
    estimatedWaitTime?: number
  }
}

// 辅助类型：根据事件类型获取对应的字段类型
export type StreamEventFields<T extends StreamEventType> =
  T extends 'text' ? Pick<TextStreamEvent, 'content'> :
  T extends 'reasoning' ? Pick<ReasoningStreamEvent, 'reasoning_content'> :
  T extends 'tool_call_start' ? Pick<ToolCallStartEvent, 'tool_call_id' | 'tool_call_name'> :
  T extends 'tool_call_chunk' ? Pick<ToolCallChunkEvent, 'tool_call_id' | 'tool_call_arguments_chunk'> :
  T extends 'tool_call_end' ? Pick<ToolCallEndEvent, 'tool_call_id'> & Partial<Pick<ToolCallEndEvent, 'tool_call_arguments_complete'>> :
  T extends 'error' ? Pick<ErrorStreamEvent, 'error_message'> :
  T extends 'usage' ? Pick<UsageStreamEvent, 'usage'> :
  T extends 'stop' ? Pick<StopStreamEvent, 'stop_reason'> :
  T extends 'image_data' ? Pick<ImageDataStreamEvent, 'image_data'> :
  T extends 'rate_limit' ? Pick<RateLimitStreamEvent, 'rate_limit'> :
  never

// 工厂函数：创建类型安全的流事件
export const createStreamEvent = {
  text: (content: string): TextStreamEvent => ({ type: 'text', content }),
  reasoning: (reasoning_content: string): ReasoningStreamEvent => ({ type: 'reasoning', reasoning_content }),
  toolCallStart: (tool_call_id: string, tool_call_name: string): ToolCallStartEvent => ({
    type: 'tool_call_start',
    tool_call_id,
    tool_call_name
  }),
  toolCallChunk: (tool_call_id: string, tool_call_arguments_chunk: string): ToolCallChunkEvent => ({
    type: 'tool_call_chunk',
    tool_call_id,
    tool_call_arguments_chunk
  }),
  toolCallEnd: (tool_call_id: string, tool_call_arguments_complete?: string): ToolCallEndEvent => ({
    type: 'tool_call_end',
    tool_call_id,
    tool_call_arguments_complete
  }),
  error: (error_message: string): ErrorStreamEvent => ({ type: 'error', error_message }),
  usage: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): UsageStreamEvent => ({
    type: 'usage',
    usage
  }),
  stop: (stop_reason: 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error' | 'complete'): StopStreamEvent => ({
    type: 'stop',
    stop_reason
  }),
  imageData: (image_data: { data: string; mimeType: string }): ImageDataStreamEvent => ({
    type: 'image_data',
    image_data
  }),
  rateLimit: (rate_limit: {
    providerId: string
    qpsLimit: number
    currentQps: number
    queueLength: number
    estimatedWaitTime?: number
  }): RateLimitStreamEvent => ({
    type: 'rate_limit',
    rate_limit
  })
}
```

这个接口定义了Provider层与Agent循环层之间的标准化通信协议。

#### 类型安全优势

通过联合类型设计，我们获得了以下类型安全优势：

1. **编译时类型检查**: TypeScript编译器会在编译时检查每个事件类型的字段完整性
2. **智能提示**: IDE会根据`type`字段自动提示相应的必填字段
3. **防止字段污染**: 无法为不相关的类型设置错误的字段
4. **工厂函数**: 提供类型安全的工厂函数，防止创建无效的事件对象

#### 使用示例

```typescript
// ✅ 正确的用法 - 编译通过
const textEvent: TextStreamEvent = {
  type: 'text',
  content: 'Hello world'
}

const toolStartEvent: ToolCallStartEvent = {
  type: 'tool_call_start',
  tool_call_id: 'call_123',
  tool_call_name: 'getWeather'
}

// ❌ 错误的用法 - 编译错误
const invalidEvent = {
  type: 'text',
  content: 'Hello',
  reasoning_content: 'This should not exist' // 错误：text类型不能有reasoning_content字段
}

// 使用工厂函数创建事件（推荐）
import { createStreamEvent } from './llm-core-events'

import { createStreamEvent } from '@shared/types/core/llm-events'

const textEvent = createStreamEvent.text('Hello world')
const toolEvent = createStreamEvent.toolCallStart('call_123', 'getWeather')

- 强约束：`LLMCoreStreamEvent` 仅在 Provider 实现内部出现；跨进程（main → renderer）的 IPC 事件统一为 `LLMAgentEvent`；UI 层仅消费 `LLMAgentEvent`，并映射为 `AssistantMessageBlock`。
- 事件不可混用：禁止在 Agent 或 UI 层直接拼装 CoreEvent；禁止 Provider 直接产出 UI 块。

### 实际实现示例

基于上述设计，我们可以创建一个独立的类型安全库：

```typescript
// src/core/llm-events.ts - 独立的事件类型库
export type LLMCoreStreamEvent =
  | TextStreamEvent
  | ReasoningStreamEvent
  | ToolCallStartEvent
  | ToolCallChunkEvent
  | ToolCallEndEvent
  | ErrorStreamEvent
  | UsageStreamEvent
  | StopStreamEvent
  | ImageDataStreamEvent
  | RateLimitStreamEvent

export type StreamEventType =
  | 'text'
  | 'reasoning'
  | 'tool_call_start'
  | 'tool_call_chunk'
  | 'tool_call_end'
  | 'error'
  | 'usage'
  | 'stop'
  | 'image_data'
  | 'rate_limit'

// 具体的事件接口定义（此处省略，与上述相同）

// 类型安全的Provider接口
export interface TypeSafeLLMProvider {
  id: string
  name: string

  // 核心流式方法，返回类型安全的流事件
  coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent>
}

// 类型安全的Agent处理器
export interface TypeSafeAgentProcessor {
  processStream(
    events: AsyncGenerator<LLMCoreStreamEvent>
  ): AsyncGenerator<AgentResponse>

  // 类型守卫函数
  isTextEvent(event: LLMCoreStreamEvent): event is TextStreamEvent
  isToolCallStartEvent(event: LLMCoreStreamEvent): event is ToolCallStartEvent
  isErrorEvent(event: LLMCoreStreamEvent): event is ErrorStreamEvent
}

// 使用示例
export class ExampleProvider implements TypeSafeLLMProvider {
  id = 'example-provider'
  name = 'Example Provider'

  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    // 调用实际的LLM API
    const response = await this.callLLMAPI(messages, modelId, temperature, maxTokens, tools)

    // 处理流式响应，返回类型安全的事件
    for await (const chunk of response.stream) {
      if (chunk.type === 'text') {
        yield createStreamEvent.text(chunk.content)
      } else if (chunk.type === 'tool_call') {
        yield createStreamEvent.toolCallStart(chunk.tool_call_id, chunk.tool_call_name)
        yield createStreamEvent.toolCallChunk(chunk.tool_call_id, chunk.arguments)
        yield createStreamEvent.toolCallEnd(chunk.tool_call_id, chunk.complete_arguments)
      }
      // ... 处理其他类型
    }
  }
}

// 类型安全的Agent实现
export class ExampleAgent implements TypeSafeAgentProcessor {
  async *processStream(
    events: AsyncGenerator<LLMCoreStreamEvent>
  ): AsyncGenerator<AgentResponse> {
    for await (const event of events) {
      if (this.isTextEvent(event)) {
        // TypeScript知道这里event.content是string类型
        yield this.processText(event.content)
      } else if (this.isToolCallStartEvent(event)) {
        // TypeScript知道这里event.tool_call_id和event.tool_call_name是string类型
        yield this.processToolCall(event.tool_call_id, event.tool_call_name)
      } else if (this.isErrorEvent(event)) {
        // TypeScript知道这里event.error_message是string类型
        yield this.processError(event.error_message)
      }
    }
  }

  // 类型守卫实现
  isTextEvent(event: LLMCoreStreamEvent): event is TextStreamEvent {
    return event.type === 'text'
  }

  isToolCallStartEvent(event: LLMCoreStreamEvent): event is ToolCallStartEvent {
    return event.type === 'tool_call_start'
  }

  isErrorEvent(event: LLMCoreStreamEvent): event is ErrorStreamEvent {
    return event.type === 'error'
  }
}
```

#### 2. LLMAgentEvent (Agent事件)

Agent层的事件接口，包含更丰富的信息：

```typescript
export interface LLMAgentEventData {
  eventId: string
  content?: string
  reasoning_content?: string
  tool_call_id?: string
  tool_call_name?: string
  tool_call_params?: string
  tool_call_response?: string | MCPToolResponse['content']
  maximum_tool_calls_reached?: boolean
  tool_call_server_name?: string
  tool_call_server_icons?: string
  tool_call_server_description?: string
  tool_call_response_raw?: any
  tool_call?: 'start' | 'running' | 'end' | 'error' | 'update' | 'permission-required'
  permission_request?: {
    toolName: string
    serverName: string
    permissionType: 'read' | 'write' | 'all'
    description: string
  }
  totalUsage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    context_length: number
  }
  image_data?: { data: string; mimeType: string }
  rate_limit?: {
    providerId: string
    qpsLimit: number
    currentQps: number
    queueLength: number
    estimatedWaitTime?: number
  }
  error?: string
  userStop?: boolean
}
```

#### 2.1 共享类型（规范化）

为避免数据泥团与重复定义，约定以下共享类型在全局复用：

```typescript
export interface UsageStats {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  context_length?: number
}

export interface RateLimitInfo {
  providerId: string
  qpsLimit: number
  currentQps: number
  queueLength: number
  estimatedWaitTime?: number
}
```

后续：`LLMAgentEventData.totalUsage`、`LLMAgentEventData.rate_limit`、消息持久层统计字段等，统一引用 `UsageStats` 和 `RateLimitInfo`，以保证形状一致与演进可控。

#### 3. AssistantMessageBlock (UI层消息块)

UI层使用的消息块定义，支持多种内容类型：

```typescript
export type AssistantMessageBlock = {
  type:
    | 'content'
    | 'search'
    | 'reasoning_content'
    | 'error'
    | 'tool_call'
    | 'action'
    | 'image'
    | 'artifact-thinking'
  content?: string
  extra?: Record<string, string | number | object[] | boolean>
  status:
    | 'success'
    | 'loading'
    | 'cancel'
    | 'error'
    | 'reading'
    | 'optimizing'
    | 'pending'
    | 'granted'
    | 'denied'
  timestamp: number
  artifact?: {
    identifier: string
    title: string
    type:
      | 'application/vnd.ant.code'
      | 'text/markdown'
      | 'text/html'
      | 'image/svg+xml'
      | 'application/vnd.ant.mermaid'
      | 'application/vnd.ant.react'
    language?: string
  }
  tool_call?: {
    id?: string
    name?: string
    params?: string
    response?: string
    server_name?: string
    server_icons?: string
    server_description?: string
  }
  action_type?: 'tool_call_permission' | 'maximum_tool_calls_reached' | 'rate_limit'
  image_data?: {
    data: string
    mimeType: string
  }
  reasoning_time?: {
    start: number
    end: number
  }
}
```

说明：权限请求等交互统一使用 `type: 'action'` 并通过 `action_type` 细分（例如 `tool_call_permission`）。不再单列 `tool_call_permission` 为独立块类型，减少语义重复与渲染分支复杂度。

#### 3.1 事件 → UI 块映射规范

- 文本：`LLMAgentEvent.data.content` → `{ type: 'content', content, status: 'success' }`
- 推理：`reasoning_content` → `{ type: 'reasoning_content', content, status: 'success', reasoning_time? }`
- 工具调用：
  - start → `{ type: 'tool_call', tool_call: { id, name, params }, status: 'loading' }`
  - running/update → 同一 `id` 累积参数或响应片段
  - end → 将对应 `tool_call` 块 `status` 置为 `success` 并填充 `response`
- 权限请求：`permission-required` → `{ type: 'action', action_type: 'tool_call_permission', status: 'pending' }`
- 速率限制：`rate_limit` → `{ type: 'action', action_type: 'rate_limit', extra: RateLimitInfo, status: 'error' | 'pending' }`
- 图像：`image_data` → `{ type: 'image', image_data }`
- 错误：`error` → `{ type: 'error', content: error, status: 'error' }`

#### 3.2 事件 → UI 映射表（规范）

| 事件来源 | 事件字段/状态 | UI 块 type | 必填字段 | 默认 status | 合并键 | 备注 |
| - | - | - | - | - | - | - |
| response | content | content | content | success | - | Markdown 渲染，需安全处理 |
| response | reasoning_content | reasoning_content | content | success | - | 可选 `reasoning_time` |
| response.tool_call | start | tool_call | tool_call.id, tool_call.name, params? | loading | tool_call.id | 新建或激活同 id 块 |
| response.tool_call | running / update | tool_call | tool_call.id | loading | tool_call.id | 追加参数/中间输出 |
| response.tool_call | end | tool_call | tool_call.id, response? | success | tool_call.id | 终态，写入 response |
| response | permission-required | action | action_type='tool_call_permission' | pending | tool_call.id | 待用户授权，后续置 granted/denied |
| response | rate_limit | action | action_type='rate_limit', extra=RateLimitInfo | pending | providerId | 可根据严重度置 error |
| response | image_data | image | image_data.data, image_data.mimeType | success | - | Base64，大小与类型受限 |
| error | error | error | content(error) | error | - | 错误块仅由错误事件驱动 |
| end | end | - | - | - | - | 用于收尾：将残留 loading 置为 error/cancel |
| response | totalUsage | - | UsageStats | - | - | 统计用途，不生成 UI 块 |

#### 3.3 渲染检查清单（Renderer Contract）

- 块 type 合法性：仅允许表内列出的组合，禁止未定义映射。
- 工具调用聚合：以 `tool_call.id` 聚合，状态流转仅允许 `loading → success | error`。
- 权限块：使用 `type='action'` 且 `action_type='tool_call_permission'`，授权结果仅为 `granted | denied`。
- 速率限制：显示 `providerId/qpsLimit/currentQps/queueLength`，根据需要展示 `estimatedWaitTime`；严重时允许 toast。
- 图像内容：`mimeType` 白名单，`data` 大小上限（建议 ≤ 2MB）；必要时降采样或懒加载。
- 错误收尾：`end` 到达时将仍为 `loading` 的块标记为 `error`（权限块除外）。
- 时间戳：所有块必须具备 `timestamp`，保证消息内单调递增。
- i18n：所有用户可见文本走 i18n key，避免硬编码。
- 无副作用：渲染器不得向下游发送 CoreEvent/AgentEvent，仅消费并渲染。

## 消息架构的优势分析

### 1. 分层设计的好处

- **关注点分离**: 每一层都有明确的职责
- **标准化通信**: 通过接口标准化不同层之间的通信
- **可扩展性**: 新的消息类型可以轻松添加到现有结构中

### 2. 当前支持的消息类型

基于 `MessageItemAssistant.vue` 的分析，当前系统已经支持：

1. **基础内容类型**
   - `content`: 普通文本内容
   - `reasoning_content`: 推理过程内容
   - `image`: 图片内容

2. **工具调用相关**
   - `tool_call`: 工具调用
   - `tool_call_permission`: 工具调用权限请求
   - `action`: 动作执行

3. **搜索和外部数据**
   - `search`: 搜索结果

4. **状态和错误处理**
   - `error`: 错误信息
   - `artifact-thinking`: 工件思考过程

## 向多Agent架构演进的设计

### 1. Agent类型抽象

为了支持多种Agent（如炒股Agent、编程Agent），我们需要定义Agent的抽象接口：

```typescript
export interface BaseAgent {
  id: string
  name: string
  description: string
  capabilities: AgentCapability[]

  // 核心方法
  processMessage(message: AgentMessage): AsyncGenerator<AgentResponse, void, unknown>
  getSupportedMessageTypes(): MessageType[]
  getConfigurationSchema(): object
}

export interface AgentCapability {
  type: 'tool_call' | 'reasoning' | 'search' | 'code_generation' | 'data_analysis' | 'image_processing'
  description: string
  required_permissions?: string[]
}
```

### 2. 统一消息接口

设计一个统一的Agent消息接口，支持所有类型的Agent：

```typescript
export interface AgentMessage {
  id: string
  type: MessageType
  role: 'user' | 'assistant' | 'system' | 'agent'
  agentId?: string // 目标Agent ID
  content: AgentMessageContent
  metadata: AgentMessageMetadata
  timestamp: number
}

export type MessageType =
  | 'text'
  | 'code'
  | 'data'
  | 'command'
  | 'file'
  | 'image'
  | 'structured_data'

export interface AgentMessageContent {
  text?: string
  code?: {
    language: string
    content: string
    filename?: string
  }
  data?: {
    format: 'json' | 'csv' | 'xml' | 'yaml'
    schema?: object
    content: any
  }
  command?: {
    type: string
    parameters: Record<string, any>
  }
  file?: {
    name: string
    content: string
    mimeType: string
  }
  image?: {
    data: string
    mimeType: string
    metadata?: ImageMetadata
  }
  structured?: {
    type: string
    data: any
  }
}
```

### 3. Agent响应接口

```typescript
export interface AgentResponse {
  id: string
  messageId: string
  agentId: string
  type: ResponseType
  content: AgentResponseContent
  metadata: AgentResponseMetadata
  status: ResponseStatus
  timestamp: number
}

export type ResponseType =
  | 'text'
  | 'code'
  | 'data'
  | 'command_result'
  | 'file'
  | 'image'
  | 'error'
  | 'progress'
  | 'confirmation'

export interface AgentResponseContent {
  text?: string
  code?: {
    language: string
    content: string
    output?: string
    error?: string
  }
  data?: {
    format: string
    content: any
    visualization?: DataVisualization
  }
  commandResult?: {
    success: boolean
    output: string
    error?: string
    exitCode?: number
  }
  file?: {
    name: string
    content: string
    mimeType: string
  }
  image?: {
    data: string
    mimeType: string
  }
  error?: {
    code: string
    message: string
    details?: any
  }
  progress?: {
    current: number
    total: number
    message: string
  }
  confirmation?: {
    type: 'permission' | 'action' | 'data'
    message: string
    options?: string[]
  }
}
```

### 4. Agent注册和发现

```typescript
export interface AgentRegistry {
  registerAgent(agent: BaseAgent): Promise<void>
  unregisterAgent(agentId: string): Promise<void>
  getAgent(agentId: string): BaseAgent | undefined
  getAgentsByCapability(capability: AgentCapability): BaseAgent[]
  getAllAgents(): BaseAgent[]
  discoverAgents(): Promise<BaseAgent[]>
}
```

## 落地阶段（无兼容妥协）

1) 强类型事件层
- 将 Provider 输出统一为判别联合 `LLMCoreStreamEvent`，提供 `createStreamEvent.*` 工厂与类型守卫
- 禁止可选字段大杂烩的单接口事件

2) Agent 事件标准
- `LLMAgentEvent` 严格区分 `response | error | end`，数据域使用共享类型 `UsageStats`、`RateLimitInfo`
- 规定 `permission-required`、`rate_limit` 的精确负载与语义

3) UI 块统一化
- `AssistantMessageBlock` 去除独立的 `tool_call_permission` 类型，统一以 `action + action_type`
- 明确“同一工具调用 id 的聚合与终态规则”

4) 文档与渲染协议
- 固化“事件 → UI 块映射表”，作为渲染器实现与测试基准

5) Presenter 类型拆分与目录规范
- 将超大 `presenter.d.ts` 拆分为多文件（详见《Presenter 类型拆分计划》）
- 统一导出门面，避免循环依赖

更多细节与任务分解，参见《Presenter 类型拆分计划》：`docs/agent/presenter-split-plan.md`。

## 具体Agent示例

### 1. 编程Agent

```typescript
export class ProgrammingAgent implements BaseAgent {
  id = 'programming-agent'
  name = '编程助手'
  description = '专业的编程助手，支持代码生成、调试、优化等'

  capabilities = [
    { type: 'code_generation', description: '代码生成和补全' },
    { type: 'tool_call', description: '运行代码、测试、构建' },
    { type: 'reasoning', description: '代码分析和优化建议' }
  ]

  async processMessage(message: AgentMessage): AsyncGenerator<AgentResponse> {
    if (message.content.code) {
      // 处理代码相关的消息
      yield* this.processCodeMessage(message)
    } else {
      // 处理普通文本消息
      yield* this.processTextMessage(message)
    }
  }
}
```

### 2. 炒股Agent

```typescript
export class StockAgent implements BaseAgent {
  id = 'stock-agent'
  name = '股票分析助手'
  description = '专业的股票分析助手，提供实时行情、技术分析等'

  capabilities = [
    { type: 'data_analysis', description: '股票数据分析' },
    { type: 'search', description: '实时行情查询' },
    { type: 'tool_call', description: '交易接口调用' }
  ]

  async processMessage(message: AgentMessage): AsyncGenerator<AgentResponse> {
    if (message.content.structured?.type === 'stock_query') {
      yield* this.processStockQuery(message)
    } else {
      yield* this.processGeneralQuery(message)
    }
  }
}
```

## UI组件适配

### 1. 通用消息渲染器

设计一个通用的消息渲染器，能够根据Agent类型和消息内容动态渲染：

```vue
<template>
  <div class="agent-message-container">
    <AgentHeader :agent="currentAgent" :message="message" />

    <div class="message-content">
      <component
        :is="getRendererComponent(message.type)"
        :message="message"
        :agent="currentAgent"
        v-bind="getRendererProps(message)"
      />
    </div>

    <AgentToolbar
      :agent="currentAgent"
      :message="message"
      @action="handleAction"
    />
  </div>
</template>
```

### 2. 渲染器注册机制

```typescript
export interface MessageRenderer {
  type: MessageType
  agentTypes?: string[] // 支持的Agent类型
  component: Component
  getProps: (message: AgentMessage) => Record<string, any>
}

export class MessageRendererRegistry {
  private renderers = new Map<string, MessageRenderer>()

  register(renderer: MessageRenderer): void {
    this.renderers.set(renderer.type, renderer)
  }

  getRenderer(type: MessageType, agentId?: string): MessageRenderer | undefined {
    return this.renderers.get(type)
  }
}
```

## 总结

通过该强类型、无兼容妥协的消息架构：

1. **类型安全彻底**：从 Provider 到 UI 的全链路判别联合与共享类型
2. **事件边界清晰**：CoreEvent 限域在 Provider，跨进程统一 AgentEvent
3. **渲染协议稳定**：事件→UI 映射可测试、可演进
4. **架构可扩展**：便于引入多 Agent 与新消息类型
5. **技术债最小化**：消除“可选字段拼接”和重复类型形状
