# Main Kernel Refactor EventBus Migration

## Purpose

本文件定义本轮对事件系统的收敛策略。

关键点只有一句话：

- 本轮不先重写整个 EventBus
- 本轮先为 migrated path 建立 typed UI event，并冻结 legacy event 的继续扩张

## Current State

当前事件系统的核心问题：

- `src/main/eventbus.ts` 同时承担 main 内部通知和 main -> renderer 广播
- `eventBus` 直接依赖 `windowPresenter`
- `src/main/events.ts` 中字符串事件常量混合了多种语义
- renderer 仍习惯直接监听 `window.electron.ipcRenderer.on(...)`

这说明现在的问题是“职责混杂”，但并不意味着本轮必须把整套事件系统一次性改完。

## Target State For This Program

本轮只要求达到以下状态：

```text
shared/contracts/events   # migrated path 的 typed UI event 定义
preload bridge            # 对 typed event 的统一订阅入口
renderer/api clients      # 吸收 bridge 细节
main publisher/adapters   # migrated path 通过明确 publisher 发事件
legacy eventBus           # 继续服务于未迁移路径，但冻结新增错误用法
```

## Event Taxonomy For This Program

### Typed UI Events

本轮优先处理：

- `settings.changed`
- `sessions.updated`
- `chat.stream.updated`
- `chat.stream.completed`
- `chat.stream.failed`

这些事件直接服务于 migrated path 的 renderer 刷新。

### Legacy Internal Events

现有 `eventBus` 仍可继续承接未迁移路径的内部通知，但：

- 不再给 migrated path 新增依赖
- 不再把新 UI 通知继续挂在 raw string event 上

## Old To New Mapping

### Migrated Path Mapping

| Old pattern | New pattern |
| --- | --- |
| `eventBus.sendToRenderer(...)` | typed UI event publisher |
| `window.electron.ipcRenderer.on(...)` | preload bridge subscription + renderer client/store adapter |
| renderer 直接监听 raw event 名 | renderer 通过 typed event client / helper 订阅 |

### Legacy Path Policy

对于未迁移路径：

- 保持现状可接受
- 但禁止继续扩张错误用法

## Migration Strategy

### Phase 1

- 定义 typed UI event catalog
- 冻结 migrated path 上新增 raw renderer event 监听
- 为 preload bridge 准备统一订阅面

### Phase 2

- settings slice 改为 typed `settings.changed`
- settings store 不再依赖 raw IPC 监听

### Phase 3

- chat/session migrated path 改为 typed `sessions.updated`、`chat.stream.*`
- 新的 stop / restore / send 主链路不再直接依赖 `eventBus.sendToRenderer`

### Phase 4

- provider / permission 相关 migrated path 如需通知 renderer，优先走 typed event
- 若发现 legacy eventBus 成为 hot path 阻塞点，再评估是否值得拆 internal bus

### Phase 5

- 回顾本轮迁移范围内是否还存在 legacy raw event 依赖
- 决定下一轮是否真的需要全量 EventBus 重写

## Proposed Publisher Shape

本轮只需要一个足够简单的发布能力：

```ts
export interface WindowEventPort {
  publish<TPayload>(eventName: string, payload: TPayload): Promise<void>
  publishToWindow?<TPayload>(windowId: number, eventName: string, payload: TPayload): Promise<void>
  publishToWebContents?<TPayload>(
    webContentsId: number,
    eventName: string,
    payload: TPayload
  ): Promise<void>
}
```

重点不是接口有多复杂，而是：

- migrated path 不再隐式依赖全局 `eventBus`
- renderer 收到的是 typed contract，而不是内部常量泄漏

## Completion Criteria

本轮在事件系统上的完成标准是：

- migrated path 的 UI 通知具备 typed event
- renderer 不再为 migrated path 新增 raw event listener
- 新主路径不再继续依赖 `eventBus.sendToRenderer`

本轮不要求：

- 删除 `src/main/eventbus.ts`
- 删除 `src/main/events.ts`
- 完成全量事件分类重写
