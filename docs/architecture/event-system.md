# 事件系统

本文说明 DeepChat 当前的 main → renderer 通知边界。全局 main 进程 `EventBus` 已经删除。

## 当前路径

```text
负责业务状态的模块
  -> App composition 注入的 publishDeepchatEvent(name, payload)
  -> shared/contracts/events 检查数据
  -> WindowPresenter 发送 deepchat:event
  -> preload createBridge 分发
  -> renderer/api client 或 store 处理
```

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 事件定义 | `src/shared/contracts/events.ts` | 汇总 renderer 可见事件及数据类型 |
| 通道名 | `src/shared/contracts/channels.ts` | 定义 `deepchat:event` |
| 发布入口 | `src/main/app/composition.ts` | 创建 event envelope 并把发送函数注入模块 |
| 发送 | `src/main/desktop/window/` | 发给全部窗口或指定 webContents |
| preload | `src/preload/createBridge.ts` | 接收统一通道并按事件名分发 |
| renderer | `src/renderer/api/*Client.ts` 和 store | 注册监听并负责清理 |

## Renderer 可见事件

`DEEPCHAT_EVENT_CATALOG` 是唯一事件表。新增 renderer 可见事件时：

1. 在 `src/shared/contracts/events/*.events.ts` 定义名称和数据；
2. 从 `src/shared/contracts/events.ts` 导出；
3. 通过 composition 注入的 publish function 发布；
4. renderer 通过 `window.deepchat.on()` 或对应 client 接收。

示例：

```ts
publishDeepchatEvent('chat.stream.completed', {
  eventId,
  userStop: false
})
```

```ts
const stop = window.deepchat.on('chat.stream.completed', (payload) => {
  messageStore.finishStream(payload.eventId)
})
```

## Main 进程内部通信

main 内部不再有全局 `EventBus`。根据用途选择明确方式：

- 要求另一个模块执行操作、等待结果或保证顺序：直接调用窄接口；
- 表示某个模块内已经发生的事实，并且确实有多个观察者：由该模块提供有类型的订阅接口；
- 表示 ready：提供可查询状态或可等待的 Promise；
- 没有接收方或与 renderer typed event 重复：删除。

Provider DB 更新是当前保留的模块内通知：Loader 通知模型能力索引重建，App 把更新明确连接到
Provider 的后台 model 刷新。它不是通用事件总线。

`src/main/events.ts` 只保留少量明确的原始窗口输入常量，例如设置导航、开发入口、deeplink 和快捷键。
这些常量不能用于 main 模块之间传递业务命令。

## 请求和返回

renderer 发起查询或命令时使用 typed route：

```text
Vue component/store
  -> renderer/api client
  -> window.deepchat.invoke(routeName, input)
  -> shared/contracts/routes 检查输入和输出
  -> src/main/routes handler/service
  -> 负责该行为的模块
```

| 需要 | 边界 |
| --- | --- |
| 查询数据或执行命令 | typed route |
| 通知 renderer 状态已变化 | typed event |
| main 模块要求另一个模块做事 | 直接调用窄接口 |
| 发给单个 webContents | 使用 Desktop 注入的窄发送函数 |

## 自动限制

- 全局 `EventBus`、`eventBus`、`sendToMain()` 和 `PROVIDER_DB_EVENTS` 保持删除；
- renderer 可见数据必须通过 shared typed event；
- 原始 IPC 和宽泛 `window.electron` 访问只能留在明确的 preload/bridge 边界；
- `useLegacyPresenter()`、`presenter:call`、`remoteControlPresenter:call` 和
  `src/renderer/api/legacy/**` 保持删除。

## 相关文档

- [架构总览](../ARCHITECTURE.md)
- [核心流程](../FLOWS.md)
- [Agent 系统](./agent-system.md)
- [Tool 系统](./tool-system.md)
