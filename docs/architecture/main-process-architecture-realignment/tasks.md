# main 进程架构整理：任务清单

> 状态：实施中
> 当前阶段：Agent 运行实施
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

- [x] 定义 window、tab、`WebContents`、settings、floating UI、tray 和 overlay 由谁负责。
- [x] 定义 renderer 与 Session 的绑定和清理。
- [x] 定义 close、hide、detach、deactivate、destroy 和 quit。
- [x] 保持 multi-window/multi-tab、close-to-tray、focus、shortcut 和 deeplink 行为。
- [x] 定义怎样向界面发送状态，同时不让 Session 或 Agent 依赖 Desktop。
- [x] 解决 Desktop 的全部问题并通过这一阶段。

## T4：Agent 运行设计

- [x] 确认 Agent 信息和 backend 选择由谁负责。
- [x] 确认 `DeepChat` 和 `ACP` instance 的生命周期。
- [x] 定义每个 Session 只载入一个 instance 的规则，以及何时 evict。
- [x] 确认每个 Turn 的 Run 和 Interaction 由谁负责。
- [x] 定义两类 backend 的 close/cleanup/delete/shutdown 行为。
- [x] 计划删除对 `Presenter` 适配的依赖，不重写执行算法。
- [x] 解决 Agent 运行的全部问题并通过这一阶段。

## T5：Agent 执行所需能力

- [x] 设计 Provider/model 的职责和 runtime 生命周期。
- [x] 设计 Tool catalog/execution/permission 的职责。
- [x] 把命令、文件和设置授权实现与测试移入 Tool，不再放在 Presenter 目录。
- [x] 设计 MCP server 生命周期和 Tool 配合方式。
- [x] 设计 Skill 文件、同步和 Session 选择规则，见 [Skill 模块边界](./skill.md)。
- [x] 设计 Plugin package 生命周期和能力登记，见 [Plugin 模块边界](./plugin.md)。
- [x] 设计 Memory 存储、runtime 和后台写入，见 [Memory 模块边界](./memory.md)。
- [x] 设计 Knowledge 索引和检索，见 [Knowledge 模块边界](./knowledge.md)。
- [x] 设计 Workspace、File 和 watcher，见 [Workspace、File 和 watcher 模块边界](./workspace-file-watcher.md)。
- [x] 确认没有新增汇总所有能力的总管理器。

## T6：外部入口和结果接收方

- [x] 设计 Remote channel 以及 endpoint binding 的职责，见
  [外部入口和结果接收模块边界](./remote-scheduler-deeplink-hook.md)。
- [x] 设计 Scheduler 查找到期任务和创建 detached run 的职责，见
  [外部入口和结果接收模块边界](./remote-scheduler-deeplink-hook.md)。
- [x] 设计 deeplink 怎样发起操作，见
  [外部入口和结果接收模块边界](./remote-scheduler-deeplink-hook.md)。
- [x] 设计 Hook 通知和其他结果接收方式，见
  [外部入口和结果接收模块边界](./remote-scheduler-deeplink-hook.md)。
- [x] 按当前发送方和接收方，把 `EventBus` 路径分成通知、隐藏操作、ready 信号和无效调用。
- [x] 决定关闭最后一个 tab/window 时，正在运行或暂停的 Session 应怎样处理。
- [x] 让 Desktop、Remote、Scheduler 和 subagent 使用已确认的 Session API；Deeplink 保持现有
  renderer 预填行为，不擅自创建 Turn。
- [x] 把 Deeplink 移到 `src/main/deeplink/`，删除旧 class 和 shared interface，并把 Window、
  Config、MCP 依赖收窄成三个明确操作接口。
- [x] 把 Hook 移到 `src/main/hook/`，由唯一 `HookService` 直接实现必需的 `HookObserver`；删除
  `NewSessionHooksBridge` 和 optional query，并把 child process 纳入 App 停止顺序。
- [x] 把 Remote 移到 `src/main/remote/`，删除旧 class、shared interface 和测试目录；按 channel、
  binding、conversation、delivery、runtime 分目录，并让 App 和 route 使用 `RemoteServicePort`。
- [x] Remote channel 配置和 endpoint binding 直接使用 `SettingsStore`，不再通过 Config 保存。
- [x] 把 Scheduler 移到 `src/main/scheduler/`，删除旧测试目录和两个 late setter；App 先创建
  Session starter 与 Remote delivery，再用完整依赖一次性创建 `SchedulerService`。

## T7：Platform、Config、数据存储和通信

- [x] 定义底层 settings 和 secret 能力。
- [x] 把具体配置从通用 Config API 移给对应模块。
- [x] 定义 database connection/transaction/migration 由谁负责。
- [x] 定义各模块的数据访问，不增加通用 repository 层级。
- [x] 让 route handler 按负责模块注册，同时保持有类型的通信约定。
- [x] 把 Provider 和 model route 移到 `src/main/provider/routes.ts`，删除旧顺序探测分发、
  `routes/providers`、`routes/models` 和 `hotPathPorts.ts`；App 明确注入 Provider route map。
