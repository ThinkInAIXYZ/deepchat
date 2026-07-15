# main 进程架构整理：总体说明

> 状态：已确认，实施中
> 范围：DeepChat main 进程的目标架构
> 实施状态：Session 边界和 App composition 已经落地，旧 `Presenter` 类与入口已经删除
> 书写规则：说明使用直白中文；代码标识、文件路径和命令保持原文。
> 开始实施的条件：Session 方案已确认，实施边界见 [Session 实施边界](./session.md)。

## 为什么要做这件事

当前依赖图能说明 main 进程已经很复杂，但图里的节点和连线来自现有目录与
`Presenter` 结构。它适合帮助我们发现问题，不适合直接当作未来架构。

这一批文档从产品实际运行方式出发，记录已经确定的方向：程序如何启动和退出，
Session 如何存在，各类运行资源由谁负责，模块之间可以怎样依赖，以及重构时必须保持
哪些现有行为。接下来从 Session 开始逐个模块讨论，并把确定的结论写回这里。

本文描述未来要达到的架构。在具体改动完成前，[ARCHITECTURE.md](../../ARCHITECTURE.md)、
[FLOWS.md](../../FLOWS.md) 和仍在维护的模块文档继续描述当前真实实现。

## 产品运行方式

目标架构依据下面这些产品事实，而不是现有 `presenter/` 目录：

- DeepChat 是本地优先的 Agent 桌面应用，长期保存 Session，并支持 Tape、Tool、Skill、
  ACP、Remote 和项目 Workspace。
- 主界面围绕 Agent 选择、Session 切换和 Workspace 展开。
- Desktop、Remote、Scheduler、deeplink 和 subagent 都可以发起任务。
- Remote 连接到可长期保存的 Session；renderer 关闭后，Remote 仍可能继续工作。
- 每次 Cron 执行都会创建新的 detached Session，并使用与交互式任务相同的 Agent 选择方式。
- `DeepChat` 和 `ACP` 是两套独立的运行方式，通过明确的 Agent 类型选择。
- Provider、Tool、Skill、Memory、Knowledge 和 Workspace 为 Agent 执行提供能力，但不负责
  Session 的生命周期。

参考资料：

- [README](../../../README.md)
- [主要流程](../../FLOWS.md)
- [当前架构](../../ARCHITECTURE.md)
- [Agent 系统](../agent-system.md)
- [Session 管理](../session-management.md)
- [Cron Agent Jobs](../../features/cron-agent-jobs/spec.md)
- [Plugins Hub](../../features/plugins-hub/spec.md)
- [启动 smoke test](../../../test/e2e/specs/01-launch.smoke.spec.ts)
- [设置页导航 smoke test](../../../test/e2e/specs/04-settings-navigation.smoke.spec.ts)

## 当前问题

main 进程目前主要按 `Presenter` 这类技术结构组织，没有按产品状态和资源的实际生命周期
组织。这带来以下问题：

1. 全局单例 `Presenter` 同时创建、暴露、启动和销毁许多互不相关的模块。它既负责启动，
   又让所有模块可以互相查找。
2. 窗口等短期资源、可长期保存的 Session、每个 Session 的 Agent 实例、每次请求的状态，
   以及进程级后台任务，都能通过同一个全局对象互相访问。
3. `ConfigPresenter`、`SQLitePresenter` 和 route 运行代码又形成了几个总入口。只删除
   `Presenter`，复杂依赖会转移到这些地方。
4. 窗口与 Session 的绑定现在和 Session 持久化混在一起，但窗口消失后 Session 仍应有效。
5. 启动和退出依赖通用阶段、数字优先级、全局 hook 和重复的清理路径，没有清楚表达谁创建、
   谁停止每项资源。
6. Desktop、Remote 和 Scheduler 在代码中地位不同，但它们本质上都是使用 Session 的入口。
7. 一些 coordinator 和 port 只是模块内部拆分出来的文件，却被当成了独立架构层，增加了
   理解和调用成本。

核心问题不是某个文件太大，而是代码没有清楚回答：一份可变状态由谁负责、何时结束、
哪些依赖方向是允许的。

## 目标

