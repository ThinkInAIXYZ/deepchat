# Renderer 迁移计划

[窗口依赖与合同](./spec.md) · [共同的工作分支、PR 与 beta 发布安排](../main-harness-portability/plan.md)

R1–R8 属于同一个重构 PR。按下列依赖在工作分支提交，R1 可与 M1 同期推进。R1 → R2 验证 MCP 视图和路由的归属，R5 → R6 → R7 验证聊天导航、草稿和订阅。R3、R4、R8 可在这两条链之间进行。在同一 PR 记录各步的提交和验收结果，最终与 Main 一起合入 `dev`。

### R1 · 全局 MCP 设置与聊天 Session 分离

**目标**：在全新 Settings 窗口打开全局 MCP 时，只初始化 MCP 功能，不初始化聊天订阅。

- [x] **依赖**：无。**删除**：`McpSettings.vue` 对 `useSessionStore`、`useAgentStore` 的直接构造，以及共享页面内从 active Session 猜目标的逻辑。默认和现有两个路由都走 global，无需 Agent。agent 范围显式接收目标 ID，必要时由该范围的调用者在保存成功后刷新相关 Agent 缓存。保留全局 master switch 和加载/保存目标变更保护；不为 agent 范围新建产品入口。

**实施顺序**

1. 沿 `settingsRouteComponents.ts → McpSettings.vue` 和 `McpPluginsPage.vue → McpSettings.vue` 分别挂载默认 global。查清 setup 里无条件构造 store 的代码，也检查渲染的子树；两侧现有路由均保留 global。
2. 把 agent 范围需要的目标 ID 和保存成功后的必要刷新交由调用者传入。global 不读取当前聊天；显式 agent 模式保持请求序号、迟到结果保护、master switch 和保存失败回显。
3. 用隔离 Pinia 和计数的 typed bridge 覆盖真实挂载、卸载、重进；允许 MCP 初始化，断言没有 chat stream 订阅。已有组件测试中 stub 了聊天 store 的部分仅作回归参考。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.renderer.ts test/renderer/components/McpSettings.test.ts
```

另外把目标 A 的请求延迟到切换 B 后返回；断言 B 仍显示自己的策略，写入针对原始目标。

**验收标准**：在全新 Pinia 与实际子树中挂载全局页面，确认 MCP 列表可用、没有聊天 Session/message store 实例和流订阅；不能只 stub 两个 store 后断言。切换 agent 范围目标再返回慢请求，只影响原目标的持久化，不覆盖当前页面。沿用 [MCP 设置用例](../../../test/renderer/components/McpSettings.test.ts)。

### R2 · 两个 MCP 路由装配同一功能视图

**目标**：聊天插件与 Settings 共用 MCP 配置实现，各自决定 market 返回位置、路由和窗口动作。

- [x] **依赖**：R1。**删除**：`McpPluginsPage.vue → settings/components/McpSettings.vue` 的跨应用实现导入，以及 MCP 共用视图内按当前 app 猜 router、market 返回位置和 onboarding 跳转的分支。把现有共用实现及实际需要的子组件归入 MCP feature；两侧现有路由入口各自适配导航、引导和窗口动作。沿用现有 MCP store/clients，同窗口只绑定一套监听。

**实施顺序**

1. 列出 `McpSettings.vue` 中 `route.query.view`、`router.hasRoute`、`continueGuidedOnboardingFromSettings` 和窗口动作，以及子视图依赖。对照两个入口现有路径、query 与返回动作。
2. 将两个入口都用的管理视图及必要子组件归入 MCP feature；分别在路由适配处读写 route/query、处理引导与返回。继续使用窗口自己的 Pinia 和 MCP client。
3. 在两处各做一次进入 market、返回管理页、触发引导；覆盖直接从 deeplink 或已有 query 打开。迁完删除聊天到 Settings 实现文件的直接 import，检查共享 feature 的传递依赖没有绕回 app 根。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.renderer.ts test/renderer/components/McpSettings.test.ts test/renderer/components/App.startup.test.ts
```

运行 `pnpm run architecture:renderer-baseline:check`；若导入数有意减少，先审查具体消除的边再更新基线。另用 Electron 分别打开两个入口复核。

