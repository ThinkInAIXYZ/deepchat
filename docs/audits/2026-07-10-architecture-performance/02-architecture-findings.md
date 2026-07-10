# 02 - 架构、边界与生命周期问题

## 当前真实主链路

```text
Renderer view/store
  -> renderer/api client
  -> preload deepchat bridge
  -> shared route registry + Zod
  -> routes/index.ts
       |  contract dispatcher
       |  第二个 composition root
       |  Cron / memory / database-security 等 domain policy
       |-> 少量 Session/Chat/Provider service -> nominal port -> Presenter
       `-> 大量完整 Presenter / concrete SQLite table / Electron API

Main owner
  -> module-global typed event publisher
  -> WindowPresenter
  -> all windows/tabs or targeted webContents
```

这与 [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) 描述的目标方向一致，但并没有完成其
“route services 只通过窄 port 使用 presenter”的长期状态。

---

## A-01 [高][已确认] typed route 已演化成第二个 composition root

### 代码真相

- [`routes/index.ts`](../../../src/main/routes/index.ts#L725) 当前 4,351 行。
- `dispatchDeepchatRoute` 从 [L1524](../../../src/main/routes/index.ts#L1524) 到 L4330，单函数
  2,807 行；AST 统计有 349 个 `*Route.name` case。
- `createMainKernelRouteRuntime` 接收完整 Presenter 图，并在
  [L755-L776](../../../src/main/routes/index.ts#L755) 只为 session/chat/provider 建 service/port。
- 同一个工厂随后直接装配 Cron session policy
  ([L778-L860](../../../src/main/routes/index.ts#L778))，其他 route 也直接访问完整 presenter、
  memory helper 和 concrete SQLite 能力。
- [`Presenter`](../../../src/main/presenter/index.ts#L1042) 再把同一套依赖图整体打包给 route
  runtime，因此它不是单纯 dispatcher，而是第二个 composition root。

### 意图核验

初始提交 `8ef5c858` 明确写了“不做 full main-kernel rewrite”，minimum ports 文档还明确把
browser、workspace、exporter、remote 等排除在当期 port 化范围外。初始增量方案是合理取舍，
不能反推为设计错误。

偏离发生在签收之后：`routes/index.ts` 从初始约 1,447 行增长到 4,351 行，2026-03-01 以后有
43 个 commit 继续触达；新 domain 默认继续落进同一文件，而没有 size、concrete dependency、
table reach-through guard。

### 判断与影响

这是已确认的 owner/变更放大问题，不是已确认的启动性能问题。349-case switch 本身并不值得优化；
问题是 contract dispatch、dependency assembly 和 domain orchestration 同处一文件，任何新 feature 都会
扩大 fixture、review context 和跨域冲突。

### 建议

- 按 domain 建 registry/handler；根文件只保留 contract lookup、context、统一 error envelope。
- Cron、memory、database-security 的 policy 下沉到 domain owner。
- 增加 route → concrete presenter/table import、LOC/case 数的趋势 guard；不要一次性重写全部 route。

---

## A-02 [高结构债][已知且故意延期] Agent runtime/session 已成为 God object

### 代码真相

- [`AgentRuntimePresenter/index.ts`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L614)：
  7,350 行、209 个 class method；`runStreamForMessage` 654 行、`processMessage` 392 行。
- [`AgentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L280)：
  4,201 行、146 个 class method。
- runtime 目录已经有 message store、Tape、compaction、context、pending input 等 23 个协作者，
  说明项目本身认可继续提取 collaborator 的 seam。
- 自 2026-03-01 以来 runtime 主文件被 73 个 commit 触达，session 主文件被 25 个 commit 触达。

### 意图核验

现有 [`agent-runtime-presenter-split/spec.md`](../../architecture/agent-runtime-presenter-split/spec.md)
已经准确描述该债务，并要求 façade 小于 1,000 行；
[`tasks.md`](../../architecture/agent-runtime-presenter-split/tasks.md) 显示 T2-T7 尚未开始。
该 proposal 创建时文件约 5,682 行，现在已经增长 1,668 行。文档还明确要求先拆 runtime，再拆
session，因此这是已知延期，不是新发现或“没人设计”。

### 判断与影响

当前最危险的不是行数，而是共享 mutable maps、turn runner、message/tape/pending/tool permission
共同留在一个 owner，提取时容易改变时序。原 proposal 的“先 state ownership、再一服务一 PR、turn
runner 最后”仍是正确顺序。

