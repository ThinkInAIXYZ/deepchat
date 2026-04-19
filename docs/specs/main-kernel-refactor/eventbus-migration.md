# Main Kernel Refactor EventBus Migration

## Purpose

本文件定义 EventBus 重写的目标位置、旧新映射关系，以及迁移方式。

目标不是把旧 `eventBus` 机械改名，而是把当前“全局单例 + 字符串事件 + renderer 广播 + main 内部通知”这几种完全不同的职责拆开。

## Current State

当前事件系统主要由这两处组成：

| Current file | Responsibility today |
| --- | --- |
| `src/main/eventbus.ts` | 全局 singleton，既做 main 内部 `emit/on`，又做 main -> renderer 转发 |
| `src/main/events.ts` | 大量字符串事件常量，混合 config/session/stream/window/mcp/update 等多种语义 |

当前典型问题：

- main 内部事件和 main -> renderer UI 事件混在同一个总线里
- `eventBus` 直接依赖 `windowPresenter`
- 事件以字符串常量为主，类型弱
- 一个事件名常常同时承担 domain、integration、ui 三类语义
- renderer 监听模式仍和旧 `window.api` / `window.electron` 习惯耦合

## Target State

重构后应拆成四个位置：

```text
src/shared/events/                # typed event definitions only
src/main/ports/EventBus.ts        # main internal event bus interface
src/main/infra/events/TypedEventBus.ts
src/main/platform/electron/WindowEventPort.ts
```

各自职责：

| Target location | Responsibility |
| --- | --- |
| `src/shared/events/*` | domain / integration / ui event definition |
| `src/main/ports/EventBus.ts` | main 内部发布订阅能力 |
| `src/main/infra/events/TypedEventBus.ts` | EventBus 实现，进入 app scope |
| `src/main/platform/electron/WindowEventPort.ts` | 向 renderer 发送 typed UI event |

一句话：

- main 内部协作走 `EventBus`
- main -> renderer 通知走 `WindowEventPort`

## Event Taxonomy

### Domain Events

描述业务事实，通常来自 service/use case：

- `session.created`
- `message.user.created`
- `message.assistant.completed`
- `tool.executed`

建议位置：

```text
src/shared/events/domain/
```

### Integration Events

描述系统间协作状态变化：

- `providers.changed`
- `settings.changed`
- `mcp.registry.updated`
- `workspace.invalidated`

建议位置：

```text
src/shared/events/integration/
```

### UI Events

描述 renderer 需要刷新的事件，不等同于业务事实：

- `chat.stream.updated`
- `chat.stream.completed`
- `sessions.updated`
- `notifications.error`

建议位置：

```text
src/shared/events/ui/
```

## Old To New Mapping

### File Mapping

| Old location | New location | Notes |
| --- | --- | --- |
| `src/main/eventbus.ts` | `src/main/ports/EventBus.ts` + `src/main/infra/events/TypedEventBus.ts` + `src/main/platform/electron/WindowEventPort.ts` | 旧文件被拆成三层 |
| `src/main/events.ts` | `src/shared/events/domain/*` + `integration/*` + `ui/*` + 部分 `shared/contracts` | 不再保留单一巨型常量文件 |

### API Mapping

| Old API | New home |
| --- | --- |
| `eventBus.on(...)` / `emit(...)` | `EventBus.subscribe(...)` / `publish(...)` |
| `eventBus.sendToRenderer(...)` | `WindowEventPort.publish(...)` |
| `eventBus.sendToWindow(...)` / `sendToWebContents(...)` | `WindowEventPort.publishToWindow(...)` / `publishToWebContents(...)` |
| `eventBus.send(...)` | 显式分成 `EventBus.publish(...)` + `WindowEventPort.publish(...)`，不再隐式双发 |
| `eventBus.setWindowPresenter(...)` | 不再存在，改成注入 Electron adapter |

### Event Category Mapping