**验收标准**：通过聊天插件页与独立 Settings 分别完成服务器管理、market 往返、引导与返回；路由名、deeplink 和用户可见布局保持。检查挂载/卸载后订阅数恢复，shared service 不反向导入 app。本片只消除 MCP 这条边；OCR、Remote、Nowledge 的插件详情引用单独记为存量，禁止借此搬迁无关页面。[聊天路由](../../../src/renderer/src/pages/plugins/McpPluginsPage.vue) · [Settings 路由](../../../src/renderer/settings/settingsRouteComponents.ts)

### R3 · 共用输入框的音频附件准备

**目标**：首条与后续提交使用相同的附件能力规则，同时保留两类草稿各自的模型解析和取消语义。

- [x] **依赖**：无。**删除**：`NewThreadPage.vue` 和 `useComposerSubmit.ts` 两份 `prepareFilesForCurrentModel` / `notifyUnsupportedAudioAttachments` 编排。两处保留各自选择模型和处理草稿版本的入口；提取已解析模型与文件之后的公共步骤，复用 [现有过滤函数](../../../src/renderer/src/lib/audioInputSupport.ts)。保持异步准备、取消、提交及文件顺序，main 的附件检查仍是最终裁决。

**实施顺序**

1. 并排读 `NewThreadPage.vue` 与 `useComposerSubmit.ts` 的 `prepareFilesForCurrentModel`。前者异步解析 selection，后者读取当前 selection。两者各自在入口捕获选择与文件快照。
2. 将能力查询、音频过滤、失败时原样返回及不支持提示合并为一段由两个调用者使用的逻辑；继续调用 `filterUnsupportedAudioAttachments`。保留文件选择时的过期 token 与提交时的 revision。
3. 用含音频和普通文件的同一组附件分别走首次/后续提交，再在能力查询未返回前切换模型或修改附件。核对最终发送顺序、警告与草稿内容。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.renderer.ts test/renderer/pages/NewThreadPage.test.ts test/renderer/features/chat-page/composables/useComposerSubmit.test.ts
```

把支持、不支持和查询失败三项在两种入口的结果并排记录；只测试底层过滤函数覆盖不到这一边界。

**验收标准**：在首条消息和已有会话分别覆盖支持音频、不支持音频、能力查询失败；文件、通知数量和可见模型名符合原语义。准备期间切换会话或修改附件，旧结果与旧回执不能清空新草稿。[首条消息](../../../test/renderer/pages/NewThreadPage.test.ts) · [已有会话提交](../../../test/renderer/features/chat-page/composables/useComposerSubmit.test.ts)

### R4 · 收敛 Project 快照别名

**目标**：快照刷新只有一个可调用的名字，消费者和测试都指向真正拥有版本与去重的实现。

- [x] **依赖**：无。**删除**：`project.ts` 的 `fetchProjects`、`fetchEnvironments`、`loadDefaultProjectPath`、`refreshEnvironmentData` 四个导出。`ChatTabView` 的正常/回退启动、侧栏、`EnvironmentsSettings` 和相应测试替身在同一片改用 `refreshProjectSnapshot`。

**实施顺序**

1. 用 `rg -n "fetchProjects|fetchEnvironments|loadDefaultProjectPath|refreshEnvironmentData" src/renderer test/renderer` 列出调用者与 fixtures。区分正常/回退启动、组件事件或表单回调，保留各自原有调用时机。
2. 将这些调用改为 `refreshProjectSnapshot`，检查事件包装器传入的参数仍符合 `minVersion` 约定。删除四个别名及 store 返回字段，把 mock 改成同一个快照操作。
3. 并发触发两次刷新、切换项目、触发 fallback 初始化；验证列表仍按版本提交，同一输入不会启动两次等价加载。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.renderer.ts test/renderer/stores/projectStore.test.ts test/renderer/components/ChatTabView.test.ts test/renderer/components/EnvironmentsSettings.test.ts
```

复跑旧名字搜索确认生产与测试没有残留；全局改名后仍要验证快照去重和默认目录内容。

**验收标准**：快照仍按版本合并、并发去重；两种启动路径、打开侧栏和设置页刷新均可取得正确的 project/environment/default path。首屏 Session 加载时机不变；生产和 fixtures 都无旧别名引用。[快照所有者](../../../src/renderer/src/stores/ui/project.ts) · [快照测试](../../../test/renderer/stores/projectStore.test.ts)

### R5 · 聊天窗口统一处理会话激活与导航

