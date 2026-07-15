# App 启动与退出边界

> 状态：已确定，可以实施
> 书写规则：说明使用直白中文；代码标识、文件路径和命令保持原文。
> 实施规则：每批先删除旧代码和旧引用，再写唯一的新路径。

## 这一阶段解决什么

App 只负责以下事情：

1. 处理 Electron 进程开始前必须完成的设置。
2. 按固定顺序创建和连接各模块。
3. 判定何时可以创建首个窗口。
4. 按固定顺序停止接收新任务并释放资源。
5. 在数据库需要关闭、替换或重新打开时管理整个 main 进程的维护状态。

App 不提供业务 API，不保存 Session 业务状态，也不对外暴露一个可以查找所有模块的对象。

## 删除前的实现问题

当前 `src/main/appMain.ts` 创建 `LifecycleManager`，`LifecycleManager` 再按 phase 和
priority 运行 hook。`presenterInitHook` 通过 `getInstance()` 创建全局 `Presenter`，其他
hook 再从全局 `presenter` 查找需要的模块。

这条路径已经删除。这里保留问题说明，用来检查后续不能重新引入同类结构。

这会造成四个实际问题：

- 启动顺序藏在 phase、priority、导出顺序和 hook 内部。
- 多个 hook 依赖全局 `presenter`，不能从构造代码看出真实依赖。
- 同一资源既有单独的 before-quit hook，又在 `Presenter.destroy()` 中释放，会重复执行。
- update install 和 force quit 会绕过一部分或全部清理，真实行为不能从一条路径看清。

当前全局路径包括：

- `Presenter.instance`、`presenter`、`getInstance()`。
- `getMainKernelRouteRuntime()` 和缓存的 route runtime。
- lifecycle hook 中对 `presenter.*` 的查找。
- 其他模块中直接 import `presenter` 的路径。

已查到的直接调用方如下：

| 调用方 | 从全局取的东西 | 迁移方向 |
| --- | --- | --- |
| `appMain.ts` | Window、Deeplink、permission | App 保留明确依赖 |
| lifecycle hooks | Config、Database、Desktop、Cron、Memory、MCP、ACP 和后台工作 | 改为 App 固定步骤 |
| `configPresenter` | Floating、Device、Provider、Hook | 把变更后操作交给各配置的真正负责模块 |
| `deeplinkPresenter` | MCP、Window、Config | 构造时接收 Deeplink 实际需要的操作 |
| `floatingButtonPresenter` | Session query、Desktop binding、Window、Tab | 归入 Desktop 并接收窄依赖 |
| `windowPresenter` 和 `utils/index.ts` | Tab、Device、Window | 归入 Desktop 的内部直接调用 |
| Knowledge store | File、Provider | 构造时接收文件和 embedding 能力 |
| LLM runtime | Device image cache | 接收图片缓存能力 |
| MCP 和 in-memory servers | Config、Knowledge、LLM、SQLite、Session query | 按 server 和 client 的实际需要分别注入 |
| `upgradePresenter` | Desktop 退出操作 | 改为请求 App 执行更新退出 |
| GitHub Copilot device flow | Window | 接收显示验证页面所需的 Desktop 操作 |

Shortcut 和 Tray 的创建窗口、打开设置、显示或隐藏窗口、检查更新操作也已经改为直接调用
Desktop。旧 `TRAY_EVENTS` 和 Window 内用于接收 Shortcut 命令的监听已经删除。
没有发送方或接收方的 OAuth、Sync、Force Quit 和 App Blur main 事件也已经删除。

## 目标结构

`src/main/index.ts` 只调用 `startApp()`。`startApp()` 内部保留一个 App 控制对象，它对外只有
启动、普通退出、更新退出、强制退出和进入维护状态这些 App 操作。
`startApp()` 仍返回 `void`，不把业务模块或 App 控制对象返回给业务代码。

当前 `startMainProcess()` 已经只返回 `MainProcessControl`。`appMain.ts` 只能请求聚焦主窗口、处理
deeplink、清理权限、确认退出、取消退出、检查主窗口和停止 main 进程，不能再读取业务模块。

各业务模块是 App 创建过程中的局部变量。route 注册时直接捕获已创建的明确依赖。
启动、退出和维护操作也使用这些明确依赖。不导出模块汇总对象，不提供按名称查找模块的方法。

~~~text
src/main/index.ts
  -> startApp()
       -> 进程前置设置
       -> app.whenReady()
       -> 打开 Config 和 Database
       -> 创建业务模块
       -> 注册 typed routes 和必要的通知
       -> 创建 Desktop
       -> 启动已启用的外部入口
       -> 延后启动后台工作