1. 把 DeepChat main 进程看成一个本地优先、支持多个任务入口的 Agent 运行系统。
2. 让 Desktop、Remote、Scheduler、deeplink 和 subagent 都通过同一套 Session 规则工作。
3. 由一个明确的 Agent 运行模块选择并管理 `DeepChat` 或 `ACP` 实例。
4. 每份可变状态和每项外部资源只能有一个负责模块。
5. 生命周期更长的模块负责创建并停止自己拥有的短期资源。
6. Provider、Tool、Skill、Plugin、Memory、Knowledge 和 Workspace 各自负责自己的状态，
   不再套一个新的总管理器。
7. App 启动入口只创建、连接、启动和停止模块，不向业务代码提供全局模块查找能力。
8. 分成可单独检查的小批次迁移；需要撤销时回退整个 commit，同时保持现有数据、route/event 约定和用户行为。

## 不做什么

- 不改变用户功能、数据含义和对外约定；实施按本文档分批修改生产代码。
- 不计划改变用户功能、route 名称、IPC 数据、存储结构、Remote 命令、Cron 行为或 Agent
  执行结果。
- 不因为整理目录而重写 `DeepChat` loop、ACP 协议、Tape 算法、Provider 适配、Memory 算法
  或 Tool 实现。
- 不先做全仓库文件搬迁或批量改名。
- 不引入 DI container、service container、command bus、coordinator registry、plugin framework、
  repository 层级，也不为每个 class 创建 interface。
- 不把 `Presenter` 换成另一个导出全部模块的总入口。
- 不以文件行数为目标。判断标准是职责是否集中、状态由谁负责、依赖方向是否清楚。
- 不增加通用的 `ResourceManager`、`CapabilityHost` 一类总管理器。
- 不把 `EventBus` 当作发送业务命令或查找依赖的工具。
- 未经明确同意，不同步 GitHub issue。

## 防止方案漂移的规则

1. 本目录是这次重构的目标架构记录。
2. 每个改动真正落地前，现有架构文档仍应如实描述当前代码。
3. 以前的 SDD 继续约束它们已经实现的行为，但不自动决定最终目录和模块形状。
4. 确定的结论必须先写入下方决策表，再开始实现。
5. 新增跨模块依赖前，必须在目标依赖图和职责表中说明。
6. 讨论一个模块时，先确定它负责的状态、生命周期、允许的依赖、必须保持的行为和删除规则，
   再讨论文件与 interface。
7. 相关待确认项未解决时，不实施对应部分。
8. 如果实际代码与目标冲突，先记录冲突并作出明确决定，不能在实现时悄悄放宽目标。
9. 能删除旧边界时，不在外面继续包一层。
10. 只有某个模块可以独立实施和检查时，才为它另建 SDD；不按 class 建目录。

## 已确定的结论

