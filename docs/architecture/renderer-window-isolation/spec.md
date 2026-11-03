# Renderer 的窗口边界与聊天状态归属

**验收目标**：打开全局 MCP 设置只启动该窗口需要的功能；聊天窗口独立处理导航、草稿、消息投影与订阅。首条和后续消息共用附件准备规则。多个窗口可以显示同一个 Session，持久事实与命令接纳结果由 main 决定。五个入口沿用各自的生命周期；窗口边界可在工作分支上独立验证，与 Main 一同交付。

[分步实施计划](./plan.md) · [Main 边界](../main-harness-portability/spec.md) · [Renderer 启动合同](../renderer-application-boundaries/spec.md) · [聊天显示模型](../chat-display-model-boundary/spec.md)

## 现状依赖

基线为 `dev@145e51763`。箭头从使用者指向依赖，含调用时初始化的 Pinia store。五个 HTML 入口对应五个独立运行上下文；同一份 store 定义在不同窗口创建的是不同实例。

```text
ChatMainApp -> ChatTabView -> NewThreadPage / ChatPage
                              |                |
                              |                +-> useComposerSubmit -> audio preparation
                              +-> audio preparation
Chat plugins -> McpPluginsPage ------+
Settings app -> settings-mcp route --+-> McpSettings -> MCP config / market / Agent policy
                                                     -> useSessionStore -> useMessageStore
                                                                        -> messageIpc -> stream listeners
Session store -> sessionIpc / pageRouter / Agent / draft / attachment recovery / onboarding
              -> ChatClient / SessionClient / ConfigClient / OnboardingClient
Other entries: Floating | Splash | Browser Overlay -> their own bootstrap and preload surfaces
Typed API clients -> preload bridge -> authorized main routes
```

仓库基线记录 Settings 指向 `src/renderer/src` 的 128 处导入，包含组件、类型和纯函数。MCP 的问题可通过行为验证：默认 `global` 视图依然构造 Session 和 Agent store，Session 随即创建消息 store 并绑定流监听。反向也存在应用依赖：聊天插件路由直接引用 Settings 的组件文件。[架构基线](../baselines/renderer-application-boundaries-baseline.json) · [聊天入口](../../../src/renderer/src/pages/plugins/McpPluginsPage.vue) · [MCP 页面](../../../src/renderer/settings/components/McpSettings.vue) · [Session store](../../../src/renderer/src/stores/ui/session.ts)

## 目标依赖

```text
Chat main shell -> chat lifecycle / navigation -> session projection + message projection
                  |                            -> current-window draft / router / client
                  +-> new-thread composer -----+
                  +-> active-session composer -+-> shared attachment preparation -> ModelClient
                  +-> plugins MCP route -------+
Settings shell -----> settings MCP route ------+-> MCP feature (scope, explicit target if needed)
                                                   -> MCP state / typed clients
Floating | Splash | Browser Overlay -> own lifecycle -> purpose-specific bridge

Chat event binding -> session projection / messageIpc stream gate -> message projection
Chat views         -> DisplayMessage / dc-ui / shadcn-vue
Window clients     -> typed preload API -> authorized main route
```

每个图中的共享功能共享实现，各窗口自行构造运行实例。MCP 功能属于两个入口共同使用的 feature。`features` 下复用该实现符合现有 renderer 结构；`renderer/services` 留给真正跨窗口复用的服务，例如通知。选择文件位置时要消除对另一应用入口的反向导入。

### 职责和允许的依赖