~~~

## 固定启动顺序

### `app.whenReady()` 之前

1. 设置 `userData`、app name 和 command line switches。
2. 注册必须在 ready 前声明的 protocol scheme。
3. 获取 single-instance lock；失败时立即退出。
4. 登记 `open-url` 和 `second-instance`，启动未完成时只缓存 deeplink。
5. 登记未处理异常和 rejection 记录。

### `app.whenReady()` 之后的关键步骤

1. 创建 splash window。
2. 创建 `ConfigPresenter`，应用 logging 和 proxy 设置。
3. 解锁、打开并 migration SQLite。
4. 注册 `deepcdn`、`imgcache` 和 workspace preview 的 protocol handler。
5. 按已确定的依赖顺序创建 Platform、各能力模块、Agent 运行、Session、Desktop 和外部入口。
6. 注册 typed routes、typed events 和 Electron window listeners。
7. 执行 ACP registry migration。这是创建首个窗口前必须完成的数据更新。
8. 创建首个主窗口，注册 shortcut，创建 tray，处理缓存的 deeplink。
9. 窗口可用后关闭 splash window。到这里启动才算成功。

任一关键步骤失败时，App 按已经创建的相反顺序停止资源，关闭 splash window，显示错误后退出。
不继续运行一个只创建了部分模块的 App。

### 窗口可用后的工作

以下工作由 `StartupWorkloadCoordinator` 调度，不阻塞首个窗口：

- legacy import。
- RTK health check。
- usage stats backfill。
- SQLite mainline normalization。
- disabled search tool cleanup。
- YoBrowser 和 Skill 扫描。
- Provider warmup。
- Memory background maintenance。

Cron、Remote、MCP 等对外入口只在配置启用后启动。它们不依赖某个无关 hook
的 priority 来判断 App 是否 ready。

## ready 条件

同时满足以下条件后，App 才进入 `running`：

- Config 可读。
- SQLite 已打开且 migration 完成。
- 所有 typed routes 只指向已完成创建的模块。
- Desktop 的 window、tab 和 Session binding 已建立。
- 首个主窗口已创建。

后台扫描、维护、预热和未启用的外部入口不属于 ready 条件。

## 固定退出顺序

### 普通退出

1. 把 App 标记为 `quit-requested`，合并重复的退出请求。
2. 调用 Knowledge 的退出确认。用户取消时恢复 `running`，此时还没有停止任何模块。
3. 确认退出后改为 `stopping`，Desktop 不再接收新的用户操作。
4. Remote 停止接收新请求，Scheduler 停止发起新任务。
5. Session 停止新 Turn，取消或结束已在运行的 Turn 和 Interaction。
6. Memory 阻止新写入，等待已接收的写入结束。
7. 按 Remote、Scheduler、Plugin、MCP、ACP、Provider、exec host、watcher 的所有者关系停止进程和连接。
8. 销毁 floating、tray、tab、window 和 shortcut。
9. 停止 Sync timer、Startup workload 和其他后台 timer。
10. 关闭各模块的数据存储，最后关闭 SQLite。
11. 标记为 `stopped`，让 Electron 完成退出。

每一个 stop 可以重复调用，但只能有一个所有者真正释放资源。App 负责排顺序，不再
额外写一份与模块 `stop()` 重复的清理。

### 更新退出

更新安装不显示 Knowledge 退出确认，其他步骤与普通退出一致。完成清理后才交给
updater 安装，不再因为 `isUpdating` 直接绕过所有 stop。

### 强制退出

强制退出只用于用户已明确选择强制结束或普通退出无法完成。它设置 Desktop 的退出
标记、停止接收新请求，然后直接退出；不等待异步清理，也不把它伪装成普通退出。

## 数据库维护状态

会关闭、替换或重新打开主 SQLite 的操作必须由 App 包在一次维护过程中。当前包括：

- database encryption enable、change password 和 disable。
- sync import 和 cloud pull 中的 import。
- 以后新增的 database reset 或整库替换。

只读的 backup、list backup、cloud upload 和连接测试不进入维护状态。

一次维护的固定顺序是：

1. 从 `running` 进入 `maintenance`；同时只能有一次维护。
2. route 拒绝新的 Session Turn、Remote 请求和 Scheduler run，但仍允许读取维护进度。
3. 停止 Cron、Remote、Memory 后台写入、Sync timer 和 startup maintenance。
4. 结束当前 Session runtime，清空依赖旧 SQLite handle 的内存状态。
5. 调用 Database Security 或 Sync 负责的具体数据操作。
6. 数据操作成功或完成自己的数据回滚后，重新连接需要 SQLite 的模块。
7. 恢复 Desktop 读取、后台工作和已启用的外部入口，回到 `running`。

