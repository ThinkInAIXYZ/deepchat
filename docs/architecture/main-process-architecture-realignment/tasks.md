# main 进程架构整理：任务清单

> 状态：实施中
> 当前阶段：App 启动与退出设计
> 书写规则：说明使用直白中文；代码标识、文件路径和命令保持原文。
> 规则：每批先删除旧路径，再补齐唯一的新路径；不保留双轨和 fallback。
> 撤销一批改动时回退整个 commit，不写兼容层、可选注入或新旧分支。

## T0：确定总方向

- [x] 阅读产品文档、当前架构、主要流程和仍在维护的功能约定。
- [x] 通过本地 smoke test 查看实际 main 界面和 settings 界面。
- [x] 跟踪当前进程的启动、退出和后台 utility 生命周期。
- [x] 跟踪 Desktop、Session、Agent instance、Turn、Interaction、Remote 和 Cron 生命周期。
- [x] 记录本地优先、支持多个任务入口的产品运行方式。
- [x] 区分长期数据和只在进程中存在的资源。
- [x] 记录目标依赖方向和各模块职责。
- [x] 记录固定的启动和退出方向。
- [x] 记录防止方案漂移的规则、限制和不做的事项。
- [x] 检查并明确通过总体架构方向。

## T1：Session 设计

### 查清当前行为

- [x] 列出所有 Session route、service、coordinator、store、backend 和直接调用方。
- [x] 区分当前正式路径和只为 legacy/compatibility 保留的路径。
- [x] 画出 Desktop 的 create/restore/activate/deactivate/close/delete 流程。
- [x] 画出 Remote 的 create/bind/switch/open/stop/respond 流程。
- [x] 画出 Cron detached Session 的接收、完成、timeout、cancellation 和 delivery 流程。
- [x] 画出 subagent 的 create/merge/discard/delete 流程。
- [x] 画出 restart recovery、startup bootstrap、import/reset/sync 和运行资源清理流程。

### 确定每份状态由谁负责

- [x] 列出 Session 必须长期保存的字段。
- [x] 列出 transcript、Tape、search/trace、pending input、permission、Skill 和 settings 状态。
- [x] 列出 renderer binding 和发给界面的 cache。
- [x] 列出 `DeepChat` 和 `ACP` 运行状态。
- [x] 把每份状态分为长期保存、内存、计算结果或外部资源。
- [x] 为每份状态指定唯一负责模块和生命周期。

### 明确生命周期

- [x] 定义 Session 用词，删除不表示不同状态的同义词。
- [x] 定义 create 和 draft promotion。
- [x] 定义 activate/deactivate 与 renderer bind/unbind。
- [x] 定义 runtime hydrate/close/evict。
- [x] 定义 send/generate/pause/resume/cancel。
- [x] 定义 archive/delete 和 child Session delete。
- [x] 定义 App restart 后怎样恢复。
- [x] 定义 Agent 不可用和 runtime failure 时怎样处理。

### 确定 Session 对外 API

- [x] 决定 transcript 和 Tape 由谁负责。
- [x] 区分 Session settings 与 Agent defaults。
- [x] 决定 Session status 的唯一可信来源。
- [x] 决定哪些查询允许载入 Agent 实例。
- [x] 定义各入口共同需要的最小 Session 操作和查询 API。
- [x] 定义 Session 与 Agent 运行模块的调用和失败清理。
- [x] 定义长期 Session 之外的 Desktop binding。
- [x] 定义 regular、detached、Remote-bound、forked 和 subagent Session 如何共用同一生命周期。
- [x] 决定当前 coordinator 中哪些状态和文件保留，哪些边界删除。
- [x] 把所有确认的 Session 结论写入 `spec.md`。
- [x] 解决全部 Session 待确认项。

### 兼容和迁移

- [x] 完成 Session 现有行为对照表。
- [x] 找出缺少的现状行为测试。
- [x] 设计可单独检查的迁移批次和各自的回退办法。
- [x] 写明不保留临时兼容代码，并定义旧路径删除条件。
- [x] 定义目标边界需要的自动依赖检查。
- [x] 检查并明确通过 Session 设计。

