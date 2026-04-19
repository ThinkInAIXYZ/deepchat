# Main Kernel Refactor Route Schema Catalog

## Purpose

本文件在实施前锁定两件事：

1. route registry 的组织方式
2. 首批 `window.deepchat` 能力的 schema 设计

目标不是今天就把所有 route 都实现，而是先把命名、分组、schema 粒度和事件契约定死，避免实施时越写越散。

## Design Rules

### 1. Route Solves Only Renderer-Main Boundary

route registry 只收 renderer 发起、必须跨 renderer-main 边界的能力。

main 内部协作不进 route registry。

### 2. Product Capability Naming

route 名称按用户意图或产品能力命名，不按内部类命名：

- `chat.sendMessage`
- `sessions.restore`
- `settings.update`
- `providers.testConnection`

不要出现：

- `providerPresenter.generate`
- `sqlite.execute`
- `sessionRepository.insert`

### 3. Coarse-Grained Route Surface

renderer 调 use case，不调 main 内部编排步骤。

例如：

- `chat.sendMessage` 合理
- `messages.insertUserMessage` 不合理
- `providers.resolveRateLimit` 不合理

### 4. Registry Is The Source Of Truth

同一份 registry 负责：

- channel 名称
- input/output schema
- preload bridge 生成
- main route 注册
- renderer client 类型来源

### 5. Events Are Typed Too

长时运行结果和 UI 通知不允许再靠任意字符串 channel。

route registry 之外，还需要一份 typed event catalog。

## Target Layout

```text
src/shared/contracts/
  schemas/
    common.ts
    ids.ts
    errors.ts
  routes/
    chat.routes.ts
    sessions.routes.ts
    settings.routes.ts
    providers.routes.ts
    tools.routes.ts
    system.routes.ts
  events/
    chat.events.ts
    sessions.events.ts
    settings.events.ts
    notifications.events.ts
  routes.ts
```

其中：

- `routes/*.routes.ts` 定义 invoke-style route
- `events/*.events.ts` 定义 main -> renderer typed event
- `routes.ts` 做 aggregate export，供 preload 和 main 共用

## Route Definition Shape

建议 shape：

```ts
import { z } from 'zod'

export type InvokeRouteDefinition = {
  channel: string
  input: z.ZodTypeAny
  output: z.ZodTypeAny
}

export const ROUTES = {
  chat: {
    sendMessage: {
      channel: 'chat.sendMessage',
      input: ChatSendMessageInputSchema,
      output: ChatSendMessageResultSchema
    }
  }
} as const
```

对于 stream 和 watch，不再开放任意 channel。

建议额外维护 typed event catalog：

```ts
export const UI_EVENTS = {
  chat: {
    stream: ChatStreamEventSchema
  },
  sessions: {
    updated: SessionUiEventSchema
  }
} as const
```

## Common Schemas

第一批建议统一这些基础 schema：

```ts
import { z } from 'zod'

export const EntityIdSchema = z.string().min(1)
export const TimestampMsSchema = z.number().int().nonnegative()

export const JsonValueSchema: z.ZodType =
  z.lazy(() =>
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

export const FileRefSchema = z.object({
  id: EntityIdSchema,
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative().optional()
})
```

## Initial Invoke Route Catalog

### Phase 1 and Phase 3

| Route | Input summary | Output summary | Notes |
| --- | --- | --- | --- |
| `settings.getSnapshot` | `scope?`, `keys?` | settings snapshot + version | 首个 pilot slice |
| `settings.update` | array of setting changes | updated version + changed keys | 不做 field-level random mutation route |
| `windows.openSettings` | optional `section` | `{ windowId }` | 替代 `createSettingsWindow` 的 renderer-main 调用 |

### Phase 4