| ID | 结论 | 状态 |
| --- | --- | --- |
| D-001 | DeepChat main 是本地优先、支持多个任务入口的 Agent 运行系统，不是只为窗口服务的聊天后端。 | 已确定 |
| D-002 | Desktop、Remote、Scheduler、deeplink 和 subagent 是使用 Session 的同级入口。 | 已确定 |
| D-003 | 可长期保存的 Session 比窗口、renderer、已载入的 Agent 实例和单次应用运行活得更久。 | 已确定 |
| D-004 | 窗口与 Session 的绑定归 Desktop 管理，不属于 Session 的持久化数据。 | 已确定 |
| D-005 | `DeepChat` 和 `ACP` 保持为两套独立运行方式，由 Agent 类型明确选择。 | 已确定 |
| D-006 | 每个 Session 的执行状态由对应 Agent 实例负责；每一轮请求的状态由该次 Run 负责。 | 已确定 |
| D-007 | Provider、Tool、Skill、Plugin、Memory、Knowledge 和 Workspace 各自负责自己的状态，并通过明确接口配合。 | 已确定 |
| D-008 | App 启动入口只负责创建模块和控制生命周期，不能提供全局模块列表。 | 已确定 |
| D-009 | 启动和退出使用固定、明确的步骤，不再使用按优先级运行的通用 hook 系统。 | 已确定 |
| D-010 | route 只负责通信，event 只负责通知；两者都不负责业务行为。 | 已确定 |
| D-011 | 各模块负责自己的配置和数据访问；通用 Config 和 SQLite 不能继续作为业务总入口。 | 已确定 |
| D-012 | 按完整调用链小步迁移，先用测试固定现有行为；不先做一次性重写或大规模搬迁。 | 已确定 |
| D-013 | 模块内部可以按 Lifecycle、Turn、Assignment 和 Query 拆文件，但这些文件不自动成为公开模块。 | 已确定 |
| D-014 | 不得新增一个总入口来重新导出 Session、Agent、资源或平台的全部能力。 | 已确定 |
| D-015 | 所有调用方完成迁移，调用顺序和等待关系不变，行为没有新增含义，相关验证通过，并且旧入口没有调用方后，直接删除 `Presenter`；不保留长期兼容外壳。 | 已确定 |
| D-016 | database import/reset/sync 所需的进程维护状态由 App 负责；具体数据操作仍由 Sync 或对应数据模块负责。 | 已确定 |
| D-017 | main 进程内部的 `EventBus` event 只表示已经发生的事实。要求某个模块执行操作、等待结果或保证先后顺序时，使用直接调用或明确的 ready 状态；无调用方和重复的 event 删除。 | 已确定 |
| D-018 | 某项职责迁移完成后，在同一批改动中立即移动对应文件；不把全部文件移动留到最后统一处理。 | 已确定 |
| D-019 | Session 的长期身份和字段由 Session 负责；renderer、Remote 和 Scheduler binding 分别由对应入口负责。 | 已确定 |
| D-020 | transcript、Tape、pending input、search 和 trace 是与 Session 同寿命的独立数据；Agent runtime 通过窄接口读写，不拥有它们的删除规则。 | 已确定 |
| D-021 | Agent 默认 settings 只在 create、draft 或明确 reset 时读取；最终的 per-session settings 随 Session 保存。 | 已确定 |
| D-022 | 最后一个 tab/window 关闭时只删除 Desktop binding，不默认 cancel Turn、清 permission、evict runtime 或 delete Session。 | 已确定 |
| D-023 | 只有执行、完整 restore 和 backend 设置操作可以 hydrate Agent instance；普通 Session、历史和 binding 查询不能 hydrate。 | 已确定 |
| D-024 | Session status 不持久化；已载入时由 Agent instance 提供，未载入时为 `idle`，Agent 不可用时执行操作明确失败。 | 已确定 |
| D-025 | regular、detached、Remote-bound 和 forked 共用 `regular` 生命周期；只有 subagent 使用独立 `sessionKind`。 | 已确定 |
| D-026 | 删除旧 `SessionPresenter`、window/status cache 和 aggregate facade；Session 内部按 Lifecycle、Turn、Assignment、Query 分文件，但调用方只依赖所需操作。 | 已确定 |
| D-027 | 每批实施先删除旧代码和旧引用，再写唯一的新实现；不保留运行时 fallback、兼容层或新旧双轨。 | 已确定 |

## 删除 `Presenter` 的条件

“功能正常”必须落成可以检查的条件。以下条件要同时满足：

1. 旧 `Presenter` 上的每个调用方都已经改用新的负责模块。
2. startup、正常操作和 shutdown 的调用顺序保持正确；原来需要 `await` 的步骤不能变成
   不等待完成的调用。
3. 输入、输出、错误、持久化数据、外部副作用和 event 的含义没有改变，除非文档明确记录了
   新决定。
4. 与迁移范围有关的现状行为测试、unit test、integration test、E2E 和手动 smoke test 通过。
5. 搜索不到旧入口的 import、全局读取和运行时调用，并有自动依赖检查阻止重新引入。
6. 满足以上条件的同一批改动直接删除旧入口，不再增加临时兼容外壳。

这里不设置文件行数或模块数量目标。

## App 负责的维护状态

database import/reset/sync 会影响整个进程中的数据库连接、正在运行的 Session 和后台任务，
所以由 App 负责决定何时停止接收新任务、何时允许数据操作开始，以及何时恢复运行。

