# Startup Orchestration 验收方案

## 验收目标

验收关注四个维度：

1. `splash` 是否正确承接关键初始化。
2. main 进程是否从“重复、并发、阻塞”转为“线性、去重、后台化”。
3. renderer 首屏是否从“回拉全量数据”转为“应用快照 + 后台增量”。
4. 轻量快照是否保持数据一致性。

## 必备观测点

验收前必须具备以下日志或 trace：

1. `startupRunId`
2. `startup.phase.begin/end`
3. `startup.task.begin/end`
4. `startup.window.load-requested`
5. `startup.window.ready-to-show`
6. `startup.renderer.snapshot-applied`
7. `startup.renderer.interactive-ready`
8. `startup.deferred.begin/end`

## 核心通过条件

### P0 启动时序

- 主窗口可见事件发生在 `critical-startup` 完成之后。
- `splash` 在关键初始化期间承接长启动。
- `critical-startup` 的任务链可以从日志完整重建。

### P0 去重

- 单次启动中同一 startup task key 只出现一次成功执行。
- 单次启动中同一 provider 的关键 bootstrap 只出现一次。
- 启动期无重复 listener 注册导致的 `MaxListenersExceededWarning`。

### P0 主线程压力

- pre-show 关键路径不存在对全量 session 的逐条 runtime hydration。
- pre-show 关键路径不存在对全量 enabled provider 的 full warmup。
- deferred 阶段的重量级任务不会阻塞首屏交互。

### P0 Renderer 首屏

- `ChatTabView` ready 不等待 `projectStore.fetchProjects()`。
- `ChatTabView` ready 不等待全量 `modelStore.initialize()`。
- `sessions list` 与 `agent list` 在首屏使用 snapshot 直接渲染。

### P1 数据一致性

- 快照应用后后台刷新不会清空已有列表。
- 后台刷新不会导致 active session、selected agent、route 发生错误回退。
- 会话和 agent 列表不存在重复项、丢项和顺序抖动。

## 场景矩阵

| 场景 | 数据条件 | 预期结果 | 证据 |
| --- | --- | --- | --- |
| 冷启动，无 active session | 默认配置 | splash 承接关键初始化，主窗口进入 new thread，session/agent snapshot 已就绪 | startup logs + screen recording |
| 冷启动，有 active session | 最近一次窗口绑定有效 | splash 完成后直接恢复 chat route，active session 正确 | startup logs + route state |
| 大量历史 session | `>= 500` sessions | 首屏使用 session snapshot，侧边栏快速可见，pre-show 无逐条 runtime hydration | logs + profiler |
| 多 enabled providers | `>= 10` enabled providers | pre-show 只读 provider summary，full warmup 在 deferred 执行 | logs |
| 离线网络 | provider endpoint 不可达 | critical-startup 仍完成，main 可见，失败任务进入 deferred error path | logs + UI behavior |
| ACP enabled + registry agents | ACP 打开且 registry 存在数据 | agent snapshot 可用，ACP registry/network refresh 不阻塞主窗口可见 | logs |
| 后台刷新回流 | 启动后持续 deferred tasks | 列表稳定，active selection 稳定，局部增量更新正确 | screen recording + logs |

## 详细检查项

### 1. Splash 接管检查

检查点：

1. 冷启动超过 splash 延迟阈值后出现 splash。
2. splash 展示当前 phase 或 task 名称。
3. critical 完成后 splash 关闭，主窗口进入显示流程。
4. critical task 失败时 splash 能展示错误与重试。

### 2. Provider 去重检查

检查点：

1. 启动日志中每个 enabled provider 只出现一次关键 bootstrap 记录。
2. provider summary 读取与 provider full warmup 记录分离。
3. renderer 首屏不触发新的 provider bootstrap 风暴。

### 3. Session / Agent 快照检查

检查点：

1. `sessions list` 返回的是 lightweight snapshot。
2. `agent list` 返回的是 lightweight snapshot。
3. 活动 session 状态正确覆盖 snapshot 默认态。
4. 后台刷新完成后列表维持相同 entity identity。

### 4. Renderer 关键路径检查

检查点：

1. renderer 首屏先应用 bootstrap snapshot。
2. `pageRouter` 与 `sessionStore` 不重复读取 active session。
3. `projectStore`、`modelStore`、完整 provider refresh 在后台执行。

## 建议采样数据

每轮验收至少保留：

1. 一次冷启动完整日志
2. 一次大数据量 profile trace
3. 一段包含 splash -> main window 的录屏
4. 一次 deferred tasks 回流期间的列表一致性录屏

## 结果判定

### 通过

以下条件同时满足时判定通过：

1. 所有 P0 条件通过
2. 场景矩阵全部通过
3. 无新的启动期 warning/error 噪音

### 有条件通过

以下情况可以进入下一轮优化而不阻塞主改动：

1. P0 全部通过
2. 个别 P1 一致性问题仍有边缘 case
3. 已有明确修复 follow-up 和复现方法

### 不通过

以下任一条件触发即判定不通过：

1. 主窗口早于 critical-startup 完成进入可见态
2. provider 关键 bootstrap 仍重复
3. renderer 首屏仍依赖全量 model/project 初始化
4. 轻量快照引入明显数据不一致

