# Main Kernel Refactor Route Schema Catalog

## Purpose

本文件锁定本轮真正需要的两类契约：

1. renderer 发起的 typed route
2. main -> renderer 的 typed event

目标不是一次性冻结所有未来 route，而是先把 migrated path 的边界稳定下来。

## Design Rules

### 1. Route Only Solves Renderer-Main Boundary

route registry 只收 renderer 发起、必须跨 renderer-main 边界的能力。

main 内部协作不进 route registry。

### 2. Capability Naming

route 名称按用户意图命名，不按内部类命名：

- `settings.getSnapshot`
- `settings.update`
- `sessions.create`
- `chat.sendMessage`
- `chat.stopStream`

不要出现：

- `configPresenter.get`
- `llmProviderPresenter.generate`
- `sessionRepository.insert`

### 3. Coarse-Grained Surface

renderer 调用 use case，不调用内部编排步骤。

合理：

- `chat.sendMessage`
- `chat.stopStream`
- `providers.listModels`

不合理：

- `messages.insertUserMessage`
- `provider.executeWithRateLimit`
- `sessionRuntime.refreshUi`

### 4. Registry Is The Source Of Truth

同一份 registry 负责：

- route 名称
- input/output schema
- preload bridge 类型来源
- renderer client 类型来源

### 5. Typed Events For Migrated Paths

只要 migrated path 需要 main -> renderer 通知，就必须定义 typed event。

不再允许为 migrated path 新增随意字符串事件。

## Target Layout

```text
src/shared/contracts/
  routes/
    settings.routes.ts
    sessions.routes.ts
    chat.routes.ts
    providers.routes.ts
    system.routes.ts
  events/
    settings.events.ts
    sessions.events.ts
    chat.events.ts
  routes.ts
  events.ts
```

本轮不要求一开始就有更多分类文件。

## Common Schemas

第一批建议统一这些基础 schema：

```ts
import { z } from 'zod'

export const EntityIdSchema = z.string().min(1)
export const TimestampMsSchema = z.number().int().nonnegative()

export const JsonValueSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema)
  ])
)

export const AppErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retriable: z.boolean().default(false),
  details: z.record(JsonValueSchema).optional()
})
```

## Initial Route Catalog

### Phase 1 and Phase 2

| Route | Input summary | Output summary | Notes |
| --- | --- | --- | --- |
| `settings.getSnapshot` | optional key filter | settings snapshot | settings pilot 主入口 |
| `settings.update` | array of key/value changes | version + changed keys | 取代散落设置调用 |
| `system.openSettings` | optional section | `{ windowId }` | 取代直接窗口调用 |

### Phase 3

| Route | Input summary | Output summary | Notes |
| --- | --- | --- | --- |
| `sessions.create` | title / provider / model / agent / projectDir | session summary | 会话创建主入口 |
| `sessions.restore` | `{ sessionId }` | session snapshot | 恢复主入口 |
| `sessions.list` | optional filter | session summaries | 列表主入口 |
| `chat.sendMessage` | `sessionId`, content, attachments | request / message ids | 聊天发送主入口 |
| `chat.stopStream` | `sessionId` or `requestId` | `{ stopped: boolean }` | 停止流语义固定 |

### Phase 4

| Route | Input summary | Output summary | Notes |
| --- | --- | --- | --- |
| `providers.listModels` | `{ providerId }` | model summaries | provider 查询边界 |
| `providers.testConnection` | provider draft config | test result | 仅在配置页需要时开放 |
| `chat.respondPermission` | session / request / decision | `{ accepted: boolean }` | 统一权限响应入口 |

## Initial Typed Event Catalog

本轮最先冻结以下事件：

| Event | Payload summary | Why |
| --- | --- | --- |
| `settings.changed` | changed keys + version | settings store 刷新 |
| `sessions.updated` | affected session ids + reason | 会话列表与当前会话刷新 |
| `chat.stream.updated` | requestId/sessionId + delta/tool/update | 流式主路径 |
| `chat.stream.completed` | requestId/sessionId/messageId | 结束信号 |
| `chat.stream.failed` | requestId/sessionId/error | 错误信号 |

### Example Stream Event Schema

```ts
export const ChatStreamEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('delta'),
    requestId: EntityIdSchema,
    sessionId: EntityIdSchema,
    messageId: EntityIdSchema,
    textDelta: z.string()
  }),
  z.object({
    kind: z.literal('tool-call'),
    requestId: EntityIdSchema,
    sessionId: EntityIdSchema,
    toolCallId: EntityIdSchema,
    toolName: z.string(),
    status: z.enum(['start', 'running', 'end', 'error'])
  }),
  z.object({
    kind: z.literal('permission-required'),
    requestId: EntityIdSchema,
    sessionId: EntityIdSchema,
    permissionRequestId: EntityIdSchema,
    permissionType: z.enum(['read', 'write', 'all', 'command'])
  })
])
```

## What We Intentionally Do Not Freeze Yet

为了避免过度设计，以下内容本轮不提前固定：

- main 内部 provider orchestration protocol
- repository-level CRUD route
- file / browser / workspace 的全量系统 route
- plugin 相关 route
- 低频页面的边角能力

## Implementation Guardrails

新增 route 或 event 时必须回答：

1. 这是否真的是 renderer-main 边界？
2. 名称是否表达用户意图，而不是内部实现细节？
3. 是否已经有更粗粒度的 route 可承接？
4. 是否能通过 schema 清楚描述？
5. 是否会替代一条现有 raw IPC 或 presenter 直调？