App 只负责总体状态和先后顺序。Sync 或对应数据模块仍负责真正的 import/reset/sync 逻辑，
各模块仍负责关闭和重新打开自己的资源，避免 App 变成新的业务总入口。详细步骤在 App 阶段确定。

## 当前 `EventBus` 分析

### 先说明实际情况

当前 [eventbus.ts](../../../src/main/eventbus.ts) 只是进程内的 `EventEmitter`，除
`sendToMain()` 外没有其他发送能力。发给 renderer 的有类型 event 已经通过
`publishDeepchatEvent()` 和 `WindowPresenter` 发送。因此，这里只讨论 main 进程内部的
`EventBus`，不把它当作 renderer 通信层。

[event-system.md](../event-system.md) 中关于 `EventBus.sendToRenderer()` 等方法的描述已经与
当前代码不一致。后续更新当前架构文档时需要一并修正，不能以该段旧描述决定目标架构。

### 判断规则

一个调用只有同时满足下面条件，才算真正的通知：

1. event 发出前，状态已经改变；
2. 发送方不等待返回值，也不靠接收方完成当前操作；
3. 没有接收方时，不会让发送方的操作只完成一半；
4. 多个接收方只处理各自状态，不负责接力完成同一业务流程。

不满足这些条件时，按下面方式处理：

- 要求某个模块做事：改成直接调用，并明确处理错误。
- 要求等待某个模块 ready：使用可查询的 ready 状态或可等待的 Promise。
- 只在同一个目标模块内部使用：改成普通函数调用，不经过全局 `EventBus`。
- 没有发送方、没有接收方或与 typed event 重复：删除。

### 已能确定的分类

| 类型 | 当前 event | 目标处理 |
| --- | --- | --- |
| MCP 状态变化 | server、config、status 和 client list 变化 | 当前有多个接收方，继续检查是否能由 MCP 直接通知明确模块。 |
| Provider DB 状态变化 | Provider DB 载入或更新 | 当前用于刷新 Config 模型能力索引和 LLMProvider 的后台模型。 |

`FIRST_CONTENT_LOADED` 已删除。第一个 tab 加载完成后，Tab 直接调用 App 传入的操作，由
Deeplink 只处理一次启动链接。`MCP_EVENTS.INITIALIZED` 和 startup proxy ready event 也已删除，
都由 App 按固定顺序直接调用后续操作。

`RENDERER_TAB_ACTIVATED` 没有接收方，也没有产生任何结果。对应的 main event、route、renderer
调用和空处理方法一起删除，不保留无作用的 IPC 调用。

`RENDERER_TAB_READY` 也没有接收方，没有控制任何准备顺序。对应的 main event、route、renderer
调用和 FloatingChat 中的延时发送一起删除。FloatingChat 的显示不再附带无作用的延时任务。

没有 main 接收方的 window focus、blur、restore 和 fullscreen event，以及没有接收方的 tab close
event 已删除。发给 renderer 的 typed window state 通知继续保留。

OAuth 保存 provider 后发送的 `providerUpdated` 没有接收方，已经删除。配置保存本身会继续走
Config 原有的 provider 更新流程。

`ZOOM_IN/OUT/RESUME` 没有调用方，只剩旧 channel 到 typed event 的转换分支，已经连同常量删除。

window resize、maximize、unmaximize 和 close 只由 Tab 使用，已经改成 Window 直接调用 Tab。原来的
四个 `WINDOW_EVENTS` 常量、发送和监听全部删除，调用顺序和 maximize 后 100ms 更新保持不变。

`WINDOW_CREATED` 只用于阻止 splash 在主窗口显示后再次出现，已经改成 Window 经 App 直接调用
Splash。最后一个 `WINDOW_EVENTS` 和 Splash 的 EventBus 监听已经删除。

`SETTING_CHANGED` 在 main 中只有 Tab 使用 language 变化。Config 现在通过启动时传入的明确操作
刷新 FloatingButton 和 Tab，其他没有接收方的 setting 广播全部删除。发给 renderer 的 typed
settings 和 language 通知继续保留。