| Old category in `events.ts` | New home | Migration note |
| --- | --- | --- |
| `STREAM_EVENTS` | `shared/events/ui/chat.events.ts` 或 `shared/contracts/chat.events.ts` | 这是 main -> renderer typed UI event |
| `CONVERSATION_EVENTS` / `SESSION_EVENTS` | `shared/events/domain/session.events.ts` + `shared/events/ui/session.events.ts` + `SessionEventStore` | 一部分进 event store，一部分保留 UI event |
| `CONFIG_EVENTS` | `shared/events/integration/settings.events.ts` / `providers.events.ts` | 按 settings 和 provider 分开 |
| `PROVIDER_DB_EVENTS` | `shared/events/integration/providers.events.ts` | integration event |
| `MCP_EVENTS` | `shared/events/integration/mcp.events.ts` + 少量 UI event | 不再全部挂在一个常量对象上 |
| `NOTIFICATION_EVENTS` | `shared/events/ui/notification.events.ts` | 纯 UI 提示事件 |
| `WORKSPACE_EVENTS` | `shared/events/integration/workspace.events.ts` + UI refresh event | 失效通知与 UI 刷新分开 |
| `UPDATE_EVENTS` | `shared/events/ui/update.events.ts` | 更新状态本质是 UI-facing lifecycle |
| `WINDOW_EVENTS` / `TAB_EVENTS` | 主要下沉到 `platform/electron` 生命周期 | 不再默认暴露成通用业务事件 |

## Proposed EventBus Interface

建议接口：

```ts
export interface EventEnvelope<TType extends string, TPayload> {
  id: string
  type: TType
  payload: TPayload
  createdAt: number
  correlationId?: string
}

export interface EventBus {
  publish<TType extends string, TPayload>(
    event: EventEnvelope<TType, TPayload>
  ): Promise<void>

  subscribe<TType extends string, TPayload>(
    type: TType,
    handler: (event: EventEnvelope<TType, TPayload>) => Promise<void> | void
  ): Disposable

  publishAndWait?<TType extends string, TPayload>(
    event: EventEnvelope<TType, TPayload>,
    options: { timeoutMs: number; minHandlers: number }
  ): Promise<void>
}
```

说明：

- `EventBus` 只负责 main 内部事件，不负责窗口路由
- `publishAndWait` 只给关键链路用，不给普通 UI 广播滥用

## Proposed Window Event Port

```ts
export interface WindowEventPort {
  publish<TPayload>(eventName: string, payload: TPayload): Promise<void>
  publishToWindow<TPayload>(windowId: number, eventName: string, payload: TPayload): Promise<void>
  publishToWebContents<TPayload>(
    webContentsId: number,
    eventName: string,
    payload: TPayload
  ): Promise<void>
}
```

这层 adapter 的实现放在 `platform/electron`，而不是塞回 `EventBus`。

## Migration Strategy

### Phase 1

- 冻结旧 `eventBus` 的新增用法
- 新增 typed event definitions 目录
- 对 stream/session/settings 先定义 event schema

### Phase 2

- 引入 `main/ports/EventBus.ts`
- 引入 `main/infra/events/TypedEventBus.ts`
- 引入 `WindowEventPort` Electron adapter
- 在 app scope 注册新 bus 和新 window event publisher

### Phase 4

- session 相关状态变化先进入 `SessionEventStore`
- `SESSION_EVENTS` / `CONVERSATION_EVENTS` 开始拆成 domain event + ui event

### Phase 5

- `STREAM_EVENTS` 改为 typed UI event
- chat 主链路不再直接依赖旧 `eventBus.sendToRenderer`

### Phase 6

- provider/tool/MCP/workspace/update 事件按 integration/ui 分类迁出
- `ConfigQueryPort` / `SessionRuntimePort` 引起的事件式回调改为明确 port 或 event

### Phase 7

- 删除 `src/main/eventbus.ts`
- 删除 `src/main/events.ts`
- renderer 不再通过旧 bridge 监听 legacy raw event channel

## Migration Mapping Examples

### Example 1: Stream Delta

旧：

```ts
eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, payload)
```

新：

```ts
await windowEventPort.publish('chat.stream.updated', payload)
```

### Example 2: Main Internal Provider Change

旧：

```ts
eventBus.on(CONFIG_EVENTS.PROVIDER_CHANGED, handler)
```

新：

```ts
eventBus.subscribe('providers.changed', handler)
```

### Example 3: Session Created

旧：

```ts
eventBus.send(CONVERSATION_EVENTS.LIST_UPDATED, SendTarget.ALL_WINDOWS, payload)
```

新：

```ts
await eventBus.publish({
  id: eventId,
  type: 'session.created',
  payload
})

await windowEventPort.publish('sessions.updated', {
  reason: 'created',
  sessionIds: [payload.sessionId]
})
```

这里显式分开“业务事实”和“UI 刷新”。

## Guardrails

实施时必须遵守：

1. 不在新 service 中调用旧 `eventBus` singleton
2. 不新增新的 `events.ts` 字符串常量桶
3. main 内部事件和 renderer UI 事件必须分层
4. 一个 legacy 事件如果要迁移，必须说明它变成 domain、integration、ui 还是 route return
5. `send()` 这种隐式双发模型不保留到新架构