**目标**：一个窗口只有一份激活意图序号；Session 投影更新、Agent 选择与路由跳转不会接受过期结果。

- [x] **依赖**：无。**删除**：`stores/ui/session.ts` 中 `selectSession`、`closeSession`、`startNewConversation` 和 `sessionIpc` 激活/失活回调内重复的“清流、切选择、加载摘要、跳转”。让聊天窗口持有一份导航请求序号；本地操作、引用跳转、定向 IPC 和创建会话的迟到回执都遵守同一个过期判定。迁移侧栏、快捷键、Spotlight、消息引用等实际调用者。Store 留可复用的列表和 active-summary 操作。

**实施顺序**

1. 把本地 select/close/startNewConversation、`sessionIpc` 的定向 activated/deactivated、带 incarnation 引用的 validate→activate 和 create 回执列成入口表。标出在哪些 await 前发号、在哪些 await 后检查 request ID 或 webContents。
2. 聊天窗口编排持有一个序号并连接投影、消息、草稿与路由。已有创建流程即使在 R6 前也须使用这同一意图判定；定向 IPC 早于 webContents ID 就绪的暂存/清理仍由原绑定处理。
3. 按调用者迁移侧栏、快捷键、Spotlight、消息卡片和启动入口。测试先发 A 后发 B，让 A 最后返回；再测试 A 校验途中关闭。两种情况下只允许最新意图改变路由和选中值。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.renderer.ts test/renderer/stores/sessionStore.test.ts test/renderer/components/ChatTabView.test.ts test/renderer/stores/spotlight.test.ts
```

在两个窗口重复激活/失活操作并记录各自的最终 route 和 active ID，另一窗口不能被错误导航。

**验收标准**：A 的慢加载晚于选择 B 或关闭，不得导航回 A；其他 webContents 的激活不会改变本窗口。快速切换、引用 incarnation 失效、窗口尚未解析 ID、同一请求收到命令回执与 IPC 通知时，最终选择、Agent 和路由一致。启动成功/回退仍按原顺序只取一次首屏列表。[定向事件](../../../src/renderer/src/stores/ui/sessionIpc.ts) · [窗口启动](../../../test/renderer/components/ChatTabView.test.ts)

### R6 · 提交与草稿恢复由聊天功能编排

**目标**：发送接纳、局部乐观回显和首次引导分别由正确的所有者处理；迟到结果不会吞掉新草稿。

- [x] **依赖**：R5。**删除**：`session.ts#createSession/sendMessage/completeOnboardingStep` 内的页面跳转、草稿恢复和首次聊天引导调用。将其调用者连同动作迁到聊天功能；持久快照仍由 Session 投影提交，消息/草稿各自处理局部反馈。采用服务端已落盘但前端回执失败的旧草稿时，继续按既有规则查询并恢复。

**实施顺序**