- [x] 把 Tool route 移到 `src/main/tool/routes.ts`，从 `MainKernelRouteRuntime` 删除
  `ToolServicePort`，只由 App 把 Tool route map 交给 `RouteRegistry`。
- [x] 把 Plugin route 移到 `src/main/plugin/routes.ts`，从 `MainKernelRouteRuntime` 删除
  `PluginServicePort`，只由 App 把 Plugin route map 交给 `RouteRegistry`。
- [x] 把 Skill 和 Skill sync route 移到 `src/main/skill/routes.ts`，从
  `MainKernelRouteRuntime` 删除两个 Skill service，只由 App 注入 Skill route map。
- [x] 把 MCP route 移到 `src/main/mcp/routes.ts`，从 `MainKernelRouteRuntime` 删除
  `McpServicePort`，只由 App 注入 MCP route map。
- [x] 把 MCP 配置存储实现和测试移入 MCP，入口改为 `McpSettings`；Config 暂只在剩余迁移和旧调用
  清理期间持有该明确对象。
- [x] App 只创建一个 `McpSettings` 并明确交给 Config 的数据迁移和 ACP 配置适配，不再由 Config 或
  ACP 适配器各自偷偷创建配置对象。
- [x] MCP Service、Server、Tool 和 McpRouter 直接使用 `McpSettings` 读写 MCP 配置和 NPM registry；
- [x] Knowledge 配置由 `KnowledgeSettings` 负责，Knowledge Service、内置 Knowledge MCP 和配置路由
  直接使用该对象；删除通用 Config 上的 Knowledge 配置 API 和通知入口。
- [x] 自定义 Prompt 和系统 Prompt 由 Agent 的 `PromptSettings` 负责；Config route、DeepChat
  generation settings 和 MCP 内置 Prompt 直接使用它，删除 Config 的 Prompt API 和旧 helper。
- [x] Agent 信息、DeepChat 配置、ACP 开关、registry、安装状态、MCP 选择和默认模型由
  `AgentSettings` 负责；ACP 配置实体移到 Agent，Config 只通过迁移用窄接口接触旧配置表。
  Config、`ConfigServicePort` 和所有调用方删除 Agent/ACP API，Provider、MCP、Session、Remote、
  Scheduler、Desktop 和 route 直接使用 `AgentSettings`，不保留转发和双读。
- [x] ACP registry 的一次性旧数据迁移直接使用 `SettingsStore`，不再借用通用 Config API。
- [x] MCP Service、Server、Tool 和 Deep Research 直接从 `DesktopSettings` 取得当前语言，不再通过
  Config 读取 Desktop 状态；同时删除 ServerManager 对 Config 的无用依赖。
- [x] Provider runtime 通过模块内的 `ProviderLocalePort` 接收 Desktop 当前语言；Provider 实例和
  错误文本不再从 Config 读取语言，删除 Config 最后的 language 查询 API。
- [x] Provider、model、能力判断、model 状态和 Provider DB loader 全部移入 `src/main/provider/`；
  进程内入口改为 `ProviderSettings` / `ProviderSettingsPort`，删除 `ConfigService` 名字和旧文件路径。
- [x] Config migration 在业务模块连接数据库前一次性迁移旧 Provider、model、MCP、ACP、Prompt、
  Knowledge 和敏感设置；迁移后各模块只读当前存储，删除按 migration 状态回读旧数据的 fallback。
- [x] Provider 配置写入通过 `ProviderRuntime` 明确更新运行实例；删除 `ProviderSettings.startRuntime()`、
  ready flag、runtime effects 和创建完成前跳过通知的分支。
- [x] `ProviderSettingsPort` 移入 Provider 模块；main 内调用方从 Provider 取得窄接口，shared
  Presenter 类型不再公开进程内部 Provider 配置总入口。
- [x] VoiceAI、Azure、Gemini 和 AWS Bedrock 配置使用明确的 Provider 配置方法；Provider runtime
  不再通过通用 `getSetting` 读取具体配置。
- [x] File 直接从 `SettingsStore` 读取文件大小限制，不再依赖整个 Config API。
  MCP 模块不再通过 Config 的旧包装方法访问自己的配置。
- [x] Plugin 直接使用 `McpSettings` 登记和撤销插件提供的 MCP server，不再依赖 Config。
- [x] Provider 的 ModelScope 同步直接使用 `McpSettings` 导入 MCP server；Config 只负责读取
  ModelScope Provider 配置。
- [x] ACP Session 直接使用 `McpSettings` 读取要传给外部 agent 的 MCP server；Config 只负责
  agent 的 MCP 选择。