## T2：App 启动与退出设计

- [x] 列出当前 App 启动入口创建的对象和所有全局访问路径。
- [x] 定义 App 启动完成后最少需要返回什么。
- [x] 定义固定启动步骤、ready 条件、失败清理和后台任务延后方式。
- [x] 定义停止接收新任务、shutdown、update install 和 force quit 行为。
- [x] 定义 App 在 database import/reset/sync 期间怎样进入和退出维护状态。
- [x] 为每个子进程和长期运行资源指定唯一停止方。
- [x] 写明删除通用 lifecycle hook 的条件。
- [x] 写明删除全局 `Presenter` 和全局模块查找入口的条件。
- [x] 解决 App 生命周期的全部问题并通过这一阶段。

## T3：Desktop 设计

- [ ] 定义 window、tab、`WebContents`、settings、floating UI、tray 和 overlay 由谁负责。
- [ ] 定义 renderer 与 Session 的绑定和清理。
- [ ] 定义 close、hide、detach、deactivate、destroy 和 quit。
- [ ] 保持 multi-window/multi-tab、close-to-tray、focus、shortcut 和 deeplink 行为。
- [ ] 定义怎样向界面发送状态，同时不让 Session 或 Agent 依赖 Desktop。
- [ ] 解决 Desktop 的全部问题并通过这一阶段。

## T4：Agent 运行设计

- [ ] 确认 Agent 信息和 backend 选择由谁负责。
- [ ] 确认 `DeepChat` 和 `ACP` instance 的生命周期。
- [ ] 定义每个 Session 只载入一个 instance 的规则，以及何时 evict。
- [ ] 确认每个 Turn 的 Run 和 Interaction 由谁负责。
- [ ] 定义两类 backend 的 close/cleanup/delete/shutdown 行为。
- [ ] 计划删除对 `Presenter` 适配的依赖，不重写执行算法。
- [ ] 解决 Agent 运行的全部问题并通过这一阶段。

## T5：Agent 执行所需能力

- [ ] 设计 Provider/model 的职责和 runtime 生命周期。
- [ ] 设计 Tool catalog/execution/permission 的职责。
- [ ] 设计 MCP server 生命周期和 Tool 配合方式。
- [ ] 设计 Skill 文件、同步和 Session 选择规则。
- [ ] 设计 Plugin package 生命周期和能力登记。
- [ ] 设计 Memory 存储、runtime 和后台写入。
- [ ] 设计 Knowledge 索引和检索。
- [ ] 设计 Workspace、file 和 watcher。
- [ ] 确认没有新增汇总所有能力的总管理器。

## T6：外部入口和结果接收方

- [ ] 设计 Remote channel 以及 endpoint binding 的职责。
- [ ] 设计 Scheduler 查找到期任务和创建 detached run 的职责。
- [ ] 设计 deeplink 怎样发起操作。
- [ ] 设计 Hook 通知和其他结果接收方式。
- [x] 按当前发送方和接收方，把 `EventBus` 路径分成通知、隐藏操作、ready 信号和无效调用。
- [ ] 决定关闭最后一个 tab/window 时，正在运行或暂停的 Session 应怎样处理。
- [ ] 让所有入口使用已确认的 Session API。

## T7：Platform、Config、数据存储和通信

- [ ] 定义底层 settings 和 secret 能力。
- [ ] 把具体配置从通用 Config API 移给对应模块。
- [ ] 定义 database connection/transaction/migration 由谁负责。
- [ ] 定义各模块的数据访问，不增加通用 repository 层级。
- [ ] 让 route handler 按负责模块注册，同时保持有类型的通信约定。
- [ ] 定义 event 发布，并删除隐藏的业务命令路径。
- [ ] 每批职责和依赖迁移完成后，在同一批改动中移动对应实体文件。

## T8：分批实施

- [x] 删除旧 `SessionPresenter`、旧 thread 广播和 tab/window close compatibility；legacy export
  只保留 exporter 内的只读转换。