这里的数据回滚是为了防止损坏用户数据，不是新旧架构 fallback。数据操作失败后如果无法
恢复主 SQLite，App 进入 `failed`并要求退出，不继续运行。

## 每类资源的唯一停止方

| 资源 | 停止方 |
| --- | --- |
| Session runtime 和 Turn | Session / Agent 运行模块 |
| Remote channel 和 endpoint | Remote |
| Scheduler utility process | Scheduler |
| MCP server | MCP |
| Plugin 运行资源 | Plugin |
| ACP process、PTY 和 session | ACP runtime |
| Provider instance | Provider |
| exec host | 创建它的 Tool 或 Workspace 模块 |
| file watcher | Workspace |
| Memory 后台写入和 timer | Memory |
| Cron、Sync 和 startup timer | 各自模块 |
| window、tab、floating、tray、shortcut | Desktop |
| SQLite connection | Platform database |

## 实施批次

### A1：删除 Session 对全局 `Presenter` 的依赖

- 先删除 `Presenter` 上的 Session 公开属性和对应全局读取。
- 再让 route、Desktop、Remote、Scheduler 和 Tool 直接接收需要的 Session 操作或查询。
- 不新增 Session 总入口、getter、setter 或可选依赖。

已完成：floating button 直接接收 `SessionQuery`、`DesktopSessionBinding`、
`WindowPresenter` 和 `TabPresenter`，不再 import 全局 `presenter`。

已完成：MCP `ToolManager` 使用 Tool 调用已携带的 `agentId` 和 `providerId`
检查 ACP MCP 权限，不再通过全局 `presenter.sessionQuery` 反向查 Session。

已完成：`McpPresenter` 构造时必须直接接收 `IConfigPresenter`，不再从
全局 `presenter` 补取 Config，也不再在 `initialize()` 中重建 manager 托底。

已完成：conversation search MCP server 由创建它的工厂传入 SQLite、Session 记录、
transcript 和 settings。它的历史读取不再从全局 `presenter` 取 SQLite 或通过
`SessionQuery` 载入 Agent runtime。

已完成：Knowledge 构造时直接接收 File、embedding 和 Dialog。文件解析、向量生成和退出确认
不再从全局 `presenter` 查找模块。

已完成：MCP 的 auto prompting、builtin knowledge 和 deep research server 由 in-memory server factory
传入 Config 与 Knowledge，不再从全局 `presenter` 查找模块，也不再用方法存在检查读取语言。

已完成：`McpClient` 由 `ServerManager` 明确传入 sampling、completion 和 model catalog。
sampling 同意、取消、生成内容和模型显示名不再从全局 `presenter` 查找。

已完成：Notification、Tray 和 OAuth 构造时直接接收各自需要的 Config 操作。
Tray 不再用方法存在检查读取语言，`setupTray()` 也不再临时补建实例。

已完成：Shortcut 构造时直接接收 Window。应用菜单的目标窗口选择、发送和关闭操作
不再从全局 `presenter` 查找 Window。

已完成：GitHub Copilot device flow 的复制操作直接使用 Electron clipboard，
不再为了复制验证码反向查找全局 Window 和 renderer API。

已完成：Upgrade 通过构造参数直接请求 App 执行更新退出。App 先按固定顺序停止 main 进程，
再调用 updater 安装；删除全局 `Presenter` 查找、更新状态事件、退出状态事件和重复的浮动窗口清理。

已完成：Window 构造时接收重启操作，并在 Tab 创建后完成一次明确绑定。Window 和
FloatingChatWindow 不再从全局 `Presenter` 查找 Device、Tab 或 Window。

已完成：Deeplink 在 MCP 创建后接收 Window、Config 和 MCP。链接处理不再从全局
`Presenter` 判断 MCP 状态、选择窗口或读取 Provider 配置。

已完成：Builtin Knowledge 的平台支持判断提取为纯函数，由 Knowledge 和 MCP 配置共同使用。
MCP 配置不再为了平台判断查找全局 Knowledge。

已完成：图片缓存从 Device 移到 `platform/imageCache.ts`。Device 保留原接口并直接调用该函数，
AI SDK runtime 也直接使用平台能力，不再查找全局 Device。

已完成：Config 构造阶段不再启动 theme 和 ACP registry。Presenter 完成模块创建后一次性启动
Config runtime，并传入 floating UI、App restart、ACP refresh 和 hook test 操作；Config 不再查找全局模块。