- [x] Config route 查询 MCP server 时直接读取 `McpSettings`，不再调用 Config 的 MCP 包装方法。
- [x] 删除 Config 和 `ConfigServicePort` 中全部 MCP server、McpRouter 与 NPM registry 包装方法；
  MCP 配置只从 `McpSettings` 进入。
- [x] 把 Remote route 移到 `src/main/remote/routes.ts`，从 `MainKernelRouteRuntime` 删除
  `RemoteServicePort`，只由 App 注入 Remote route map。
- [x] 把 Scheduler route 移到 `src/main/scheduler/routes.ts`，总 route runtime 只保留 Agent
  配置变化后的明确重排操作，不再持有 `SchedulerService`。
- [x] 把 Provider OAuth route 合并到 `src/main/provider/routes.ts`，总 route runtime 不再持有
  `IOAuthPresenter`。
- [x] 删除 `OAuthPresenter`、`IOAuthPresenter` 和 Presenter 下的各 Provider 登录实现；认证实现、类型
  和测试统一移入 Provider 的 `auth/`，入口改为 `OAuthService`。
- [x] 把 Memory route 和 DTO 转换移到 `src/main/memory/routes.ts`，只注入 Memory service、
  Agent 类型查询和所需的两组数据查询，不再让总 route runtime 持有 `MemoryServicePort`。
- [x] 把 window、browser、tab 和 shortcut route 移到 `src/main/desktop/routes.ts`，总 route
  runtime 不再持有 Browser、Tab 和 Shortcut 模块。
- [x] 把 Dialog 回传和打开设置 route 移到 `src/main/desktop/routes.ts`；总 route runtime 只为
  启动任务分类保留读取设置窗口编号的窄接口。
- [x] 删除旧 `presenter/dialogPresenter/` 和 `IDialogPresenter`；实现、类型和测试移入 Desktop，入口
  改为 `DialogService`。
- [x] 把 File route 移到 `src/main/file/routes.ts`，总 route runtime 不再持有
  `FileServicePort`。
- [x] 把设备信息、文件选择、重启、数据重置和 SVG 清理 route 移到
  `src/main/device/routes.ts`，总 route runtime 不再持有 Device 或 App 数据重置入口。
- [x] 删除旧 `presenter/devicePresenter/` 和 `IDevicePresenter`；实现、类型和测试移入 Device，入口改为
  `DeviceService`。
- [x] 把引导状态、route 和测试移到 `src/main/onboarding/`，总 route 不再保存引导业务逻辑。
- [x] Onboarding 状态和 route 直接使用 `SettingsStore`，不再依赖通用 Config API。
- [x] 把 Upgrade route 移到 `src/main/upgrade/routes.ts`，总 route runtime 不再持有 Upgrade。
- [x] 删除旧 `presenter/exporter` 路径；导出实现、测试和 Nowledge Mem route 统一移到
  `src/main/exporter/` 与 `test/main/exporter/`，总 route runtime 不再持有 Exporter。
- [x] 把备份、导入和云同步 route 移到 `src/main/sync/routes.ts`；数据库导入和恢复仍由 App
  维护状态包住，总 route runtime 不再持有 Sync。
- [x] 把 Config route handler、设置适配和对应测试移出总 route 目录，统一放到
  `src/main/config/` 与 `test/main/config/`，不保留旧路径。
- [x] Config 模块通过 `src/main/config/routes.ts` 注册全部 Config 和 Settings route，并在模块内
  记录设置活动和重排受 Agent 配置影响的任务；总 route 不再分发 Config 或持有 Settings handler。
- [x] 通用 Config entry route 直接使用 `SettingsStore`；删除 `ConfigServicePort` 的通用
  `getSetting` / `setSetting`，业务模块不能再通过字符串 key 使用 Config。
- [x] 删除 `src/main/presenter/configPresenter/` 和旧测试目录；现有配置实现与测试先统一移到
  `src/main/config/` 和 `test/main/config/`，不保留旧路径，后续按负责模块继续拆分具体配置。
- [x] 删除 `ConfigPresenter`、`IConfigPresenter` 和 `configPresenter` 名字；进程内入口改为
  `ConfigService` / `ConfigServicePort` / `configService`，不保留旧类型别名。
- [x] 建立稳定的 `SettingsStore`，数据库连接后原对象直接切换到数据库存储；删除 Config helper
  重新绑定 store 的临时步骤和 Config 内部按 key 选择存储的分支。
- [x] App 明确创建 `SettingsStore` 和 `SecretStore`；把本地备份、云同步配置和密钥移给
  `SyncSettings`，删除 `ConfigServicePort` 中的 Sync 配置方法。