- [x] 删除 `AppSessionService` 的 window binding，把 renderer binding 移给 Desktop。
- [x] 删除 Session Projection 的 status cache。
- [x] 把 `sessionApplication` 移到最终 Session 目录并删除 presenter 命名。
- [x] 删除 `AgentRuntimePresenter` 的 shared data compatibility。
- [x] 删除 floating button 对全局 `Presenter` 的 Session 和 Desktop 查找。
- [x] 删除 MCP `ToolManager` 对全局 Session 查询的托底，直接使用 Tool 调用上下文。
- [x] 删除 `McpPresenter` 从全局 `Presenter` 补取 Config 的构造托底。
- [x] 让 conversation search MCP server 直接读取 Session 持久数据，删除全局 Session/SQLite 查找。
- [x] 删除 `Presenter` 构造时对 `ILifecycleManager` 和 `LifecycleContext` 的读取，启动依赖全部明确传入。
- [x] 删除 `LifecycleManager`、phase、priority、全部通用 hook 和 lifecycle event，改为 App 固定启动与退出顺序。
- [x] 把 database initializer、protocol 注册和 splash 移到 `src/main/app/`，不再保留 lifecycle 目录。
- [x] 删除全局 route runtime、cache 和文件加载时注册，改为 App 创建模块后注册并捕获明确依赖。
- [x] 让 Knowledge 直接接收 File、embedding 和 Dialog，删除 Knowledge 对全局 `Presenter` 的查找。
- [x] 让 MCP 内置 prompt、knowledge 和 deep research server 直接接收 Config 与 Knowledge。
- [x] 让 `McpClient` 直接接收 sampling、completion 和 model catalog，删除对全局 `Presenter` 的读取。
- [x] 让 Notification、Tray 和 OAuth 直接接收 Config，删除全局 Config 查找和 tray 构造托底。
- [x] 让 Shortcut 直接接收 Window，删除快捷键和应用菜单对全局 `Presenter` 的查找。
- [x] GitHub Copilot device flow 直接使用 Electron clipboard，删除复制操作对全局 Window 的查找。
- [x] 让 Upgrade 直接请求 App 执行更新退出，删除更新状态事件和重复的 Desktop 清理。
- [x] 让 Window 明确接收重启操作并绑定 Tab，删除 Window 和 FloatingChatWindow 的全局查找。
- [x] 让 Deeplink 直接接收 Window、Config 和 MCP，删除链接处理中的全局查找。
- [x] 共用 Builtin Knowledge 平台支持判断，删除 MCP 配置对全局 Knowledge 的查找。
- [x] 把图片缓存移入 Platform，删除 AI SDK runtime 对全局 Device 的查找。
- [x] 延后启动 Config runtime 并明确传入设置后的操作，删除 Config 对全局模块的查找。
- [x] 删除全局 `presenter` 和 `getInstance()`，由 App 直接创建唯一 composition root。
- [x] 增加架构检查，禁止 main 模块重新导入或导出全局 `presenter` / `getInstance()`。
- [x] 把 content protection 改成 Config 直接调用 Window，删除对应 EventBus 命令。
- [x] 删除重复的 floating button enabled 命令和无接收方的 language/theme main event。
- [x] 把 proxy 设置和解析完成改成直接调用，删除三个 proxy EventBus 命令。
- [x] 删除 Config 中没有 main 接收方的 settings、model、Agent、prompt 和 sync 原始事件。
- [x] 让 Shortcut 和 Tray 直接调用 Desktop，删除创建窗口、打开设置和托盘操作的隐藏命令。
- [x] 删除没有发送方或接收方的 OAuth、Sync、Force Quit 和 App Blur main 事件。
- [x] 让 App focus 直接通知 Upgrade，删除只有一个观察者的 App Focus event。
- [x] 让 `startMainProcess()` 只返回 App 控制操作，删除 `appMain.ts` 对业务模块列表的读取。
- [x] 删除 `Presenter` 类和 `src/main/presenter/index.ts`，改为 App composition 内的局部模块连接。
- [x] 更新架构检查，禁止恢复旧 `Presenter` 入口，并把 Session owner 创建位置改为 App composition。
- [x] 删除 `MCP_EVENTS.INITIALIZED`，由 App 在 MCP ready 后直接刷新 Agent tools 和 deeplink。
- [x] 删除 `WINDOW_EVENTS.FIRST_CONTENT_LOADED`，第一个 tab 加载完成后直接处理一次启动链接。
- [x] 删除没有接收方和实际作用的 `RENDERER_TAB_ACTIVATED` event、route 和 renderer 调用。
- [x] 删除没有接收方和实际作用的 `RENDERER_TAB_READY` event、route 和延时发送。
- [x] 删除没有 main 接收方的 window 状态 event 和 tab close event，保留 typed renderer 通知。
- [x] 删除 OAuth 保存 provider 后没有接收方的 `providerUpdated` 广播。
- [x] 删除没有调用方的 zoom shortcut 常量和旧 channel 转换分支。
- [x] 把 Window 到 Tab 的 resize、maximize、unmaximize 和 close 改成直接调用并删除旧 event。
- [x] 把主窗口创建后关闭 splash 改成 App 明确连接，并删除最后一个 `WINDOW_EVENTS`。
- [x] 把 language 后续操作改成 Config 直接刷新 Desktop，并删除 `SETTING_CHANGED` main event。
- [x] 把 Provider full、atomic 和 batch 更新改成 Config 直接调用 LLMProvider，并删除 `CONFIG_EVENTS`。
- [x] 让长期 Session、Query 和 Memory 读取当前 SQLite table，不缓存 reopen 前的旧 table 实例。
- [x] 删除 Device 内部可选的数据库关闭回调；数据重置先由 App 完整停止运行资源。
- [x] 删除 Sync 内部直接关闭、重开 SQLite 和重新连接 Config 的路径；import 和 cloud pull 由 App 维护状态包住。
- [x] 删除 Database Security route 直接迁移 SQLite 的路径；加密、改密和解密由 App 维护状态包住。
- [x] 删除 App 连接 Config 与 Memory 时的可选兼容调用，创建阶段必须明确连接删除清理和维护配置变更。
- [x] 删除 MCP route 和 NPM registry 连接中的可选成功兜底；公开的 MCP 能力必须真实存在并完成调用。
- [x] 删除 Skill Session 状态读取中的空表和查询失败兜底；当前 Session 表不可用时必须直接失败。