| Route | Input summary | Output summary | Notes |
| --- | --- | --- | --- |
| `sessions.list` | filter/sort options optional | `SessionSummary[]` | renderer 列表主入口 |
| `sessions.create` | title/provider/model/agent/projectDir | `SessionSummary` | 不暴露内部 manager 细节 |
| `sessions.restore` | `{ sessionId }` | session detail snapshot | 恢复 UI 所需状态 |
| `sessions.activate` | `{ sessionId, webContentsId? }` | `{ sessionId, active: true }` | 仅 renderer 需要时进入 route |
| `sessions.archive` | `{ sessionId }` | `{ sessionId, archived: true }` | 可在 P4 或更后面落 |

### Phase 5

| Route | Input summary | Output summary | Notes |
| --- | --- | --- | --- |
| `chat.sendMessage` | `sessionId`, `content`, `attachments[]` | request/session/message ids | 推荐作为主入口 |
| `chat.startStream` | `sessionId`, optional `requestId` or resume token | request id + stream accepted | 仅在 send/stream 被明确拆成两段时启用 |
| `chat.stopStream` | `sessionId` or `requestId` | `{ stopped: boolean }` | 明确停止语义 |
| `chat.retryMessage` | `sessionId`, `messageId` | new request/message ids | 只有确认保留该交互时才开放 |
| `tools.respondPermission` | `sessionId`, `requestId`, `decision` | `{ accepted: boolean }` | renderer 对权限对话框的显式响应 |

### Phase 6

| Route | Input summary | Output summary | Notes |
| --- | --- | --- | --- |
| `providers.list` | optional filter | provider summaries | renderer 配置页需要 |
| `providers.listModels` | `{ providerId }` | model summaries | 来自 `ProviderCatalogPort` |
| `providers.testConnection` | providerId + config draft | test result | 配置页用例 |
| `tools.listAvailable` | `{ sessionId }` optional | tool summaries | 只有 renderer 确实要展示时才开放 |
| `files.pick` | selection constraints | file refs | 系统能力 route |
| `files.revealInFolder` | `{ filePath }` | `{ ok: true }` | 系统能力 route |

## Initial Event Catalog

以下是与 route 配套、必须提前定型的 typed event：

| Event | Payload summary | Why |
| --- | --- | --- |
| `chat.stream.updated` | requestId, sessionId, delta/tool/update | 流式主路径 |
| `chat.stream.completed` | requestId, sessionId, assistantMessageId | 结束信号 |
| `chat.stream.failed` | requestId, sessionId, error | 错误信号 |
| `sessions.updated` | affected session ids + reason | 列表和当前会话刷新 |
| `settings.changed` | changed keys + version | 设置页和依赖设置的 store 刷新 |
| `notifications.error` | code/message/display scope | 替代散落通知事件 |

### Stream Event Schema

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

### Session Summary Schema

```ts
export const SessionSummarySchema = z.object({
  id: EntityIdSchema,
  title: z.string(),
  agentId: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  status: z.enum(['idle', 'generating', 'blocked', 'archived']),
  updatedAt: TimestampMsSchema
})
```

### Settings Update Schema

```ts
export const SettingChangeSchema = z.object({
  key: z.string().min(1),
  value: JsonValueSchema
})

export const SettingsUpdateInputSchema = z.object({
  changes: z.array(SettingChangeSchema).min(1)
})

export const SettingsUpdateResultSchema = z.object({
  version: z.number().int().nonnegative(),
  changedKeys: z.array(z.string())
})
```

## What We Intentionally Do Not Freeze Yet

为了避免过度设计，以下内容现在不提前锁死成 route：

- main 内部 provider orchestration
- tool internal execution protocol
- repository-level CRUD
- plugin-related routes
- 只有单个页面暂时使用、且很可能合并回更粗粒度 use case 的 low-level route

## Implementation Guardrails

实施时必须检查：

1. 新增 route 是否真的是 renderer-main 能力
2. route 名称是否表达用户意图而不是内部类名
3. 是否已经有更粗粒度 route 可以承接
4. input/output 是否都能用 schema 描述
5. 长时结果是否通过 typed event，而不是新加裸 channel