- [x] 删除旧 `presenter/syncPresenter/` 和 `ISyncPresenter`；实现与测试移到 `src/main/sync/` 和
  `test/main/sync/`，入口改为 `SyncService`，Sync 类型移出 Presenter 类型文件。
- [x] 把 Hook 配置移给 `HookSettings`，Config route 直接调用 Hook 配置和命令测试；删除
  `ConfigServicePort` 中的 Hook 方法和 Config runtime 对 `HookService` 的反向调用。
- [x] 删除 `presenter/nowledgeMemPresenter/`；客户端移到 Exporter，并直接使用 `SettingsStore`
  保存自己的配置，删除 Config 中的 Nowledge Mem 配置方法。
- [x] 删除 `presenter/upgradePresenter/` 和 `IUpgradePresenter`；实现与测试移到 Upgrade 模块，入口改为
  `UpgradeService`，更新渠道由 `UpdateSettings` 负责，Config route 直接调用它。
- [x] 删除旧 Notification Presenter 和 shared interface；实现与测试移入 Desktop，系统通知和
  Settings route 直接使用 `DesktopSettings`。
- [x] 把快捷键默认值和读写移入 Desktop；Shortcut 和 Config route 直接使用
  `DesktopSettings`，删除 Config 中的快捷键方法和旧配置文件。
- [x] 默认工作目录改由 `ProjectService` 直接读写 `SettingsStore`；Session、Remote、启动页和
  Config route 都从 Project 读取，删除 Config 中的对应方法和缺失依赖兜底。
- [x] 开机启动设置移入 Desktop，Settings route 直接使用 `DesktopSettings`，Config 不再调用
  Electron login item API。
- [x] 关闭窗口和内容保护设置移入 Desktop；Window 只读取 `DesktopSettings`，Settings route
  保存后直接调用 Window 应用内容保护，Config 不再持有 Desktop 行为。
- [x] Floating Button 的开关和位置移入 Desktop；Floating Button 和 Config route 直接使用
  `DesktopSettings`，开关保存后由 route 直接应用，不再经过 Config runtime effect。
- [x] 日志开关、日志目录和重启动作移给 App 的 `LoggingService`；App 启动直接从
  `SettingsStore` 读取初值，Settings 和 Config route 不再经过 Config。
- [x] 字体读写、清洗、系统字体检测和缓存移入 Desktop 的 `FontSettings`；对应测试同步移动，
  Settings route 不再通过 Config 和 `UiSettingsHelper`。
- [x] 字号和界面效果开关移入 `DesktopSettings`；Settings route 不再借用 Config 的通用
  `getSetting` / `setSetting` 保存 Desktop 配置。
- [x] language 和 theme 的读写、系统值解析、事件发布与界面刷新移入 `DesktopSettings`；Config route、
  Tray、Shortcut、Floating Button 和设置工具直接使用 Desktop，不再调用 Config 的写入和主题 API。
- [x] 自动滚动移入 `DesktopSettings`，并删除没有调用方的旧搜索预览配置；Config 和
  `UiSettingsHelper` 不再保留这些界面设置。
- [x] 删除 Config 中没有调用方的 model 默认包装、custom search engine、Skill setter、ACP
  install status 和 system theme API，不为旧接口保留空壳。
- [x] 自动压缩默认值由 Agent 的 `DeepChatDefaults` 直接读写内置 Agent 配置；Settings route 不再
  通过 Config，Config 和 `UiSettingsHelper` 删除对应方法。
- [x] Skill 开关、目录、草稿建议、管理状态和扫描缓存移给 `SkillSettings`；Skill、Tool、Agent
  和 Config route 直接使用它，Config 删除全部 Skill 配置方法。
- [x] 隐私模式由 App 的 `PrivacySettings` 负责；Config、MCP、Upgrade 和 Settings route 使用明确
  依赖，Config 删除对应 API。
- [x] 复制内容时是否包含思考过程由 `DesktopSettings` 负责；Settings route 和 Agent 设置工具直接
  使用 Desktop，Config 删除对应 API。
- [x] Agent 调试追踪开关由 `AgentTraceSettings` 负责；DeepChat、ACP 和 Settings route 直接使用
  Agent 配置，删除 `UiSettingsHelper` 和 Config 对应 API。
- [x] RTK runtime 只接收是否启用的明确值，不再依赖通用 Config API。
- [x] 代理模式和自定义地址由 Platform 的 `ProxySettings` 负责；App 启动时初始化代理，Config route
  保存后直接应用代理变化，Config 删除对应设置和运行操作；`proxyConfig` 同步移出 Presenter。
- [x] 把数据库维护、启动页和开发调试 route 移到 `src/main/app/routes.ts`，删除启动协调器缺失时
  绕过固定顺序的分支；总 route switch 和业务 runtime 字段全部删除。
- [x] 数据库加密、解锁和密码迁移实现与测试移入 App，删除 `DatabaseSecurityPresenter` 名字，入口
  改为 `DatabaseSecurityService`。