Provider 配置的 full、atomic 和 batch 变化已经改成 Config 直接调用 LLMProvider。Config 启动时
先发送当前完整 provider 快照，运行后的修改再按原来的粒度直接调用。三个 `CONFIG_EVENTS` 已删除，
发给 renderer 的 typed provider 通知继续保留。

### tab/window 关闭事件

tab 和 window 关闭后，Desktop 立即删除 renderer binding，但不清理 ACP runtime、permission、
Turn 或 Session 数据。Window 直接调用 Tab 完成 Desktop 内部清理，不再发送 close event。
正在生成、等待 Interaction 或被 Remote/Scheduler 使用的 Session 继续运行。显式 cancel、runtime
eviction、Session delete 和 App stop 分别走自己的直接调用。详细规则见
[Session 实施边界](./session.md)。

## 生命周期

DeepChat 中有两类不同的存在时间：

1. 可长期保存的身份和数据，应用退出后仍然存在；
2. 只在进程中存在的资源，可以被载入、启动、暂停、停止和销毁。

因此，Session 不是 App 进程里的一个普通子对象。App 进程读取 Session 数据，并在需要执行
任务时为它载入 Agent 实例。

| 范围 | 常见状态或资源 | 开始 | 结束 | 负责模块 |
| --- | --- | --- | --- | --- |
| 长期数据 | settings、Agent 配置、Session、transcript、Tape、Cron 记录 | 创建或迁移 | 明确删除或替换 | 对应功能模块 |
| App 进程 | 数据库连接、secret、route 注册、系统监听 | Electron main 启动 | App 退出 | App |
| 入口运行资源 | Remote channel、Scheduler utility、deeplink buffer | 启用或首次需要 | 禁用或 App 退出 | 对应入口模块 |
| Desktop 资源 | `BrowserWindow`、`WebContents`、tab、settings/floating UI | 创建窗口或 tab | close 或 destroy | Desktop |
| Agent 实例 | 已载入的 `DeepChat` 或 `ACP` Session 实例 | 首次执行需要 | 释放、关闭、删除或 App 退出 | Agent 运行模块 |
| Turn / Run | 一次请求、abort、Provider 多轮调用、正在执行的 Tool | send 或 resume | 完成、暂停、取消或报错 | Agent 实例 |
| Interaction | permission、question、draft review 后续输入 | Tool 暂停 | 响应、取消或失效 | 当前 Turn / Agent 实例 |
| 后台任务 | Memory 写入、索引、watcher lease、Tool process | 明确接收任务 | 完成、取消或负责模块停止 | 接收任务的模块 |

### 必须保持的行为

- 关闭或隐藏窗口不会删除 Session。
- 一个 renderer 不再显示某个 Session 时，默认不会取消其他入口正在进行的工作。
- 删除 Session 会删除长期数据，并停止该 Session 的所有运行资源。
- 释放 Agent 实例只清理内存和进程资源，不删除 Session。
- 取消一次 Turn 不等于删除 Session，也不等于释放 Agent 实例。
- 暂停中的 Interaction 不能比所属 Session 或 Agent 实例活得更久。
- 后台任务必须知道自己属于谁，并在负责模块停止时响应取消。
- 每个模块只能停止自己创建和负责的资源；不能同时由全局 hook 和模块自身重复清理。

## 目标依赖关系

~~~text
Desktop ---------+
Remote ----------+
Scheduler -------+--> Session --> Session data
Deeplink --------+       |
Subagent --------+       v
                    Agent 运行模块
                   /            \
          DeepChat instance    ACP instance
                   |
       +-----------+-----------+-------------------+
       v           v           v                   v
    Provider      Tool       Context          Process / Files
                            /   |   \
                         Skill Memory Knowledge / Workspace
~~~

执行结果和状态可以向外通知 Desktop、Remote、Hook 和其他后台观察者，但这些接收通知的模块
不能反过来通过通知通道控制 Agent 实例。

### 允许的依赖方向