- [ ] 把每个通过的设计阶段拆成可单独检查的实施批次。
- [ ] 每次移动职责前先检查已有测试；只有关键行为没有覆盖时才增加最小测试。
- [ ] 每批只迁移一组调用方。
- [ ] 同一批删除对应旧依赖路径。
- [ ] 同一批移动对应实体文件，不积累到最后统一搬迁。
- [ ] 每个目标边界落地后增加自动依赖检查。
- [ ] 每批更新描述当前实现的架构和流程文档。
- [ ] 保持现有数据和有类型的外部通信约定。
- [ ] 确认没有为迁移保留临时兼容代码。
- [ ] 每批完成与影响范围相符的局部和完整验证。
- [ ] 重新生成最终依赖基线，并确认结果符合目标依赖图。

## T9：完成检查

- [ ] 确认每份可变状态和运行资源都有唯一负责模块。
- [ ] 确认全局 `Presenter`、全局模块查找入口和替代它的新总入口都已删除。
- [ ] 确认固定启动和退出顺序已经实现，清理可以重复调用。
- [ ] 确认 Desktop、Remote、Scheduler、deeplink 和 subagent 共用 Session 规则。
- [ ] 确认 `DeepChat` 和 `ACP` 仍是分开的有类型运行实现。
- [ ] 确认 Config、SQLite、route 和 event 不再充当业务总入口。
- [ ] 确认 `EventBus` 中没有隐藏操作、ready 顺序控制、无发送方或无接收方的调用。
- [ ] 确认用户数据、route/event 和用户可见行为保持兼容。
- [ ] 把当前架构文档更新到最终实际实现。
- [ ] 运行最终 format、i18n、lint、typecheck、main/renderer test 和相关 E2E。