- [x] 启动工作队列与测试移入 App，删除 Presenter 下的旧目录，App 统一负责启动任务的调度和重放。
- [x] 删除 `MainKernelRouteRuntime`、`createMainKernelRouteRuntime` 和延迟查找 runtime 的注册方式；
  App 直接创建只含 route registry、维护状态检查和启动任务跟踪的 `RouteDispatcher` 后注册 IPC。
- [x] 把 Knowledge route 移到 `src/main/knowledge/routes.ts`，总 route runtime 不再持有
  `KnowledgeServicePort`。
- [x] 把 Workspace route 移到 `src/main/workspace/routes.ts`，总 route runtime 不再持有
  `WorkspaceServicePort`。
- [x] 把 Project 实现和测试移出旧 Presenter 目录，入口改为 `ProjectService`；Project route
  放到 `src/main/project/routes.ts`，总 route runtime 只保留启动时创建默认工作目录的明确操作。
- [x] 把 Session、Chat、历史搜索和翻译服务移出 `src/main/routes/`，实现与测试统一放到
  `src/main/session/`，route 目录不再保存 Session 业务服务。
- [x] 把全部 Session 和 Chat route 移到 `src/main/session/routes.ts`；Session 模块创建 route
  服务并接收所需端口，总 route runtime 只保留启动页读取当前 Session 的窄接口。
- [x] 把 ACP terminal route 移到 `src/main/agent/acp/routes.ts`，总 route 不再直接调用 ACP
  terminal helper。
- [x] 定义 event 发布，并删除隐藏的业务命令路径。
- [x] 每批职责和依赖迁移完成后，在同一批改动中移动对应实体文件。

## T8：分批实施

- [x] 删除旧 `SessionPresenter`、旧 thread 广播和 tab/window close compatibility；legacy export
  只保留 exporter 内的只读转换。
- [x] 用量统计计算、回填服务和测试移入 Session；删除 Presenter 下的旧文件和旧测试路径。
- [x] Session 用量回填和 RTK 状态直接使用 `SettingsStore`，Provider 名称查询只接收 Provider catalog。
- [x] 删除 Presenter 下没有调用方的旧搜索提示词模板，不迁移无效代码。
- [x] 删除没有生产调用方的旧 Presenter call error 包装、缓存清理和测试，不保留 IPC 兼容空壳。
- [x] 把 Provider/ACP 端口移入 Provider，把 Session permission/UI 端口移入 Session，并删除
  Presenter 下的通用 `runtimePorts.ts` 和无调用方的 Window 端口。
- [x] 把启动期旧数据导入和 Session 数据迁移实现、测试移入 App startup migrations；删除
  Presenter 下的旧目录和旧测试路径。
- [x] 把 SQLite connection、SQLCipher、schema catalog、diagnose、repair 和 copy exclusion 基础实现
  与测试移入 `src/main/data/`；业务 table 暂不跟随基础设施移动。
- [x] 把数据库数据导入实现和测试移入 Sync；删除 SQLite Presenter 下的旧文件和旧测试路径。
- [x] 把所有 table 共用的最小 `BaseTable` 移入 Data，业务 table 不再从 Presenter 目录读取基础类。
- [x] 把 Session、message、pending input、Tape、trace、search projection、usage table 和对应测试
  移入 Session；旧 SQLite Presenter 只在尚未拆完时创建这些模块内 table。
- [x] 把 Agent、ACP session、ACP turn table 和对应测试移入 Agent；不保留 Presenter 旧路径。
- [x] 把 Memory、Memory audit、FTS policy、state SQL、ingestion projection table 和对应测试
  移入 Memory；不保留 Presenter 旧路径。
- [x] 把 Cron job、run、delivery table 移入 Scheduler；不保留 Presenter 旧路径。
- [x] 把 Project、environment、environment preference table 和对应测试移入 Project；不保留
  Presenter 旧路径。
- [x] 把 Config 和 settings activity table 及对应测试移入 Config；不保留 Presenter 旧路径。
- [x] 把旧数据导入状态 table 移入 App；不保留 Presenter 旧路径。
- [x] 删除 `SQLitePresenter`、`ISQLitePresenter` 和旧目录；数据库连接入口改为
  `src/main/data/mainDatabase.ts` 的 `MainDatabase`，不保留旧名字或转发文件。
- [x] 建立 Session 自己的 `SessionDatabase`，Session、Agent runtime、Exporter 和会话搜索只从
  Session 取得会话 table；每次操作读取当前数据库连接，不缓存 reopen 前的 table。
- [x] 建立 Project 自己的 `ProjectDatabase`，Project 和 Session 生命周期只从 Project 取得项目与
  环境 table；每次操作读取当前数据库连接。
