# 修复 F3：backfill 纳入 coordinator + keyset batch

## 目标
将 5 个 after-start 后台任务统一纳入 `StartupWorkloadCoordinator` 的 `scheduleTask(...)` 调度，避免它们在首屏后以 fire-and-forget 方式无约束并发；同时把 mainline normalization / usage stats backfill 从 `.all()` 全量读改为 keyset 小批分页、小批次让出主线程，并补齐 `processedCount` 与耗时观测。

本项目标是降低两类风险：
- 首屏后多个后台任务同时争抢主线程 / IO，导致 UI 卡顿。
- 大表一次性 `.all()` 读取造成内存峰值和长时间同步阻塞。

## 定位
### 2.1 5 个 hook 目前都绕过 coordinator
以下 5 个 hook 都是 `void startX().catch(...)`，虽然有 priority，但并没有进入 coordinator 的 `scheduleTask(...)`：
- [`legacyImportHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/after-start/legacyImportHook.ts#L5-L26)：`priority: 20`
- [`rtkHealthCheckHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/after-start/rtkHealthCheckHook.ts#L5-L25)：`priority: 20`
- [`usageStatsBackfillHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/after-start/usageStatsBackfillHook.ts#L5-L25)：`priority: 21`
- [`sqliteMainlineNormalizationHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/after-start/sqliteMainlineNormalizationHook.ts#L5-L29)：`priority: 22`
- [`disabledSearchToolCleanupHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/after-start/disabledSearchToolCleanupHook.ts#L5-L29)：`priority: 23`

而 coordinator 已提供：
- `taskContext.yield()` / `reportProgress()` / `signal`：[`startupWorkloadCoordinator/index.ts`](../../../src/main/presenter/startupWorkloadCoordinator/index.ts#L20-L35)
- `cpu: 1`、`io: 2` 的并发上限：[`startupWorkloadCoordinator/index.ts`](../../../src/main/presenter/startupWorkloadCoordinator/index.ts#L72-L75)
- `scheduleTask(...)` 的任务排队与执行：[`startupWorkloadCoordinator/index.ts`](../../../src/main/presenter/startupWorkloadCoordinator/index.ts#L150-L245)

### 2.2 presenter 入口尚未接收 taskContext
当前 `agentSessionPresenter` 的公开入口仍是不带 context 的 `startX()`：
- [`startLegacyImport`](../../../src/main/presenter/agentSessionPresenter/index.ts#L1609-L1611)
- [`startUsageStatsBackfill`](../../../src/main/presenter/agentSessionPresenter/index.ts#L1613-L1632)
- [`startMainlineNormalizationBackfill`](../../../src/main/presenter/agentSessionPresenter/index.ts#L1634-L1654)
- [`startDisabledSearchToolCleanupBackfill`](../../../src/main/presenter/agentSessionPresenter/index.ts#L1656-L1678)
- [`startRtkHealthCheck`](../../../src/main/presenter/agentSessionPresenter/index.ts#L1680-L1682)

因此，文档若要求在循环中调用 `taskContext.yield()`，必须同步补上 hook → presenter 的签名改造或适配层，否则 coordinator 提供的 context 无法真正传入 backfill 实现。

### 2.3 mainline normalization / usage stats 目前仍有全量读取与粗粒度 yield
- `runMainlineNormalizationBackfill()`：
  - `SELECT * FROM new_sessions ORDER BY updated_at ASC` + `.all()`：[`agentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L3424-L3431)
  - `SELECT * FROM deepchat_messages ORDER BY created_at ASC` + `.all()`：[`agentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L3462-L3464)
  - 每 200 条才 `yieldToEventLoop()`：[`agentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L3456-L3459), [`agentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L3468-L3477)
- `runUsageStatsBackfill()`：
  - 先拿 `listAssistantUsageCandidates()` 的全量数组：[`agentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L3685-L3687)
  - 每 200 条才 `yieldToEventLoop()`：[`agentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L3720-L3732)

### 2.4 rtk health check 的 resource 分类结论
`rtk-health-check` 应归类为 `resource: 'io'`，不应写成待定。

依据：
- `startRtkHealthCheck()` 直接转调 `rtkRuntimeService.startHealthCheck()`：[`agentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L1680-L1682)
- `startHealthCheck()` 进入 `runHealthCheck(...)`：[`rtkRuntimeService.ts`](../../../src/main/lib/agentRuntime/rtkRuntimeService.ts#L285-L290)
- 该服务依赖 shell 环境探测、runtime 初始化、外部命令执行等 IO/子进程行为，而非纯内存计算：
  - `getShellEnvironment` / `runCommand` / `RuntimeHelper` 注入：[`rtkRuntimeService.ts`](../../../src/main/lib/agentRuntime/rtkRuntimeService.ts#L66-L79)
  - `runCommandImpl(...)` 用于执行 `gain` / `rewrite` 等 runtime 命令：[`rtkRuntimeService.ts`](../../../src/main/lib/agentRuntime/rtkRuntimeService.ts#L322-L330), [`rtkRuntimeService.ts`](../../../src/main/lib/agentRuntime/rtkRuntimeService.ts#L413-L416)

所以该任务与 legacy import / 其余 backfill 一样，更符合 `background + io` 调度模型。

## 修复方案
### 3.1 5 个 hook 全部改为 coordinator 调度
将现有 `void startX().catch(...)` 改为 `startupWorkloadCoordinator.scheduleTask(...)`，统一进入 background 队列。

建议映射：
- `legacy-import`：`phase: 'background'`，`resource: 'io'`
- `rtk-health-check`：`phase: 'background'`，`resource: 'io'`
- `usage-stats-backfill`：`phase: 'background'`，`resource: 'io'`
- `sqlite-mainline-normalization`：`phase: 'background'`，`resource: 'io'`
- `disabled-search-tool-cleanup`：`phase: 'background'`，`resource: 'io'`

说明：
- 这 5 项都以数据库、配置、runtime 探测、子进程或磁盘数据处理为主，不属于长时间纯计算型 `cpu` 任务。
- 当前 `MAX_CONCURRENCY` 为 `io: 2`，因此纳入 coordinator 后可避免 5 个任务无上限地同时抢占资源：[`startupWorkloadCoordinator/index.ts`](../../../src/main/presenter/startupWorkloadCoordinator/index.ts#L72-L75)

### 3.2 补齐 hook → presenter → 内部实现的 taskContext 接线
这是本次 review 必须补充的关键步骤。

当前 `startUsageStatsBackfill()` / `startMainlineNormalizationBackfill()` 等入口不接收参数，因此需要二选一：

方案 A：直接扩展公开入口签名
```ts
async startMainlineNormalizationBackfill(taskContext?: StartupWorkloadTaskContext): Promise<void>
```
内部把 `taskContext` 继续传给 `runMainlineNormalizationBackfill(taskContext)`，未通过 coordinator 调用时则走默认 context（例如回退到现有 `yieldToEventLoop()` 封装）。

方案 B：保留现有 `startX()` 接口，增加 coordinator 专用入口
```ts
async startMainlineNormalizationBackfill(): Promise<void>
async runMainlineNormalizationBackfillWithContext(taskContext: StartupWorkloadTaskContext): Promise<void>
```
hook 在 `scheduleTask.run(context)` 中调用新入口；原 `startX()` 继续服务现有外部调用与 Promise 门控逻辑。

推荐优先 B：
- 改动更渐进，不强迫所有现有调用方一起升级签名。
- 可以保留 `this.mainlineNormalizationPromise` / `this.usageStatsBackfillPromise` 之类的去重门控，再由 context-aware 内部实现复用。

无论选 A 还是 B，文档都要求明确：**只有把 context 真正传入 backfill 循环，`taskContext.yield()` 才能替代当前的 `yieldToEventLoop()` 并与 coordinator 协作。**

### 3.3 mainline normalization：keyset 分页，去掉全表 `.all()` 与 `SELECT *`
`runMainlineNormalizationBackfill()` 需要同时修两件事：
1. 不再 `SELECT *`
2. 不再 `.all()` 全表进内存

实现方案：按 `(updated_at, id)` / `(created_at, id)` keyset 分页，每页初始 50 条。

```ts
SELECT id, title, updated_at
FROM new_sessions
WHERE updated_at > ? OR (updated_at = ? AND id > ?)
ORDER BY updated_at ASC, id ASC
LIMIT ?
```

`deepchat_messages` 同理，只取 `backfillNormalizedMessageRow(...)` 真正需要的列：

```ts
SELECT id, session_id, role, status, content, updated_at, created_at
FROM deepchat_messages
WHERE created_at > ? OR (created_at = ? AND id > ?)
ORDER BY created_at ASC, id ASC
LIMIT ?
```

选择 keyset 分页而不是长生命周期 `iterate()`，是为了避免同一 SQLite 连接在 cursor 未关闭时继续写入 normalized tables 导致 `connection is busy`。

### 3.4 usage stats backfill 同样改为分页候选
`runUsageStatsBackfill()` 当前先拿 `listAssistantUsageCandidates()` 全量数组，再同步遍历：[`agentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L3685-L3732)

应改为：
- `deepchatMessagesTable.listAssistantUsageCandidatesPage(cursor, limit)`：优先，keyset 分页接口。
- `listAssistantUsageCandidates()`：仅作为旧测试/旧表实现的兼容兜底，不应作为生产路径。

循环中按 batch 更新运行状态并 `await taskContext.yield()`，替代当前每 200 条才 `yieldToEventLoop()` 的实现。

### 3.5 batch 大小表述改为“初始 50，待压测确定”
此前文档把 200 → 50 写成近似定案，但仓内没有现成基准支撑，因此这里改为：
- **初始 batchSize 设为 50**，作为首轮实现的保守起点。
- **最终批次大小待压测确定**，允许在 25–100 区间内根据真实数据集与 UI 平滑度调整。

这样既避免沿用当前 200 的粗粒度，也不把 50 写成没有证据支持的最终结论。

### 3.6 processedCount / durationMs 观测补齐
建议所有相关 backfill 至少补以下观测：
- `startedAt`
- `processedCount`
- `updatedCount` / `configUpdatedCount`（如适用）
- `finishedAt`
- `durationMs`

运行中状态应按 batch 粒度刷新 `processedCount`；完成日志记录总耗时，方便判断限流后是否出现吞吐下降。

## 步骤拆分
1. 5 个 after-start hook 从 `void startX().catch(...)` 改为 `startupWorkloadCoordinator.scheduleTask(...)`。
2. 为 `startUsageStatsBackfill` / `startMainlineNormalizationBackfill` / `startDisabledSearchToolCleanupBackfill` / `startLegacyImport` / `startRtkHealthCheck` 补 context 接线：扩签名或增加 coordinator 适配入口。
3. `runMainlineNormalizationBackfill()` 改为只查必要列，优先 `prepare(...).iterate()`，移除 `.all()` 全量读取。
4. `runUsageStatsBackfill()` 改为迭代器或分页候选，按 batch `yield`。
5. 加 `processedCount`、`durationMs`、批次状态刷新，并补验证与压测记录。

## 验证
- 单元测试 / 集成测试建议覆盖：
  - hook 是否改为调用 `scheduleTask(...)`，而不是直接 `void startX()`。
  - `scheduleTask` 后 coordinator 的 `io` 并发上限是否生效（不应超过 2 个同类任务同时 running）。
  - `taskContext.yield()` 的调用节奏是否符合 batch 配置。
  - mainline normalization / usage stats 在流式实现下结果与现状一致。
- `iterate()` 可用性验证：
  - 确认 `better-sqlite3-multiple-ciphers` 在当前仓库安装版本下运行时支持 `statement.iterate()`。
  - 确认项目的 TypeScript 类型声明允许直接调用 `iterate()`；若类型缺失，需要先补类型声明或在方案中明确采用分页兜底。
- 大数据验证：
  - 使用 synthetic 数据或现有大样本库验证 `.all()` 移除后内存峰值下降。
  - 对比 batchSize=50 等候选值下的总耗时与 UI 平滑度，决定最终阈值。
- 常规校验：
  - `pnpm run typecheck`
  - `pnpm run lint`
  - `pnpm run format`
  - `pnpm run i18n`
  - E2E：`01-launch`
- 日志 / 状态检查：
  - 完成日志包含 `processedCount`、`durationMs`
  - 运行中状态包含周期性刷新的 `processedCount`

## 风险
- `iterate()` 运行时可用 ≠ 类型立即可用；若 TS 声明缺失，需要补声明，否则只能先走分页兜底。
- `LIMIT/OFFSET` 在大表深翻页时会随着 offset 增大而退化，因为 SQLite 仍需扫描并跳过前面的记录；因此分页只能作为兼容兜底，不能视作与 `iterate()` 等价的长期方案。
- 只查必要列后，需确认 [`backfillNormalizedMessageRow`](../../../src/main/presenter/agentSessionPresenter/index.ts#L3593-L3641) 等下游逻辑没有隐式依赖被删掉的字段。
- coordinator 调度会改变启动后这些后台任务的开始时机，需要确认不会影响任何必须“立刻完成”的初始化语义。
- batch 调小会提升让出频率，能改善卡顿，但也可能拉长总耗时；最终值必须以压测结果为准。
- `usageStatsBackfill` 的运行中 / 完成 / 超时语义必须保持兼容，避免因改造 iterator / 分页接口造成重复跑、漏跑或状态卡死。