1. Desktop、Remote、Scheduler 等入口调用 Session 提供的操作和查询。
2. Session 通过 Agent 运行模块选择 Agent 类型并发起执行。
3. Agent 实例只使用明确传入的 Provider、Tool、Context、文件和进程能力。
4. Provider、Tool 等模块使用 Platform 提供的底层能力，并访问自己负责的数据。
5. Platform 不能依赖 Session、Agent、Desktop、Remote 或其他业务模块。
6. Session 不能依赖 Electron 窗口对象，也不能依赖 Remote 或 Scheduler 的协议实现。
7. Agent 实例不能依赖 Desktop、Remote、Scheduler、route 分发或 App 启动入口。
8. 各能力模块不能通过全局 `Presenter` 回调其他模块。
9. 跨模块通知使用有类型的 event 或明确 callback；业务操作使用直接、有类型的调用。

## 各模块负责什么

下表描述职责，不提前规定最终目录数量，也不要求每行对应一个 class。

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| App | main 进程启动、创建和连接模块、固定的 start/stop 顺序、进程维护状态 | 具体 import/reset/sync 逻辑、业务 API、全局模块查找、业务状态 |
| Session | Session 的长期身份和数据、公共操作与查询、生命周期规则 | `BrowserWindow`、Remote 协议、Cron 调度、Provider process |
| Agent 运行 | Agent 类型选择、每个 Session 的运行实例、每次 Turn 的执行 | 窗口绑定、Session 保存规则、Remote channel 或 Cron job 状态 |
| Desktop | window、tab、settings/floating/tray UI、renderer 绑定和界面状态发送 | 删除 Session、管理 Agent 实例 |
| Remote | channel 运行、endpoint 绑定、协议解析和结果发送 | Session 内部实现、选择 Agent 类型 |
| Scheduler | schedule/run 状态、查找到期任务、创建 detached run、记录发送结果 | 模型或 Tool 执行、Session 内部实现 |
| Provider | 凭据和配置、model catalog、Provider instance、限流 | Agent 或 Session 生命周期 |
| Tool | 每个 Session 的 Tool 列表与执行、MCP/local Tool 调用、权限边界 | Plugin package 生命周期、Session 保存 |
| Skill | Skill 文件、发现与同步、Session 的 Skill 选择规则 | 通用 Plugin 或 Agent 生命周期 |
| Plugin | package 安装、启用、停用、登记提供的能力 | Session 或 Turn 的执行安排 |
| Memory | Agent Memory 数据、读写和维护、后台写入 | Session 或 window 生命周期 |
| Knowledge | 知识库、索引和检索 | Session 生命周期 |
| Workspace | workdir 信息、watcher lease、Workspace search 和 Git 状态 | Session 身份、通用文件操作 |
| Platform | 数据库连接、secret、文件、进程和 watcher 的底层操作 | 产品规则 |
| 通信层 | 靠近负责模块放置有类型的 route/event/preload 适配 | 业务状态和业务流程 |

不需要新增一个汇总所有能力的运行对象。

## App 启动顺序

1. 建立 single-instance 规则，注册 protocol，并暂存启动阶段收到的 deeplink。
2. 打开 settings、logging/proxy、secret、database，并执行 migration。
3. 创建 Platform、各能力模块、Agent 运行模块、Session 和各入口模块。
4. 注册有类型的 route handler 和 event publisher。
5. 创建 Desktop 主界面，完成 renderer 启动所需数据。
6. 只启动已经启用或启动时必需的后台功能。
7. 首个可用窗口出现后，再执行不影响交互的扫描、维护和预热。

只要现有行为允许，MCP server、Remote channel、Scheduler utility process、file watcher、
Provider instance 和后台 exec host 都应按需启动或由配置决定是否启动。

## App 退出顺序

1. 停止接收新的外部任务。
2. 停止 Remote 新请求和 Scheduler 新任务。
3. 取消或等待正在执行的 Turn、暂停中的 Interaction 和 Session 后续任务。
4. 阻止新的 Memory 写入等后台任务，并等待已接收任务结束。
5. 停止各模块拥有的 MCP、Plugin、ACP、exec host、watcher 和其他子进程。
6. 销毁 Desktop 资源。
7. 关闭各模块的数据存储和数据库连接。

App 只安排总体顺序。每个模块只停止自己的资源，同一清理工作不能再由全局 shutdown hook
重复执行。所有 stop 操作都必须允许重复调用。