- [x] 建立 Memory 自己的 `MemoryDatabase`，Memory runtime 和 App 只从 Memory 取得 memory、audit
  与 ingestion projection table；每次操作读取当前数据库连接。
- [x] 建立 Agent 自己的 `AgentDatabase`，Agent catalog、ACP session/turn 和 ACP alias migration
  只从 Agent 取得 table；Session 与 Project 的联动由 ACP persistence 明确调用两个模块。
- [x] 建立 Config 自己的 `ConfigDatabase`，Config 存储、设置活动和 Sync 配置读取只从 Config
  取得 table；每次操作读取当前数据库连接，数据库 reopen 后不重新绑定旧 table。
- [x] 建立 Scheduler 自己的 `SchedulerDatabase`，任务、运行和投递记录只从 Scheduler 取得
  table；每次操作读取当前数据库连接。
- [x] 建立 App 自己的 `AppDatabase`，旧数据导入状态只从 App 取得 table；旧 Chat 导入和覆盖清理
  由 App 维护流程调用各模块数据库，不再由 `MainDatabase` 承担业务操作。
- [x] 删除 `MainDatabase` 对业务 table 和业务方法的公开聚合；它只保留连接、事务、schema、修复、
  备份和 reopen，建表与迁移清单由 Data 内部 schema catalog 管理。
- [x] 删除 `AppSessionService` 的 window binding，把 renderer binding 移给 Desktop。
- [x] 删除 Session Projection 的 status cache。
- [x] 把 `sessionApplication` 移到最终 Session 目录并删除 presenter 命名。
- [x] 删除 `AgentRuntimePresenter` 的 shared data compatibility。
- [x] 删除 floating button 对全局 `Presenter` 的 Session 和 Desktop 查找。
- [x] 删除 MCP `ToolManager` 对全局 Session 查询的托底，直接使用 Tool 调用上下文。
- [x] 删除 `McpService` 从全局 `Presenter` 补取 Config 的构造托底。
- [x] 让 conversation search MCP server 直接读取 Session 持久数据，删除全局 Session/SQLite 查找。
- [x] 删除 `Presenter` 构造时对 `ILifecycleManager` 和 `LifecycleContext` 的读取，启动依赖全部明确传入。
- [x] 删除 `LifecycleManager`、phase、priority、全部通用 hook 和 lifecycle event，改为 App 固定启动与退出顺序。
- [x] 把 database initializer、protocol 注册和 splash 移到 `src/main/app/`，不再保留 lifecycle 目录。
- [x] 删除全局 route runtime、cache 和文件加载时注册，改为 App 创建模块后注册并捕获明确依赖。
- [x] 让 Knowledge 直接接收 File、embedding 和 Dialog，删除 Knowledge 对全局 `Presenter` 的查找。
- [x] 让 MCP 内置 prompt、knowledge 和 deep research server 直接接收 Config 与 Knowledge。
- [x] 让 `McpClient` 直接接收 sampling、completion 和 model catalog，删除对全局 `Presenter` 的读取。
- [x] 让 Tray 和 OAuth 直接接收 Config，让 Notification 接收 Desktop 设置，删除全局 Config
  查找和 tray 构造托底。
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
- [x] 把 Provider DB、Voice AI、Gemini、Azure 和 AWS Bedrock 的具体配置 route 移入 Provider；
  Config 不再依赖 Provider 设置，也不再代办这些业务配置。
- [x] 把 Agent、ACP registry、ACP 安装状态和 Agent MCP 选择 route 移入 Agent；调度任务整理和
  settings activity 跟随 Agent route 执行，Config 不再依赖 Agent 设置。
- [x] 把 MCP server 配置读取 route 移入 MCP；Config 不再依赖 MCP 设置。
- [x] 把 Skill 草稿建议配置 route 移入 Skill；Config 不再依赖 Skill 设置。
- [x] 把 Knowledge 配置 route、配置应用和 settings activity 移入 Knowledge；Config 不再依赖
  Knowledge 设置。
- [x] 把 custom prompt、system prompt 和默认 prompt route 及 settings activity 移入 Agent；
  Config 不再依赖 Prompt 设置。
- [x] 把 language、theme、floating button 和 shortcut route 及 settings activity 移入 Desktop；
  Config 不再代办 Desktop 配置。
- [x] 把本地 Sync 配置 route 移入 Sync；Config 不再依赖 Sync 设置。
- [x] 把 proxy 配置 route 和立即应用操作移入 Platform；Config 不再依赖代理设置。
- [x] 把 Hook 通知配置和命令测试 route 移入 Hook；Config 不再依赖 Hook 设置。
- [x] 把默认项目目录 route 移入 Project；Config 不再依赖 Project。
- [x] 把更新通道 route 移入 Upgrade；Config 不再依赖更新设置。
- [x] 把打开日志目录 route 移入 App；Config 不再代办 App 操作。
- [x] 把跨模块 settings snapshot/update、通用配置条目和 settings activity route 移入 App；
  删除 Config 的 route、handler 和跨模块 adapter。
