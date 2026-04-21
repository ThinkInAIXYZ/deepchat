# Startup Orchestration 规格

## 概述

本轮规格把启动优化从“继续多挪一些 deferred”收敛成“把 deferred 背后的 main 负载拆成可调度、可取消、可观测、必要时 off-main 的工作流”。

目标固定为两条主线：

1. 主窗口和 settings 都使用 staged hydration，先给用户可交互骨架，再按 section 渐进补齐。
2. main 进程中会持续占满事件循环的初始化逻辑统一接入 coordinator；纯 Node/FS/parse 的重活迁到 `worker_threads`；仍必须留在 main 的 Electron 绑定任务改为低并发、分批让出事件循环。

## 当前决策

本规格以 2026-04-21 的 Startup Main-Unblocking V3 决策为准：

1. main-side `StartupWorkloadCoordinator` 统一管理启动任务。
2. workload phase 固定为 `interactive -> deferred -> background`。
3. workload resource 并发固定为 `cpu = 1`、`io = 2`。
4. main window 保持 `bootstrap + staged session hydration`，provider/model warmup 只在 on-demand 或 coordinator idle 后执行。
5. settings window 首屏只加载 cheap snapshot、router ready、provider summaries；heavy tabs 按路由进入再 hydration。
6. `models.getProviderCatalog` 改为内存快照优先，`ModelStatusHelper` 改为 snapshot-first。
7. `SkillPresenter` manifest discover 和 `SkillSyncPresenter` scan/compare 迁到 `worker_threads`，失败时回落主线程路径。
8. `startup.workload.changed` 作为统一 typed event 回推 renderer readiness。

## 背景

上一轮 deferred 已经减少了首屏直接阻塞，但 main 进程依然存在两个核心问题：

1. deferred 任务虽然“晚一点跑”，但仍可能在一个时间窗内把 main 事件循环打满。
2. settings 打开时仍然会顺手拉起过多 provider/model/ollama/skills/mcp/remote 相关初始化，导致整窗冻结感。

实际问题不再是“有没有 deferred”，而是：

1. deferred 是否被拆成可调度、可取消、可观测的 workload。
2. CPU/parse/scan 类工作是否已经离开 main。
3. 仍在 main 的工作是否低并发、可中断、分批 yield。

## 目标体验

```text
Main Window
+ chat shell ready
+ agent/bootstrap ready
+ session sidebar skeleton
+ provider/model regions hydrate on demand or during idle

Settings Window
+ shell/nav ready
+ cheap settings snapshot ready
+ provider summaries ready
+ provider/models/skills/mcp/remote hydrate by route task events
```

## 用户故事

### US-1：主窗口先交互，再补内容

作为用户，我希望主窗口出现后立刻可以进入 new thread 或 active chat，而不是等待 provider/model warmup 抢占 main。

### US-2：settings 先出框架，再补 section

作为用户，我希望打开 settings 时先看到可用的 shell、导航和 summaries，而不是整窗白屏或冻结。

### US-3：后台任务有明确进度与取消边界

作为用户，我希望重任务能渐进完成；关闭 settings 时，settings 专属 warmup 不应继续偷偷占用 main。

### US-4：重 CPU/parse 工作不再阻塞 main

作为用户，我希望 skills discover / sync scan 这类纯 Node 工作在后台线程里完成，不影响主窗口输入和切换。

## 功能范围

本轮范围覆盖：

1. `StartupWorkloadCoordinator` 与 typed startup workload event。
2. 主窗口 provider/model warmup 的 on-demand + idle backfill 策略。
3. settings staged hydration 与 summary-first 路径。
4. `providers.listSummaries` 精简 route。
5. `models.getProviderCatalog` memory-snapshot-first 路径。
6. `ModelStatusHelper` persisted snapshot。
7. `SkillPresenter` discovery worker。
8. `SkillSyncPresenter` scan/discovery worker。
9. `docs/specs/startup-orchestration/` 同步到 V3。

## 功能要求

### A. Main-side Startup Coordinator

- main 侧必须存在统一的 `StartupWorkloadCoordinator`。
- coordinator 负责：
  - 任务注册
  - phase 优先级调度
  - `cpu/io` 并发限制
  - yield 控制
  - 按 target/run 取消
  - workload 状态事件推送
- phase 固定为：
  - `interactive`
  - `deferred`
  - `background`
