# Remote、Scheduler、Deeplink 和 Hook 模块边界

本文确定四个外部入口和结果接收模块的职责。它们都可以使用 Session，但不能接管 Session 或
Agent 的内部状态。

## 共同规则

这四个模块是 App 创建的同级模块，不放进一个新的“入口管理器”。

- Remote 接收聊天平台消息，并把 endpoint 绑定到 Session；
- Scheduler 查找到期任务，每次创建一个新的 detached Session；
- Deeplink 把一次外部链接转换成明确操作；
- Hook 观察已经发生的运行事实，并执行用户配置的命令。

它们只能调用 Session 的 Lifecycle、Turn、Assignment 和 Query 窄接口。它们不能读取 Agent
instance map，不能直接改 Session 表，也不能借用 Desktop 的窗口状态表示任务状态。

## Remote

### Remote 负责什么

Remote 负责：

- Telegram、Feishu、QQBot、Discord 和 Weixin iLink channel 的启动、停止和状态；
- channel settings、账号、pair code 和 endpoint binding；
- 收到消息后的协议解析、权限检查和命令路由；
- 调用 Session 创建、继续、改 model、发送消息和回答 Interaction；
- 把 Session 结果转换成各 channel 能发送的文字、图片和交互按钮；
- 为 Cron 提供一个只负责发送结果的 `RemoteDeliveryPort`；
- Feishu 授权、Feishu 安装和 Weixin iLink 登录过程中自己创建的 server、window、timer 和等待任务。

Remote 不负责：

- Session 身份、transcript、Tape、pending input 或删除规则；
- Agent 类型选择和 Agent instance 生命周期；
- Cron job、run 和 delivery receipt；
- Desktop 的 tab/window binding；
- 通用 File、Provider、Tool 或 MCP 运行状态。

### Endpoint binding

Remote binding 表示“某个外部会话继续使用哪个 Session”。它由 Remote 保存和删除。

```text
channel + account + endpoint
          |
          v
   RemoteBindingStore
          |
          v
      sessionId
```

收到普通消息时，Remote 先查 binding：

1. binding 存在时，调用 Session Query 确认 Session 仍存在；
2. binding 不存在或指向已删除 Session 时，调用 Session Lifecycle 创建普通 detached Session；
3. 保存新的 binding；
4. 调用 Session Turn 发送消息；
5. 通过 Session 的有类型运行通知接收结果，再由 channel adapter 发送。

解绑只删除 Remote binding，不删除 Session。删除 Session 后，Remote 在下次使用该 binding 时清理
失效记录。Remote 的 `stop` 命令只取消当前 Turn，不删除 Session。

### Remote 内部分工

当前 `RemoteControlPresenter` 同时包含公共 API、五种 channel、授权窗口、runtime 重建、状态汇总和
Cron delivery，共 2800 多行。目标结构拆成下面几部分：

```text
src/main/remote/
├── index.ts                    # RemoteService，对外窄接口
├── ports.ts                    # Session、Desktop、File、Agent catalog 窄接口
├── binding/                    # endpoint 和 principal 保存规则
├── conversation/               # Session 调用、结果收集和内容转换
├── delivery/                   # Cron 结果发送
└── channels/
    ├── telegram/
    ├── feishu/
    ├── qqbot/
    ├── discord/
    └── weixinIlink/
```

每种 channel 自己负责 settings、签名、runtime、状态和专有授权流程。`RemoteService` 只做公共 API
分发和全模块 lifecycle，不再保存每种协议的全部细节。

旧 `IRemoteControlPresenter`、`RemoteControlPresenter` 和
`src/main/presenter/remoteControlPresenter/` 直接删除。route 名称、输入输出、远程命令和保存数据不变。

## Scheduler

### Scheduler 负责什么

Scheduler 负责：

- Cron job、run、agent snapshot 和 delivery receipt 数据；
- cron 表达式检查、下一次运行时间和开关状态；
- scheduler utility process、系统唤醒后的重新检查和 stale run 修复；
- claim run、并发策略、timeout 和 cancellation；
- 每次 run 调用 Session Lifecycle 创建一个新的 detached Session；
- 调用 Session Turn 开始或取消该次任务；
- 根据 Session 的有类型运行通知记录完成结果；
- 调用 Remote delivery 窄接口发送结果，并保存 receipt。

Scheduler 不负责模型执行、Tool 执行、Agent instance 或 Remote channel。

### 每次 run 的固定流程

```text
到期或手动运行
      |
      v
queue + claim run
      |
      v
createDetachedSession
      |
      v
SessionTurn.sendMessage
      |
      v
Session 运行通知
      |
      v
更新 run -> RemoteDeliveryPort -> 保存 receipt
```

每个 run 都创建新 Session，不复用上一次 run 的 Session。job/run/delivery 数据仍归 Scheduler，
Session 只保存普通 Session 数据和 metadata 中的 `cronJobId`、`cronJobRunId`。

### 创建时必须完整连接

当前 Cron 先以不完整状态创建，后面再调用 `setRunSessionStarter()` 和
`setRemoteDeliveryPort()`。这会产生“已经启动但还不能运行”的隐藏状态。

目标实现由 App 先创建 Remote、Session ports 和 delivery port，再一次性创建 Scheduler。下面依赖
在构造时全部必需：

- job repository；
- agent catalog；
- Session Lifecycle 和 Turn；
- Remote delivery；
- scheduler process manager；
- schedule service。