- [x] 删除未使用的旧 `KnowledgeConfHelper` 和独立 ElectronStore 路径；Knowledge 只保留当前设置入口。
- [x] 把 MCP 的数据库设置 store 移入 MCP；Config 不再包含 MCP store 实现。
- [x] 把 ACP catalog 的数据库设置 store 移入 Agent；Config 不再包含 ACP store 实现。
- [x] 把 Provider model 和 model config 的数据库 store 移入 Provider；Config 不再包含这些实现。
- [x] 把剩余 Provider 测试移出旧 `test/main/presenter/`；删除最后的 Presenter 测试目录。
- [x] 把 settings 数据库、table 和数据库后端移入 Settings；Config 目录只保留设置入口、secret 和迁移支持。
- [x] 把 `ConfigDatabase` / `ConfigTables` 改成 `SettingsDatabase` / `SettingsTables`，删除把 Settings 存储误认为通用 Config 总入口的名字。
- [x] 让长期 Session、Query 和 Memory 读取当前 SQLite table，不缓存 reopen 前的旧 table 实例。
- [x] 删除 Device 内部可选的数据库关闭回调；数据重置先由 App 完整停止运行资源。
- [x] 删除 Sync 内部直接关闭、重开 SQLite 和重新连接 Config 的路径；import 和 cloud pull 由 App 维护状态包住。
- [x] 删除 Database Security route 直接迁移 SQLite 的路径；加密、改密和解密由 App 维护状态包住。
- [x] 删除 App 连接 Config 与 Memory 时的可选兼容调用，创建阶段必须明确连接删除清理和维护配置变更。
- [x] 删除 MCP route 和 NPM registry 连接中的可选成功兜底；公开的 MCP 能力必须真实存在并完成调用。
- [x] 删除 Skill Session 状态读取中的空表和查询失败兜底；当前 Session 表不可用时必须直接失败。
- [x] 删除 Plugin 连接 MCP 和 Skill 时的可选能力兜底；插件启停只调用明确存在的运行状态和资源注册接口。
- [x] 删除 Project 对 Config 的可选依赖；环境归档和删除必须同步检查默认工作目录。
- [x] 删除 Agent、Provider、MCP、Shortcut 和 Database Security 对 Config 核心能力的可选调用；能力判断和清理必须走真实 Config API。
- [x] 把 Shortcut 实体和对应测试移入 Desktop 目录，不保留旧 `presenter/shortcutPresenter` 转发文件。
- [x] 把 Tray 实体和对应测试移入 Desktop 目录，不保留旧 `presenter/trayPresenter` 转发文件。
- [x] 把 Floating Button 实体和对应测试移入 Desktop 目录，不保留旧 `presenter/floatingButtonPresenter` 转发目录。
- [x] 把 Tab 实体移入 Desktop 目录，不保留旧 `presenter/tabPresenter` 转发文件。
- [x] 把 Window 与 Floating Chat 实体及对应测试移入 Desktop 目录，不保留旧 `presenter/windowPresenter` 转发目录。
- [x] 把 WebContents context menu 移入 Desktop 目录，不保留 main 根目录的旧 helper。
- [x] 把 YoBrowser 的 WebContents、overlay、CDP 和对应测试整体移入 Desktop 目录，不保留旧 `presenter/browser` 目录。
- [x] 增加架构检查，禁止 Agent 和 Session 反向导入 Desktop。
- [x] 把 AgentRepository 和对应测试移入 Agent 目录，不保留旧 `presenter/agentRepository` 转发目录。
- [x] 把 Session vision 解析和对应测试移入 Agent 目录，不保留旧 `presenter/vision` 目录。
- [x] 删除 `presenter/agentRuntimePresenter`，把 `DeepChat` 运行实现和测试移入
  `agent/deepchat/runtime`，不保留旧入口。
- [x] 把 `ACP` compatibility 和测试移入 `agent/acp/compatibility`。
- [x] 把 Session data 使用的 Tape 纯函数和测试移入 `session/data`，删除 Session 对旧
  `Presenter` 路径的依赖。
- [x] `DeepChat` 运行模块在创建时接收 Provider、Tool、Skill、permission、Session UI、
  Memory 和图片缓存；删除缺少核心依赖时继续运行的分支。
- [x] Memory 未启用只由 `isEnabled()` 表示；删除运行中移除 Memory port 的第二条路径。
- [x] Agent 只通过创建时传入的 event publisher 发出 renderer 通知；删除 Agent 对 `routes`、
  Remote、Scheduler 和 App 的反向导入，并增加自动检查。
