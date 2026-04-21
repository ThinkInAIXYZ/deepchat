# Startup Orchestration 规格

## 概述

本规格把应用启动重构为一个由 `splash` 驱动的、线性可观测的初始化编排流程。

目标体验有四个核心结果：

1. `splash` 承接启动期的关键准备工作，主窗口在关键数据就绪后再进入可见态。
2. 主进程启动任务区分 `critical` 与 `deferred`，复杂 I/O 与复杂计算走异步与后台化路径。
3. 初始化链路具备单次触发、明确依赖和去重约束。
4. renderer 首屏使用轻量快照和增量同步，`sessions list`、`agent list` 在轻量化同时保持一致性。

本规格吸收 `docs/specs/startup-session-list-perf/` 的范围，覆盖更完整的启动链路治理。

## 背景

当前启动体验已经暴露出结构性问题：

1. main 进程在 `ConfigPresenter`、`Presenter` 构造和 renderer 首屏回拉期间都执行了重量级任务。
2. provider 初始化、model 读取、session 状态构建存在重复触发。
3. 主窗口可见后 main 进程仍持续吃满 CPU，用户看到的是“窗口出来了，但还是卡”。
4. renderer 把会话列表、agent 列表、project 列表等多路数据拉取一起放进首屏关键路径。
5. 启动事件语义和真实窗口显示时机存在偏差，导致初始化挂点和窗口可见时机错位。

2026-04-21 本地 `pnpm run dev` 观测到的现象：

1. `Lifecycle READY` phase 耗时约 `2155ms`。
2. 主窗口真正 `ready-to-show` 在 lifecycle start 约 `8.7s` 后发生。
3. 多个 enabled provider 出现重复初始化和重复 `fetchModels`。
4. renderer 出现 `MaxListenersExceededWarning`，说明启动期事件监听也存在重复注册问题。

## 目标体验

### 启动阶段

```text
+--------------------------------------+
| DeepChat Splash                      |
| Initializing critical data...        |
| phase: sessions / agents / route     |
| [##########------]                   |
| deferred warmups will run later      |
+--------------------------------------+
```

### 主窗口进入时

```text
+----------------------+----------------------------------+
| sessions snapshot    | active thread / new thread       |
| agents snapshot      | content area                     |
| providers summary    |                                  |
+----------------------+----------------------------------+
deferred: models / MCP / skill scan / remote warmups
```

## 用户故事

### US-1：主窗口首次可见就是可用态

作为用户，我希望主窗口出现时左侧会话列表、当前路由和基础上下文已经准备好，这样我能立即操作，而不是等主进程继续打满 CPU。

### US-2：长启动由 splash 承接

作为用户，我希望长启动阶段由 `splash` 明确承接，并展示当前初始化阶段，这样我知道系统正在准备什么。

### US-3：大量历史数据也保持稳定

作为有大量 session、agent 和 provider 配置的用户，我希望历史数据规模增大后启动仍然线性可控，不出现指数级卡顿和重复初始化。

### US-4：列表轻量且一致

作为用户，我希望 `sessions list` 和 `agent list` 首屏先用轻量快照快速出现，同时后续增量刷新保持数据一致，不出现空白、闪烁、重复项或状态回退。

## 功能范围

本次范围覆盖：

1. `splash` 承接关键启动任务与进度展示。
2. main 启动任务分层、依赖编排、去重和后台化。
3. provider 启动链路去重与延后。
4. `sessions list`、`agent list`、provider 摘要的轻量快照化。
5. renderer 首屏关键路径瘦身和快照应用。
6. 启动日志、时序和验收观测点。

## 功能要求

### A. 启动所有权与阶段划分

- 启动链路分成明确阶段：
  - `process-bootstrap`
  - `critical-startup`
  - `window-boot`
  - `renderer-hydration`
  - `deferred-warmups`
- 每个启动任务都有固定 owner、依赖关系、去重 key、执行策略和超时策略。
- `critical-startup` 的完成是主窗口进入可见态的前置条件。
- 启动链路使用单一 orchestrator 编排，避免构造函数、副作用监听和 renderer 首屏分别发起各自的初始化。