### 建议

恢复已有 proposal，不另建平行重构方案；先冻结主文件新增责任，再按已有 T2-T7 执行。

---

## A-03 [高][已确认] shared compatibility barrel 已破坏 shared → main 单向边界

### 代码真相

- [`src/shared/presenter.d.ts`](../../../src/shared/presenter.d.ts#L1) 明示是 compatibility stub。
- [`presenters/index.d.ts`](../../../src/shared/types/presenters/index.d.ts#L158) 全量 re-export
  2,592 行的 `core.presenter.d.ts`；当前 292 个 source/test 文件依赖 `@shared/presenter`。
- [`core.presenter.d.ts`](../../../src/shared/types/presenters/core.presenter.d.ts#L2019) 从
  `@/presenter/configPresenter/shortcutKeySettings` 反向导入 main 实现类型。`@/*` 在 node 和 web
  tsconfig 中分别指向 main 与 renderer，同一 shared declaration 的含义随 consumer 改变。
- 文件中还有 repo-owned 声明错误：错误相对路径
  ([L2009-L2017](../../../src/shared/types/presenters/core.presenter.d.ts#L2009))、未导入的
  `LifecyclePhase` ([L2503](../../../src/shared/types/presenters/core.presenter.d.ts#L2503))、
  [`presenters/index.d.ts`](../../../src/shared/types/presenters/index.d.ts#L56) 导出不存在的
  `search.presenter` 等。
- 常规 web typecheck 通过；对 repo declaration 显式关闭 `skipLibCheck` 后，上述错误会被报告。

### 意图核验

[`pr1765-final-cleanup/spec.md`](../../issues/pr1765-final-cleanup/spec.md) 允许 broad compatibility
types 暂留，目标是先完成 transport migration。因此 barrel 本身是故意的 quarantine。

问题是 quarantine 没有冻结：`core.presenter.d.ts` 从迁移时约 2,541 行继续增长到 2,592 行，且新增
feature 仍修改它；常规 typecheck 又无法验证仓库自己拥有的 `.d.ts`。

### 判断与影响

typed route 的 runtime schema 仍有效；这里不是 transport 被绕过，而是 compile-time ownership
混乱。它会让 shared contract 看似稳定、实际依赖 main 路径，并让声明错误长期潜伏。

### 建议

1. 先增加只检查 repo-owned shared declarations 的 `skipLibCheck=false` job。
2. 把 `ShortcutKey*` 等 domain type 移到 shared 真正 owner。
3. 冻结 `core.presenter.d.ts` 新增 export，按 domain 提取；不要再建第二个 compatibility barrel。

---

## A-04 [高可靠性][已确认] Scheduler timeout 是 deadline race，不是 cancellation

### 代码真相

- [`TimeoutInput`](../../../src/main/routes/scheduler.ts#L9) 接收已经启动的 `Promise<T>`，task 无法
  获得 timeout signal。
- [`timeout()`](../../../src/main/routes/scheduler.ts#L91) 只是 `Promise.race`；finally 中 abort 的是
  delay timer，不是底层 operation。
- [`retry()`](../../../src/main/routes/scheduler.ts#L106) 也不等待失败/超时 operation 真正停止。
- mutation 直接使用这层：session create
  ([`SessionService`](../../../src/main/routes/sessions/sessionService.ts#L27))、activate/deactivate，
  再由 [`hotPathPorts`](../../../src/main/routes/hotPathPorts.ts#L112) 原样转发。
- restore 对 `get` 做 5 秒 timeout 后 25ms 再试一次
  ([L47-L58](../../../src/main/routes/sessions/sessionService.ts#L47))；上一轮可能仍在运行。

### 可达后果

session create 会先写记录、再 await runtime 初始化、绑定 webContents 并发事件
([`createSession`](../../../src/main/presenter/agentSessionPresenter/index.ts#L315))。如果后半段超过
5 秒，client 已收到 `TimeoutError`，底层仍可稍后成功并激活 session，形成“失败响应 + 成功副作用”的
unknown outcome。同步 better-sqlite3 阻塞期间，Promise race 甚至没有机会及时触发。

### 意图核验

`8ef5c858` 的 Scheduler 文档把统一 timeout/retry/cancel 与 cleanup ownership 列为目的；现有接口示例
本身却已经选择 `task: Promise<T>`。这说明抽象目标和接口能力从第一版就冲突，没有证据表明 mutation
故意采用 at-least-once/unknown-outcome 语义。

### 测试缺口与建议

[`scheduler.test.ts`](../../../test/main/routes/scheduler.test.ts#L4) 只断言 caller 收到 timeout；
没有断言底层停止。应先用 deferred mutation 复现晚成功，再决定：

- 可取消 operation 使用 `task(signal) => Promise<T>` 并由 owner 处理 rollback/settlement；
- 不可取消 mutation 不应伪装成确定失败，应返回 operation id/unknown outcome 并支持 reconciliation；
- retry 前必须确认上一 attempt 已终止或 operation 幂等。

---

## A-05 [高可靠性][已确认且部分故意] unavailable session 被伪装成 missing session

### 代码真相

- [`buildSessionWithState`](../../../src/main/presenter/agentSessionPresenter/index.ts#L2609) 解析 agent
  和 runtime state。
- [`tryBuildSessionWithState`](../../../src/main/presenter/agentSessionPresenter/index.ts#L2668)
  catch 所有异常，返回 `null as unknown as SessionWithState`，但签名谎称不返回 null。
- public [`getSession`](../../../src/main/presenter/agentSessionPresenter/index.ts#L1121) 因此不能区分
  DB record 不存在、agent 永久禁用和 state 暂时读取失败。
- [`getActiveSession`](../../../src/main/presenter/agentSessionPresenter/index.ts#L1889) 收到 null 会直接
  unbind window；`SessionService.restoreSession` 又把 null 当作 missing 并返回空 message page。
- 现有测试明确保护“不可用 agent 时列表跳过、get 返回 null、active binding 解除”的行为。

### 意图核验

`72dc7e5d` 引入 fallback 时，返回类型还是正确的 `SessionWithState | null`，目的是单个不可用 agent
不拖垮整个 UI；`f0a91b77` 后才出现 unsafe cast。容忍永久不可用 agent 是有意的，不能简单删 catch。

冲突是：暂时性 runtime error 也被当成不存在，导致 Scheduler retry 看不到 error，并且真实 binding
被破坏。

### 建议

引入明确状态，例如 `available | unavailable | transient_error | missing`；list 可以降级显示 unavailable，
但不应通过 null 删除持久化 identity 或 binding。修复前先固化恢复语义测试。

---

## A-06 [高可靠性][已确认过度兜底] network UX handler 吞掉所有 fatal exception

### 代码真相

- [`appMain.ts`](../../../src/main/appMain.ts#L46) 注册 `process.on('uncaughtException')`。
- handler 对所有异常只 log；只有字符串像 network error 时发 toast，但非 network exception 也不会
  rethrow、controlled shutdown 或 relaunch。
- 注册 listener 后，Node 默认 fatal 行为被替换；进程可能在 invariant 已损坏时继续工作。
- `unhandledRejection` 同样只 log ([L72](../../../src/main/appMain.ts#L72))。

### 意图核验

这段逻辑最早随 2026-05-25 的 `746e5c69` 进入 `appMain.ts`，注释和代码目的都是“避免 network
error dialog 并显示 toast”。没有测试或 spec 证明团队有意把所有 programming error 定义为可恢复。
局部 UX 需求扩大成了进程级 fail-open。

### 建议

已知 network error 在请求 owner 处理；顶层 handler 只负责最后日志/telemetry 和 controlled exit/relaunch。
至少增加一个非 network uncaught path 测试，明确进程策略。

---

## A-07 [中][已确认] HooksNotifications 构造两次，runtime bridge 永远绑定 dummy 实例

### 代码真相

- [`Presenter`](../../../src/main/presenter/index.ts#L483) 先构造一个 `getSession/getMessage` 永远返回
  null 的 `HooksNotificationsService`，再把它传给 `NewSessionHooksBridge`。
- bridge readonly 保存 dispatcher
  ([`newSessionBridge.ts`](../../../src/main/presenter/hooksNotifications/newSessionBridge.ts#L23))。
- AgentRuntime 在 [L632-L647](../../../src/main/presenter/index.ts#L632) 获得该 bridge。
- AgentSession 创建完成后，[L677-L681](../../../src/main/presenter/index.ts#L677) 用真实 deps 创建第二个
  service 并覆盖 property，但旧 bridge identity 不变。
- 真 service 的 fallback enrichment 会在字段缺失时读 session/message
  ([`hooksNotifications/index.ts`](../../../src/main/presenter/hooksNotifications/index.ts#L223))；runtime
  bridge 永远无法使用这层 fallback。

### 意图核验

`a44ead3e` 明确把 dummy-first/reassign 作为 constructor cycle workaround。这是故意解决初始化顺序，
但遗漏了对象 identity。多数 runtime dispatch 当前显式传 provider/model/projectDir/prompt，因此不能夸大成
“hooks 全坏”；已确认的是 fallback 永久失效和 cycle 被 temporal wiring 掩盖。

### 建议

使用 late-bound dispatcher ref/setter，或两阶段 builder + explicit `seal()`；加真实 Presenter factory
identity test。不要再构造第二个同名 service。

---

## A-08 [中][已确认] event 文档、真实 transport 与 ambient lifecycle 不一致

### 代码真相

- [`event-system.md`](../../architecture/event-system.md) 仍声称 EventBus 拥有
  `sendToRenderer*`、`sendToWebContents`、`sendToTab` 等 API。
- 当前 [`eventbus.ts`](../../../src/main/eventbus.ts#L1) 只有 process-local `sendToMain()`。
- renderer transport 实际由 [`publishDeepchatEvent.ts`](../../../src/main/routes/publishDeepchatEvent.ts#L10)
  的 module-global WindowPresenter sink 完成；约 43 个 main 文件、127 个调用点依赖该 ambient service。
- sink 到 [`Presenter.setupEventBus`](../../../src/main/presenter/index.ts#L725) 才设置；此前发布只 warn/drop。
- `appMain` 在 Presenter 创建前先 `createRun('main')`
  ([L166-L173](../../../src/main/appMain.ts#L166))，coordinator 会立即发布初始 snapshot
  ([`publishSnapshot`](../../../src/main/presenter/startupWorkloadCoordinator/index.ts#L372))，该 snapshot
  必然发生在 sink 安装前。

### 意图核验

`32bacc5f` 同一个 commit 同时删除 EventBus renderer API、引入 typed publisher、重写文档，所以文档不是
后来漂移，而是迁移说明当时就没有与实现对齐。best-effort event + query/replay 可能是可接受策略；
[`acp-startup-notification-order/spec.md`](../../issues/acp-startup-notification-order/spec.md) 也说明团队知道
早期事件顺序问题，但选择局部修复。

### 建议

先修文档；给 event 标注 `ephemeral | replayable | durable`。若 startup snapshot 可 query/replay，则明确
允许首个 drop；否则在 bootstrap 前注入 sink 或 buffer。长期用 `WindowEventPort` 注入替代 module-global
locator。

---

## A-09 [中][已确认 lifecycle gap] shared FileWatcher utility 没有生产 teardown owner

### 代码真相

- [`watcherService.ts`](../../../src/main/lib/fileWatcher/watcherService.ts#L27) 建立 process-global singleton；
  只有 test reset 调 `destroy()`。
- Workspace 和 Skill 默认共享它
  ([`WorkspacePresenter`](../../../src/main/presenter/workspacePresenter/index.ts#L108)、
  [`SkillPresenter`](../../../src/main/presenter/skillPresenter/index.ts#L245))。
- consumer destroy 只 close handles/cache，不调用 shared service destroy。
- [`WatcherPool.unwatch`](../../../src/main/lib/fileWatcher/watcherPool.ts#L158) 在最后一个 listener 关闭后
  只发 unwatch；不会 shutdown client。真正 kill 只在 pool `destroy()`。
- utility host 有显式 keep-alive interval
  ([`fileWatcherUtilityHost.ts`](../../../src/main/lib/fileWatcher/fileWatcherUtilityHost.ts#L95))。

### 意图核验

共享 pool 是有意减少 watcher/process 数；但提供了完整 destroy chain，却没有生产 owner，说明 lifecycle
没有闭环。可以确认“最后一个 watch 关闭后 host 继续常驻直到 app 进程退出”；不能在无 RSS/profile 时
声称它造成严重内存或退出卡顿。

### 建议

由 Presenter/LifecycleContext 持有 singleton 并在最终 teardown shutdown；或者 pool 在 content/git 两类
active request 都为 0 后 idle-stop，并允许后续重启。

---

## A-10 [高语义/中性能][已确认] `whenIdle()` 不是 idle barrier，pending cancel 泄漏 record

### 代码真相：假 idle

- [`isIdle()`](../../../src/main/presenter/startupWorkloadCoordinator/index.ts#L144) 要求 pending=0 且
  CPU/IO running=0。
- [`whenIdle()`](../../../src/main/presenter/startupWorkloadCoordinator/index.ts#L215) 在非 idle 时只排一个
  `background/io` task。
- pump 只要 IO lane 有空位就会启动它；IO concurrency 为 2
  ([L72-L75](../../../src/main/presenter/startupWorkloadCoordinator/index.ts#L72))。因此 callback 可以在 CPU
  task 或另一条 IO task 仍运行时开始。
- 唯一生产调用把它命名为 `main:provider-warmup-idle`
  ([`Presenter`](../../../src/main/presenter/index.ts#L839))，实际会遍历全部 enabled providers。

`752286fd` 的原 startup plan 明确要求“只在 coordinator idle 后触发”，所以不是故意把 idle 定义为
“有 IO lane”。

### 代码真相：cancel record

- [`cancelTarget`](../../../src/main/presenter/startupWorkloadCoordinator/index.ts#L109) 对 pending task
  remove/reject，却不调用 `finishTask()`。
- `inFlightByDedupeKey.delete()` 只在
  [`finishTask`](../../../src/main/presenter/startupWorkloadCoordinator/index.ts#L346)；pending task 永远不会
  start，因此 record 会留在 map。runId 在 key 中，主要后果是内存保留而非错误去重。

### 建议

实现真正 barrier/waiter，并明确“等待开始后新任务是否属于同一 idle generation”；pending/running cancel
统一走一条 settlement/cleanup。测试同时挂起 CPU + 2 IO，确认 callback 在全部 settle 后才开始；反复
create/cancel settings run，断言内部 record 不增长。

---

## A-11 [中治理缺口][已确认] architecture guard 的覆盖面小于其名称暗示

### 代码真相

- [`architecture-guard.mjs`](../../../scripts/architecture-guard.mjs) 对 raw renderer IPC、retired legacy
  transport、若干 agent hot edge 的规则有效，本轮执行通过。
- main global Presenter ban 只覆盖少量 hardcoded agent path；hot-edge baseline 也只比较六个文件。
- 4,351 行 route runtime、shared → main reverse import、FileWatcher lifecycle、AgentToolRuntimePort 的
  扩张均不在 guard graph 中。

### 判断

不能说 guard 无用；它成功保护的是 transport migration 和指定 hot path。问题是
[`ARCHITECTURE.md`](../../ARCHITECTURE.md) 的整体叙述比 guard 实际覆盖更广，容易把“guard 通过”误读为
“整体 main architecture 没有回流”。

### 建议

把 guard 名称/输出拆成 transport、agent-edge、main-composition 三部分；新增趋势规则时先建立 baseline，
不要一次性把现存债务变成全仓红灯。

---

## A-12 [中/待决策] Workspace security capability 没有明确 scope 与 revoke 语义

### 代码真相

- [`WorkspacePresenter`](../../../src/main/presenter/workspacePresenter/index.ts#L101) 注释把 register 称为
  security boundary；实际 `allowedPaths` 是 process-global Set。
- route 本来有 webContents context，但 workspace register/unregister case 没使用 caller identity。
- renderer 切换/卸载 workspace 只 unwatch，不 unregister；生产 renderer 没有调用 unregister。
- 因此 app lifetime 内打开过的 workspace 会继续留在 allowed set；`destroy()` 也不 clear allowedPaths。

### 意图核验

历史 `b47e5e0e` 故意拆开 register 与 watch，可能就是为了 panel 关闭后 session/@mention 仍能读取文件。
仓库证据无法确认 capability 目标是 app、session 还是 webContents scope，所以这里不能直接定性为安全漏洞。

### 需要的决策

- 如果 scope 是 app lifetime：文档不要称它为可撤销的 security boundary，应明确所有同进程 renderer
  共享信任。
- 如果 scope 是 session/webContents：加入 refcount 和 destroyed/deactivate revoke。

---

## A-13 [低性能][已确认] window binding map 保留每个历史 webContents id

[`NewSessionManager`](../../../src/main/presenter/agentSessionPresenter/sessionManager.ts#L36) 用
`Map<number, string | null>`；[`unbindWindow`](../../../src/main/presenter/agentSessionPresenter/sessionManager.ts#L227)
写入 null 而不是 delete。没有 window-destroyed 清理入口，长期反复创建 renderer 会线性保留 number key。

这是小对象级泄漏，当前不值得高优先级；改动前要确认 null 是否有“显式解绑”与“从未绑定”的语义差异。