- 资源并发固定为：
  - `cpu = 1`
  - `io = 2`

### B. Presenter.init 注册方式

- `Presenter.init()` 不再散射式 `void initializeXxx()` fire-and-forget。
- 以下任务统一注册到 coordinator：
  - floating button
  - yo browser
  - skills init
  - skill sync scan
  - MCP init
  - remote runtime init
  - idle provider warmup

### C. Window/Target 取消边界

- settings window 创建时创建或复用 `settings` startup run。
- settings window ready 时可以 replay 现有 workload snapshot。
- settings window 关闭时，`target = settings` 的未完成任务必须取消。
- main window task 与 settings window task 必须在 coordinator 里分 target 管理。

### D. Startup Workload Typed Event

- 新增 typed event：`startup.workload.changed`
- payload 固定包含：
  - `startupRunId`
  - `target`
  - `tasks`
- shared task ids 固定覆盖：
  - `main.bootstrap`
  - `main.session.firstPage`
  - `main.provider.warmup`
  - `settings.providers.summary`
  - `settings.provider.models`
  - `settings.ollama`
  - `settings.skills.catalog`
  - `settings.skills.syncScan`
  - `settings.mcp.runtime`
  - `settings.remote.runtime`

### E. Settings Summary-first Hydration

- settings `onMounted` 只做：
  - `uiSettingsStore.loadSettings()`
  - router ready
  - `providers.listSummaries`
  - startup workload subscription
- settings open 时移除 eager：
  - `modelStore.initialize()`
  - `ollamaStore.initialize()`
- `settings-provider` 路由进入后再 `ensureProviderModelsReady(providerId)`。
- Ollama 仅在命中对应 provider detail 时加载。
- `skills/mcp/remote` 仅在进入各自页面后才触发 hydration。

### F. Main Window Provider Warmup Policy

- `startup.provider.warmup.deferred` 不得在 interactive 后立刻无条件触发全量 sweep。
- provider/model warmup 允许两个入口：
  - 用户进入依赖 provider/model 的具体 UI
  - coordinator idle 后进行低优先级 backfill
- idle backfill 必须：
  - low priority
  - 可取消
  - 每个 provider 之间显式 yield

### G. Summary Route 与 Memory Snapshot

- 新增 `providers.listSummaries` route。
- settings 首屏只依赖 provider summaries，不带模型数组。
- `models.getProviderCatalog` 保持存在，但改为：
  - provider models
  - custom models
  - db provider models
  - model status map
  的 memory-snapshot-first 返回。

### H. Model Status Snapshot

- `ModelStatusHelper.getBatchModelStatus(...)` 不再频繁直接命中持久层。
- 首次访问时构建内存 status snapshot。
- 后续批量读取走内存查表。
- `setModelStatus/deleteModelStatus` 同时更新：
  - 内存 snapshot
  - 持久层

### I. Chunked Main Tasks

- 仍在 main 的批量任务禁止长时间同步 for-loop 跑完整表。
- 批量任务必须分批推进，并在批次间 yield。
- 本轮至少保证：
  - provider idle warmup 逐 provider yield
  - MCP / remote 等 background init 不和 interactive 抢同一时段资源

### J. Off-main Workers

- 明确迁到 `worker_threads` 的任务：
  - `SkillPresenter` manifest discover / parse
  - `SkillSyncPresenter` external tool scan / compare
- worker 输入输出必须是 JSON serializable 数据。
- worker 失败时必须回落主线程路径，不影响应用可用性。
- 本轮不把 MCP runtime / remote runtime 迁出 main；它们仍走 coordinator。

## 非目标

1. 本轮不新增新的 legacy IPC。
2. 本轮不把 MCP runtime / remote runtime 切到 `utilityProcess`。
3. 本轮不重写 provider store 整体架构。
4. 本轮不追求“完全无 loading”，而是明确 skeleton / section-ready。

## 约束

1. 继续保持 typed route / typed event 方向一致。
2. settings 与 main 必须共享同一套 startup workload contract，而不是两套启动协议。
3. 允许显式 section skeleton，禁止“表面无 loading、实际整页卡住”。
4. `worker_threads` 落地必须兼容 `electron-vite + electron-builder + asar` 打包环境。
5. 仍留在 main 的任务必须在 workload、日志和取消边界上可解释。