删除两个 setter、`runExecutor === null` 分支和“session starter is not initialized”运行时兜底。
测试需要替身时直接传入完整替身，不给生产代码保留可选依赖。

目标目录是 `src/main/scheduler/`。保留外部 `cronJobs.*` route 和数据名，不保留旧 Presenter 目录。

## Deeplink

### Deeplink 负责什么

Deeplink 只负责：

- 注册和解析 `deepchat://` 协议；
- 保存启动阶段尚未处理的一条链接；
- 检查协议、command、参数大小和敏感日志；
- 把 `start`、`mcp/install` 和 `provider/install` 转换成明确操作；
- MCP 尚未 ready 时保存一条待处理安装链接，并在 MCP 启动后处理。

Deeplink 不直接拥有 Window、Config 或 MCP。它接收三个窄接口：

- `DeeplinkDesktopPort`：准备聊天窗口并发送 start payload；
- `DeeplinkMcpInstallPort`：查询 ready 和安装配置；
- `DeeplinkProviderInstallPort`：预览、保存和发布 provider 变化。

这样 Deeplink 只决定“链接表示什么”，各模块仍决定“操作怎样完成”。它不创建 Session，因为当前
`start` 行为只是把预填消息交给 renderer，不能在重构中偷偷改成自动发送。

目标目录是 `src/main/deeplink/`，入口类叫 `DeeplinkService`。删除 `IDeeplinkPresenter`、
`DeeplinkPresenter` 和旧目录，不保留转发文件。

## Hook

### Hook 是观察者

Hook 只接收已经发生的事实，例如 SessionStart、UserPromptSubmit、ToolUse 和 Stop。Hook 命令失败
不能让 Session 操作回滚，也不能决定 Turn 是否完成。

Session 和 Agent 只依赖一个必需的 `HookObserver`：

```ts
interface HookObserver {
  notify(notification: HookNotification): void
}
```

App 已经创建唯一的 `HookService` 并直接作为 observer 注入，不再创建
`NewSessionHooksBridge`。DeepChat 和 ACP 使用同一通知类型，不再从 Presenter 目录借类型。

### Hook 负责什么

- 读取 Hook 自己的 settings；
- 用 Session Query 补齐 provider、model、workdir 和 message preview；
- 生成、截断和脱敏 payload；
- 展开命令占位符和环境变量；
- 启动用户配置的命令、处理 timeout 和收集预览；
- App 退出时停止接收新通知，并结束自己仍在管理的 child process。

`getSession` 和 `getMessage` 是必需的查询接口，不再用 optional callback 表示“可能没有 Session
能力”。没有配置 Hook 是正常配置状态，由空 Hook 列表表示，不是另一条运行路径。

实现已经放在 `src/main/hook/`。入口类叫 `HookService`，通知类型放在 `observer.ts`。
`HooksNotificationsService`、`NewSessionHooksBridge` 和旧 Presenter 目录已经删除。

## App 启动和退出顺序

### 启动

1. App 先创建 Config/Data、Session、Agent 和 Desktop；
2. 创建 Hook，并把必需 observer 注入 DeepChat 和 ACP；
3. 创建 Remote，完成所有 Session 和 Desktop ports；
4. 用 Remote delivery 和 Session ports 一次性创建 Scheduler；
5. route runtime 接收 Remote、Scheduler 和 Deeplink 的窄接口；
6. 普通后台阶段启动 Remote；
7. App ready 后启动 Scheduler；
8. MCP ready 后让 Deeplink 处理待安装链接。

### 退出和数据库维护

1. Deeplink 不再接收新链接；
2. Scheduler 先停止 claim 新 run；
3. Remote 停止接收新消息；
4. Hook 停止接收新通知并清理 child process；
5. 已进入 Session 的任务按 Session 规则取消或排空；
6. 再停止 Agent、Provider 和数据连接。

数据库维护结束后，App 按 Remote、Scheduler 的启动顺序重新启动。不存在 late setter、全局查找或
“依赖以后可能出现”的分支。

## 文件迁移顺序

每个模块实施时遵守相同顺序：

1. 先删除旧 class 名、旧 shared interface 和旧 import；
2. 旧目录立即移出 `src/main/presenter/`，测试同时移到对应模块目录；
3. 写唯一的新入口和必需 ports；
4. 修改 App 和 Routes 的直接依赖；
5. 删除 optional dependency、late setter 和旧路径 mock；
6. 增加架构检查，阻止旧目录、旧 class 名和反向依赖重新出现；
7. 只运行受影响模块、App composition、Routes 和架构检查。

不建立旧名 re-export，不建立双目录，不让新入口转发到旧 Presenter。

## 完成条件

- Remote、Scheduler、Deeplink 和 Hook 都有唯一负责模块；
- 所有入口共用已经确定的 Session Lifecycle、Turn、Assignment 和 Query；
- Remote binding、Cron run 和 Hook notification 的长期含义不变；
- Scheduler 创建时依赖完整，没有 late setter 和未初始化兜底；
- Hook observer 是必需依赖，没有 optional Hook 运行路径；
- 旧 Presenter 路径、class 名、shared interface 和测试路径全部删除；
- route 名称、typed event、保存数据、远程命令和 Cron 行为保持不变；
- App 启动、退出和数据库维护顺序明确；
- 自动检查限制 Remote/Scheduler/Deeplink/Hook 的依赖方向。