- [x] 把 ACP terminal event envelope 和 assistant delivery segment 的纯转换移到 `shared`，
  删除 Agent 对通信层和 Remote 展示代码的借用。
- [x] 把清空、重试、删除、编辑和 fork 的 transcript 修改移给 Session；删除
  `DeepChatRuntimeCoordinator` 上对应的完整操作，只保留运行状态准备和收尾接口。
- [x] ACP runtime 直接接收 Session 的 pending input 接口；删除 `DeepChatRuntimeCoordinator`
  转交 pending input 的入口，以及 ACP 缺少该接口时继续运行的分支。
- [x] 把共享 `AcpRuntimeOwner` 的创建和 shutdown 移给 Agent ACP/App composition；Provider 只接收
  owner 供旧 `AcpProvider` 兼容路径使用，并删除 optional MCP registry 和普通 Provider 的无用依赖。
- [x] App shutdown 明确停止 Provider runtime；清理全部已创建的 Provider 实例，并拒绝 shutdown
  后再创建运行实例。
- [x] 把 Provider runtime 移到 `src/main/provider/`，删除旧 class、shared interface 和测试目录；
  App、Agent、MCP 与 Routes 只依赖 `ProviderRuntime` 或 `ProviderRuntimePort`。
- [x] DeepChat 使用的 Tool 接口改为必需方法；删除权限预检查、上下文同步和清理方法不存在时的
  运行分支，无需权限时明确返回 `null`。
- [x] Tool 和 Skill 执行直接读取 RTK 设置；删除 Bash 在设置依赖缺失时继续执行的兜底路径。
- [x] 删除全部 main 内部 `MCP_EVENTS`；Config 直接通知 MCP 和 Knowledge，MCP client、server 和
  Tool 列表变化直接清理 Tool cache 并通知 Agent，不再通过全局 `EventBus` 控制刷新顺序。
- [x] 删除 `presenter/toolPresenter` 和对应旧测试目录；实现移到 `src/main/tool/`，类型移到
  `src/shared/types/tool.d.ts`，并把 `ToolPresenter` / `IToolPresenter` 改成 `ToolService` /
  `ToolServicePort`，不保留旧导出或转发文件。
- [x] 删除 `presenter/mcpPresenter` 和对应旧测试入口；实现与测试移到 `src/main/mcp/` 和
  `test/main/mcp/`，并把 `McpPresenter` / `IMCPPresenter` 改成 `McpService` / `McpServicePort`。
  Tool 只接收 MCP catalog/execution/permission 接口，Plugin shutdown 不再检查可选停止方法。
- [x] 删除两个旧 Skill Presenter 目录和对应旧测试入口；实现与测试移到 `src/main/skill/` 和
  `test/main/skill/`，进程内入口改为 `SkillService` / `SkillSyncService`，Plugin contribution
  改为必需的窄接口，Tool 不再检查 Skill 方法是否存在。
- [x] 删除旧 Plugin Presenter 目录和测试入口；实现、Tool policy 和测试移到 `src/main/plugin/`
  与 `test/main/plugin/`，入口改为 `PluginService` / `PluginServicePort`。先从 Plugin 删除
  `BrowserWindow` 和窗口表，再由 Desktop 的 `PluginSettingsWindow` 唯一创建和停止窗口。
- [x] 删除旧 Memory Presenter 目录、旧测试路径和旧名字；实现与测试移到 `src/main/memory/`
  与 `test/main/memory/`，入口改为 `MemoryService` / `MemoryServicePort` / `MemoryServiceDeps`。
  App、Routes、Tool、Agent runtime、SQLite adapter 和专项门禁全部改用唯一新路径，不保留转发或别名。
- [x] 删除旧 Knowledge Presenter 目录、内部 Presenter 类型和旧测试路径；实现移到
  `src/main/knowledge/`，共享数据合同移到 `src/shared/types/knowledge.ts`。App 注入 renderer
  通知，Knowledge 不再反向导入 Routes；Routes 和 MCP 只接收 `KnowledgeServicePort` 的所需能力。
- [x] 删除旧 File、Workspace Presenter、watcher lib 和旧测试路径；实现与测试移到
  `src/main/file/`、`src/main/workspace/`、`src/main/platform/` 和对应测试目录。App 创建并停止唯一
  `FileWatcherService`，Workspace 和 Skill 明确接收它；旧 class、interface、内部 workdir 别名和
  watcher singleton getter 全部删除，不保留转发或双轨实现。

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
- [x] 删除全局 `EventBus`、`sendToMain()` 和对应测试；Provider DB 使用模块内有类型通知，
  MCP 和其他业务操作使用直接调用。
- [ ] 确认用户数据、route/event 和用户可见行为保持兼容。
- [ ] 把当前架构文档更新到最终实际实现。
- [ ] 运行最终 format、i18n、lint、typecheck、main/renderer test 和相关 E2E。