已完成：main process 直接创建唯一的 `Presenter` composition root，删除 `presenter` 全局变量和
`getInstance()`。生产代码已没有通过 `@/presenter` 反向查找模块的路径。
架构检查会拒绝 main 模块重新导入或导出这两个全局入口。

已完成：content protection 设置保存后直接调用 Window 应用到现有窗口并请求重启，删除
`CONFIG_EVENTS.CONTENT_PROTECTION_CHANGED` 的隐藏命令路径。

已完成：floating button enabled 已经由 Config runtime 直接调用 Desktop，删除重复执行的
main event；language、theme 和 system theme 只发布 typed renderer event，删除没有接收方的 main event。

已完成：proxy mode 和 custom URL 保存后直接调用 ProxyConfig；系统代理解析完成后直接通知
Provider instance。删除三个 proxy EventBus 命令，同时保持原来的异步顺序。

已完成：删除 Config 中没有任何 main 接收方的 settings、model、Agent、prompt 和 sync 原始事件。
已有 typed renderer event 保留；没有 typed event 的旧发送本来没有接收方，因此直接删除。

### A2：删除全局 route runtime

- 先删除 `getMainKernelRouteRuntime()`、route runtime cache 和文件加载时的全局注册。
- 再由 App 在模块创建完成后注册 routes，每个 handler 使用明确依赖。

已完成：`getMainKernelRouteRuntime()`、route runtime cache 和 `Presenter` 文件加载时的 IPC 注册已经删除。
App 在模块创建完成后只创建一次 route runtime 并注册 handler；handler 捕获该次启动的明确依赖。

### A3：删除通用 lifecycle hook

- 先删除 hook registry、phase、priority 和对全局 `presenter` 的读取。
- 再把必须保留的实现放到 App 的固定 `start()`、`stop()` 和后台任务调度中。
- protocol 处理、数据库打开和 splash 可以保留为小文件，但不再包成通用 hook。

已完成：`Presenter` 构造不再接收 `ILifecycleManager`，也不再从 `LifecycleContext`
补取 Config、SQLite、Database Security 和 startup workload。这些启动依赖现在必须由创建方明确传入。

已完成：`LifecycleManager`、hook registry、phase、priority、lifecycle event 和全部通用 hook
已经删除。`src/main/app/mainProcess.ts` 现在按固定顺序完成 Config、SQLite、protocol、模块创建、
ACP migration、首个窗口、tray、Cron、Memory 和后台工作；普通退出、更新退出和强制退出也有明确路径。
database initializer、protocol 和 splash 同时移到 `src/main/app/`。

### A4：删除 `Presenter`

- 先删除 `Presenter` class、singleton、`getInstance()` 和 `presenter` export。
- 再由 App 组合代码直接创建已经分开的模块。
- 不把 `Presenter` 改名成 `AppServices`、`Container`、`Kernel` 或其他新的全局汇总对象。

### A5：接入维护状态

- database security 和 sync import route 通过 App 的明确维护操作执行。
- 数据操作本身仍属于 Database Security 或 Sync。
- 验证成功、数据操作失败以及 SQLite 无法恢复三条路径。

## 删除条件

### 删除 `LifecycleManager`

状态：已完成。

同时满足以下条件后直接删除：

- 所有启动 hook 已进入固定启动步骤或明确的后台任务。
- 所有 before-quit hook 已进入固定退出顺序。
- update install、force quit 和取消退出有单独明确的路径。
- 无代码再使用 `LifecyclePhase`、`LifecycleHook` 或 `ILifecycleManager`。

### 删除全局 `Presenter`

同时满足以下条件后直接删除：

- 所有 route、event listener、Desktop、Remote、Scheduler、MCP、Tool 和后台任务都已接收明确依赖。
- 无生产代码 import `presenter`、`getInstance()` 或全局 route runtime。
- 启动、Session 操作、数据库维护、普通退出和更新退出的调用顺序与文档一致。
- 影响范围内的功能正常，没有改变旧逻辑的含义。

## 自动检查

架构检查最终要拒绝：

- `src/main/presenter/index.ts` 和 `Presenter` class。
- 从业务模块 import 全局 `presenter`。
- `getInstance()`、`getMainKernelRouteRuntime()` 和缓存 route runtime。
- lifecycle hook phase、priority 和通用 hook registry。
- 为解决创建顺序而增加的 optional dependency、setter injection 或方法存在检查。
- database import 和 encryption migration 直接关闭 SQLite，却没有经过 App 维护状态。