| 模块 | 负责什么 | 允许依赖 |
| --- | --- | --- |
| ChatMainApp、ChatTabView | 聊天窗口的早期监听、bootstrap、首屏和 deferred hydration，装配窗口级编排与清理 | chat feature、typed clients、路由、本窗口 Pinia、appearance 与 notifications |
| Settings app | 独立启动、设置路由、deeplink、设置保存和页面跳转 | 设置 feature、共享功能视图、typed clients、本窗口状态；全局 MCP 挂载不能触发聊天 store |
| Floating、Splash、Browser Overlay | 各自的交互、加载或浏览器覆盖层生命周期 | 各自受限 preload 和必要 UI 基础；不引入 Chat/Settings 的应用根或扩大 bridge 权限 |
| 聊天窗口编排 | 负责 select/close/create 导航意图、定向激活/失活、草稿切换、首次聊天引导及清理时机 | 路由、各状态所有者的操作与 clients；跨异步边界共用同一导航序号 |
| Session 投影 | 当前窗口的会话列表、分页、分组、选中 ID、active summary、版本合并与查询失效 | Session/配置查询、显示模型、纯函数；数据库替换要失效进行中的读取 |
| 消息投影与 `messageIpc` | 已展示消息、局部乐观状态、stream request 代次与终态 tombstone、其他会话的缓存失效 | Chat/Session 客户端、显示转换、本窗口当前选择；主进程负责持久化与重放数据裁剪 |
| Composer 与草稿 | 新会话按 Agent 的草稿和已有会话按 Session 的草稿、提交快照与取消；共用附件能力判断 | 当前模型选择、附件准备、typed clients、现有通知和草稿持久化。接纳/排队/权限以 main 回执为准 |
| MCP 功能 | 全局配置、market 和可选 Agent 范围的策略编辑、加载与保存竞态 | MCP 状态与配置 clients、语言和 UI。宿主传范围、目标和必要的导航/缓存刷新操作；组件不能从聊天推算目标 |
| Renderer API、跨窗服务、基础 UI | `*Client` 封装 IPC；通知服务共享呈现逻辑；显示模型和通用组件承载展示 | client 只经已有 typed bridge；跨窗服务不引用窗口根/聊天 store；基础 UI 消费 props 与局部 UI 依赖 |
| Preload 与 main | 验证 route/event 合同、sender、授权、Session 归属和模型/附件实际能力 | 现有 IPC 和 main 模块。renderer 的局部筛选和乐观回显均不能替代可信侧校验 |

MCP 的两个路由适配页分别读取本窗口的 `view=market` query，并保留其他 query。共享实现位于 `features/mcp/McpSettingsView.vue`，通过 `market` 接收当前视图，通过 `open-market`、`close-market`、`continue-onboarding` 和 `open-knowledge-settings` 交付用户意图与已取得的引导状态。Settings 适配页在本窗口导航或唤回主窗口；聊天插件适配页导航到本窗口的插件路由，或通过 typed client 打开 Settings。服务器列表和 market 不读取另一应用的路由表，也不导入 Settings 实现。

## 行为合同与验收

- **独立窗口。** 干净 Pinia 中挂载、离开、重进全局 MCP 管理，只建立 MCP 所需的订阅；该视图及其子树不得创建聊天 Session/message store 或注册聊天流监听。聊天插件入口和独立 Settings 入口均能完成原有配置、market 和引导动作。Agent 范围由调用方通过 `agentId` 明确传入目标；未提供目标时显示原有不支持提示，不推算默认 Agent。保存成功通过 `agent-policy-saved` 携带原目标 ID 通知调用方，由调用方刷新其缓存。若调用方用当前聊天选择，沿用 active Session Agent → selected Agent → `deepchat` 的优先级。异步结果不能覆盖切换后的目标。
- **启动与导航。** ChatTabView 提交 shell 快照后发起首个 Session 列表读取；所有窗口继续处理早期 deeplink 和 bootstrap 失败回退。激活/失活只影响目标 webContents。本地选择、IPC 激活、关闭和带 Tape incarnation 的引用跳转遵循最新意图；过期结果不能再次导航、切换 Agent 或覆盖草稿。卸载移除本窗口订阅。[定向 IPC](../../../src/renderer/src/stores/ui/sessionIpc.ts)
- **草稿与提交。** 新会话可异步解析模型，已有会话使用当前选择。二者在能力相同时保留相同文件和顺序；不支持音频时提示被过滤的数量及模型，能力查询失败时保留原附件供 main 裁决。输入修改、会话切换、取消或过期回执不能清除较新的草稿。首次创建的会话遇到附件阻塞时保留原恢复行为；queue、steer、retry 各自保留语义。[首条提交](../../../src/renderer/src/pages/NewThreadPage.vue) · [后续提交](../../../src/renderer/src/features/chat-page/composables/useComposerSubmit.ts)
- **流与安全。** `messageIpc` 是 request 代次和终态唯一裁决点；清除当前屏幕的流不等于删除旧 request 的 tombstone。多窗口迟到帧不能复活已结束的消息；永久删除会话时释放对应跟踪。客户端不获得 provider replay、凭据或 Electron 对象。[消息订阅](../../../src/renderer/src/stores/ui/messageIpc.ts)
- **收敛指标。** 验收针对被迁移的真实依赖、订阅和调用者。保留现有五入口基线检查，对动过的功能去掉有副作用的跨窗边；不会因刷新数字而把所有 Settings 导入移入通用目录。此目标不改变用户界面布局、路由名、翻译键、IPC 和已有草稿格式。