### B. Splash 驱动的关键初始化

- 继续保留当前“超过一定时间才显示 splash”的体验。
- 一旦进入 `splash`，关键初始化任务在 `splash` 生命周期中执行并展示阶段性进度。
- `splash` 关闭时，关键数据已准备完成，主窗口进入加载和显示流程。
- `splash` 支持关键任务失败时的错误展示和重试入口。

### C. 主进程非阻塞执行策略

- 复杂 I/O、复杂计算和大规模遍历任务使用异步路径执行。
- pre-show 关键路径不允许出现对全量 session、全量 enabled provider 的无界同步循环。
- deferred 任务在主窗口可见后执行，并带有明确并发上限。
- deferred 任务不会长期独占 main IPC 处理能力。

### D. 初始化去重与线性可控

- 每个 startup task 在同一 startup run 中最多执行一次。
- provider bootstrap 在单次启动中每个 provider 最多执行一次关键初始化。
- 关键路径上的 `getActive`、`sessions.list`、`agents.list`、provider summary 读取各自有单一路径。
- 启动事件命名与真实时机一致，`window ready` 和 `BrowserWindow.ready-to-show` 语义一致。

### E. 轻量快照与一致性

- 首屏 `sessions list` 使用轻量快照，不在关键路径中做逐会话 runtime hydration。
- 首屏 `agent list` 使用轻量快照，不在关键路径中执行重量级 registry/install state 补全。
- provider 首屏只提供 summary/snapshot，不拉完整 model list。
- 快照包含版本号或时间戳，用于后续增量刷新合并。
- 后台刷新结果以“同一实体 ID + 新版本覆盖”的方式合并，保持排序和选择状态稳定。
- runtime 内存态在需要时覆盖持久化快照态，保证活动 session 状态正确。

### F. Renderer 首屏瘦身

- renderer 首屏关键路径只保留路由恢复和关键快照应用。
- `agent list`、`project list`、`provider/model` 的完整刷新不进入首屏阻塞路径。
- `modelStore.initialize()` 不在应用刚挂载时立即全量遍历 enabled providers。
- `ChatTabView` 的 ready 条件收敛到“页面路由 + 会话/agent 关键快照已应用”。
- `active thread` 的历史消息恢复进入 post-interactive deferred queue。
- `ACP` draft/bootstrap 与 config warmup 进入 post-interactive deferred queue。

### G. 可观测性

- 启动流程生成统一 `startupRunId`。
- 每个 phase/task 输出开始、完成、耗时和结果日志。
- 关键里程碑至少包含：
  - `critical-startup begin/end`
  - `main-window load requested`
  - `main-window ready-to-show`
  - `renderer snapshot applied`
  - `renderer first interactive ready`
  - `deferred task begin/end`

## 验收标准

- `splash` 承接长启动时，主窗口在关键快照完成后才进入可见态。
- 单次启动中同一 provider 不再出现重复关键初始化日志。
- renderer 首屏 ready 不再等待全量 `project list` 和全量 `modelStore.initialize()`。
- renderer 首屏 ready 不再等待 active thread restore、`ACP` draft bootstrap 和 `ACP` config warmup。
- `sessions list` 和 `agent list` 首屏使用轻量快照返回，空白时间显著缩短。
- 启动日志具备 run 级别 trace，能够从日志重建完整时序。
- 启动期无 `MaxListenersExceededWarning`，无重复 startup listener 注册。

## 非目标

1. 本次不重做侧边栏 UI 结构。
2. 本次不重写所有 provider 的业务逻辑。
3. 本次不在首屏加载完整 model catalog。
4. 本次不改写历史 session 的业务语义。
5. 本次不把所有 background 任务都提前到 `splash`，只承接关键路径必须数据。

## 约束

1. 保持现有 typed route / typed event 方向，不新增新的 legacy IPC 风格。
2. 保持现有用户数据、session 数据和 provider 数据契约稳定。
3. 关键路径优化优先通过链路收敛、任务分层和快照化完成。
4. 性能优化同时保持数据一致性，不接受“先快后错”的结果。