1. 从 `session.ts#createSession` 区分持久创建、无初始消息、附件待处理、已接纳首轮和创建回执失败后找回会话。记录“始终提交持久列表条目”与“仍为当前导航时才跳转”的分界。
2. 在聊天功能编排里复用 R5 的序号，并保持 submissionId、取消信号、`stageInitialDraftRecovery` 和草稿 revision。已有会话发送用原先的取消回滚或失败状态；引导只在原有成功条件下推进。
3. 迁移首条发送和后续发送调用者后，删除 Session store 对聊天页面、草稿恢复、onboarding 的相关编排。模拟提交 A 后输入 B，再延迟返回 A 的成功、取消与失败结果。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.renderer.ts test/renderer/stores/sessionStore.test.ts test/renderer/components/NewThreadPage.onboarding.test.ts test/renderer/features/chat-page/composables/useComposerSubmit.test.ts
```

上述三条回执均不能丢失 B；已创建的会话只出现一次。附件受阻时能从原草稿重试，不触发已接纳才应执行的引导。

**验收标准**：首条消息被接纳、只创建草稿、附件阻塞、取消、服务端已创建但响应失败分别保留现有行为；用户离开后仍提交持久会话列表条目，但不抢回焦点。已有会话保留乐观状态与取消回滚，发送失败仍可重试。首次聊天引导按原回执触发；队列、steer、重试与后续新草稿互不覆盖。[会话状态用例](../../../test/renderer/stores/sessionStore.test.ts) · [提交用例](../../../test/renderer/features/chat-page/composables/useComposerSubmit.test.ts)

### R7 · 聊天订阅与跨投影清理由窗口绑定

**目标**：单独读取 Session 列表不会建立聊天消息运行态；聊天窗口只注册一套可回收的监听。

- [x] **依赖**：R5、R6。**删除**：创建 Session 投影时顺带创建消息、草稿、路由、附件恢复或 delegation store 的剩余依赖。重点迁出 `removeSessions`、数据库替换/刷新、活跃会话清空/删除与消息缓存失效的跨 store 副作用。用既有 `sessionIpc`、`messageIpc` 在窗口生命周期内各绑定一次。Session 投影仍负责自己的版本/分页失效；消息的 request tombstone 保留在 `messageIpc`。

**实施顺序**

1. 梳理 `session.ts` 创建时构造的关联 store，及 `bindSessionStoreIpc` / `bindMessageStoreIpc` 的 current-session、缓存和永久删除回调。区分暂时切换、清空消息、永久删除和数据库替换。
2. 让聊天窗口在可取得目标窗口身份的生命周期绑定/清理跨投影副作用。保留提前到达事件的等待逻辑和每个 request 的 tombstone；列表 store 只处理自己的快照、分页与版本。
3. 挂载/卸载两次记录安装与注销数。令旧列表请求在 DB 替换后才到达，再向已结算 request 发送旧帧，检查两类过期数据都被拒绝；永久删除后与该会话有关的跟踪释放。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.renderer.ts test/renderer/stores/messageIpc.test.ts test/renderer/stores/messageStore.test.ts test/renderer/stores/sessionStore.test.ts
```

在纯列表消费者和真实聊天窗口分别统计监听，前者无聊天流监听、后者重进不叠加。E2E 复用 `36-chat-streaming`，双窗口错投另外实测。

**验收标准**：只读列表不会创建消息运行态；重开数据库不能合并旧请求返回的列表。删除/清空当前会话时，路由、消息、缓存和持久事实保持一致；另一个窗口的迟到帧不复活旧消息。重挂载和销毁能回收监听，关闭一个窗口不会取消另一个窗口的运行。[消息事件用例](../../../test/renderer/stores/messageIpc.test.ts) · [应用启动](../../../test/renderer/components/App.startup.test.ts)

### R8 · 删除无调用的消息占位组件

**目标**：只删除确认无消费者的旧组件，保留聊天列表真实的骨架和虚拟化行为。

- [x] **依赖**：无。**拟删文件**：`MessageItemPlaceholder.vue`。在当前目标分支复查显式/动态 import、Vue 标签两种拼写、组件注册、模板、fixtures 与构建入口；发现活跃调用就把该项移出删除片。

**实施顺序**

1. 从 `MessageItemPlaceholder.vue` 以及标签名的 PascalCase、kebab-case 查找生产、测试和模板引用；检查动态注册、自动解析和 Vite 构建入口。
2. 只剩组件自身和文档报告时删除，发现调用者时在 PR 记录来源并保留。清理受维护文档里的失效链接。滚动长历史、切换会话后返回，检查实际加载与缓存恢复。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.renderer.ts test/renderer/composables/useMessageVirtualization.test.ts test/renderer/components/ChatPage.test.ts
```

记录该文件的最终处理理由。虚拟列表滚动和恢复至少在一次真实 Chromium 渲染中检查，jsdom 的尺寸不能作为唯一证据。

**验收标准**：聊天列表的真实加载、虚拟化与历史恢复仍工作，无悬空导入或失效 fixture。保留有实际调用的骨架组件和历史消息显示分支。

## Renderer 联合验收

- [ ] 每片实施后审阅受影响的窗口、路由、异步取消、卸载和 IPC 调用者。选择该片最小行为套件；只有现有用例未覆盖具体回归时才补测试。运行 format、i18n、lint、typecheck，以及 `pnpm run architecture:renderer-baseline:check`。实际减少受限导入时同步刷新并审阅基线明细。
- [ ] 在最终候选提交上，从干净的 Chat 与 Settings 窗口验证 MCP、首条与后续发送、草稿恢复、快速切换和迟到流。用真实 Electron 多窗口验证 sender/target 并记录平台。核对移除的依赖、别名、重复监听及清理候选，结果纳入同一 PR 的合并门槛。