## 首先讨论 Session

已经确定：

- Session 是可长期保存的产品身份，不是 window tab，也不是 Agent 运行对象。
- Desktop、Remote、Scheduler、deeplink 和 subagent 使用同一套 Session 规则。
- Session 数据引用一个 Agent，并可带有 Workspace 信息。
- 创建、启用、停用、接收 Turn、释放 Agent 实例、关闭和删除是不同操作，必须分别说明。
- renderer 绑定是 Desktop 的临时状态。
- Agent 类型选择归 Agent 运行模块负责。
- `DeepChat` 与 `ACP` 通过明确的 backend handle 提供能力。
- 决定 Session 的公开 API 前，必须先查清当前 Lifecycle、Turn、Assignment 和 Projection
  各自做了什么。
- 模块内部仍可拆成小文件，但调用方不能再依赖全局 `Presenter`，也不能依赖新的总入口。

### Session 已确认的实施规则

Session 的长期字段、data、settings、用词、状态变化、hydrate 条件、status 来源、入口绑定、最小
操作、cache 删除和 runtime eviction 条件已经写入 [Session 实施边界](./session.md)。Session 阶段
不再保留待确认项。

App 的固定启动、ready、失败清理、普通退出、更新退出、强制退出、数据库维护状态和
全局路径删除条件已经写入 [App 启动与退出边界](./app.md)。

Desktop 的 window、tab、renderer binding、附属界面和 YoBrowser 生命周期已经写入
[Desktop 实施边界](./desktop.md)。

Agent 信息、backend 选择、instance、Turn、Interaction 和清理规则已经写入
[Agent 运行实施边界](./agent.md)。

## 必须保持兼容的内容

- 迁移过程中，现有 SQLite 数据、SQLCipher 行为、migration marker 和用户 settings 必须可读。
- 现有 route 名称、输入输出、renderer client、有类型的 event 和 preload 安全边界保持不变；
  除非后续明确决定修改。
- 移动职责前，先用测试或记录固定 Session create/send/restore/delete、draft、transfer、
  title generation、pending input、permission、model selection 和 project/workdir 的当前行为。
- Remote binding、command、pending interaction、media delivery 和 open-on-desktop 行为保持兼容。
- Cron run claiming、detached Session 创建、完成判断、timeout/cancellation 和 delivery receipt
  保持兼容。
- `DeepChat` Tape、transcript、Memory 写入、Tool 执行和 ACP 持久化行为保持不变。
- App restart、multi-window/multi-tab、close-to-tray、floating UI、settings window 和 deeplink
  继续可用。

## 完成标准

只有同时满足以下条件，这次架构重构才算完成：

1. 每份可变状态和长期运行资源都有一个写明的负责模块和生命周期。
2. Desktop、Remote、Scheduler、deeplink 和 subagent 都通过已确认的 Session API 工作。
3. Session 长期数据不依赖 Desktop renderer 绑定，也不依赖已载入的 Agent 实例。
4. 只有 Agent 运行模块可以选择 backend 并管理每个 Session 的运行实例。
5. `DeepChat` 和 `ACP` 仍是两套独立、有类型的运行实现。
6. 不再存在全局 `Presenter`、全局模块查找入口或替代它的新总入口。
7. 启动和退出遵循已确定的固定步骤；各模块清理可重复调用。
8. 配置和数据访问归对应模块负责，不再通过通用 Config 或 SQLite 业务总入口。
9. route 分发和 event 发布不包含已经迁出的业务逻辑。
10. 每个目标边界落地后，都有自动检查限制不允许的依赖。
11. 现有数据和用户行为通过现状行为测试、unit test、integration test 和 E2E 验证。
12. 每批改动落地后，及时更新描述当前代码的架构文档。

## 已解决的整体问题

- 删除 `Presenter` 的可检查条件已经确定。
- database import/reset/sync 的进程维护状态归 App 负责。
- `EventBus` 的判断规则和当前调用分类已经完成；只剩关闭 tab/window 时怎样处理 Session
  runtime，需要在 Session 阶段决定。
- 对应职责迁移完成后，实体文件在同一批改动中立即移动。
