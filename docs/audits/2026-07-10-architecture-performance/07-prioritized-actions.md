# 07 - 分级行动、测量与回归要求

本清单是决策输入，不是已授权实施计划。不要把所有 finding 塞进一个“architecture cleanup” PR。

## 分类原则

| 类型 | 处理方式 |
| --- | --- |
| 已确认语义错误/可靠性冲突 | 先写失败测试，再修；不等待 profiler |
| 已确认复杂度、实际严重度未知 | 先埋点/构造规模测试，再定方案 |
| 已知架构债 | 冻结增长，小步 extraction，不做 big bang |
| 有意 fallback | 保留保证，只修偏离或缺失的 lifecycle/observability |
| 产品 scope 不明 | 先做 owner 决策，不让工程师猜 |

## P0：先修语义与状态机

### 1. P-07 System prompt cache 组合错误

- **原因**：性能 fallback 已确认会让 late AGENTS 内容被外层日级 cache 屏蔽，属于 prompt 正确性。
- **先写测试**：真实调用外层 `buildSystemPromptWithSkills`，首次 disk read >200ms，read 完成后下一 turn
  必须包含 instructions；再覆盖同名 skill 内容更新。
- **方案门槛**：不能靠缩短 TTL 掩盖；需要 content revision/mtime 或 late refresh invalidation。
- **SDD**：复杂 prompt/runtime bug，使用 `docs/issues/<goal>/spec.md`。

### 2. A-04 Scheduler mutation timeout

- **原因**：caller failure + later mutation success 是已确认 unknown-outcome 语义。
- **先写测试**：deferred create 超时后晚落库/晚绑定；retry 前一 attempt 仍运行。
- **决策**：分别列出 cancellable、idempotent、non-cancellable operation；不要强迫一个 API 假装都能取消。
- **SDD**：跨 route/service/Presenter contract，使用 architecture SDD；若只修一个 mutation，使用 issue spec。

### 3. A-05 Session availability model

- **原因**：temporary failure 被当 missing，并解除真实 binding；Scheduler retry 被 catch 吞掉。
- **先写测试**：record 存在但 runtime transient failure 时保留 binding，并暴露 unavailable/transient state；
  永久未知 agent 仍不能拖垮列表。
- **迁移**：先扩内部 result，再改 route schema；明确旧 renderer compatibility。

### 4. A-06 Fatal process policy

- **原因**：非 network programming exception 被全局吞掉。
- **先做决策**：controlled exit、relaunch、crash reporter、safe-mode 各自条件；network toast 移回请求 owner。
- **测试**：network error 不走 fatal；非 network uncaught 按策略退出/重启，且日志落盘。

### 5. A-10 Coordinator settlement

- **原因**：`whenIdle` 与命名/历史目标冲突；pending cancel 留 dedupe record。
- **测试**：CPU + 2 IO 全部 deferred；idle callback 只能在全部 settle 后开始。反复 create/cancel target 后
  map/pending/runs 不增长。

## P1：先测量，再改热路径

### 6. P-01/P-02 单次发送 history read model

最小 instrumentation：

```text
sessionId
turnId
getMessages call count
header rows / structured rows / trace rows
SQL duration
materialization duration
provider-start elapsed
main event-loop delay
```

目标不是先缓存所有东西，而是：

- `hasMessages` 用 existence query；
- pending/question predicate 使用增量状态或一次共享 snapshot；
- runtime history 不携带 UI trace count；
- 一次 send orchestration 最多构建一次完整 history snapshot。

规模矩阵：10/100/1k/10k messages × 0/10k/100k global traces。

### 7. P-03 Tape ready watermark

- 先记录同一 session 连续两次 ensure 的 message rows、tape rows、provenance query、hash/parse 数。
- 设计 migration version + source cursor/watermark；live append 推进状态。
- crash/partial migration 后必须能安全恢复，不能用一个 boolean 跳过未完成 backfill。
- Tape spec 是 maintained contract，实施时同步更新相关 architecture docs。

### 8. P-04 Streaming snapshot

先加 payload/CPU/DB 指标，禁止直接“大改 delta”：

| 变量 | 取值 |
| --- | --- |
| text payload | 10KB / 100KB / 1MB |
| stable tool/image payload | 0 / 1MB |
| window/webContents | 1 / 3 / settings 同开 |
| 记录 | snapshots、bytes、JSON/Zod time、IPC targets、DB rows rewritten、renderer commit |

可能方案按风险从低到高：

1. session/webContents targeted snapshot；
2. stable large block 引用/内容地址化；
3. DB 只 upsert changed blocks；
4. revisioned delta + periodic snapshot。

只有 4 需要改变 transport contract，前 1-3 可能先拿到大部分收益。

### 9. P-05/P-06/P-08/P-11 索引包

不要看到 missing index 就逐条随手加。一次审查以下 query/index/write tradeoff：

| Query | 候选 index | 触发频率 |
| --- | --- | --- |
| pending recovery | `(status, updated_at DESC)` | 每次启动 |
| normalization cursor | `(created_at, id)` | migration/失败重试 |
| usage cursor | `(role, created_at, id)` | migration/失败重试 |
| session list | `(session_kind, updated_at DESC, id DESC)`；agent variant 按实际 query | 首屏/分页 |
| claimed pending inputs | `(state, session_id, created_at)` | 每次启动 |

用 10k/100k rows 记录 query plan、page latency、migration time、DB size 和写入成本。SQLite migration 必须
覆盖已有数据库，不只改 `CREATE TABLE IF NOT EXISTS`。

### 10. P-09/P-10 Fallback policy

- FTS：availability/migration state 与 zero-hit 分开；FTS throw 才进入 defined fallback。
- FFF：先区分 native/init unavailable、workspace timeout、query-specific 与 transient IO；只对可归因到
  workspace/runtime 的失败做 cooldown，冷却后单次 half-open probe，成功清状态；filesystem 使用
  resumable cursor。
- 两者都应记录 fallback reason/count；没有观测的 fallback 会再次永久化。

## P1：架构冻结与小步拆分

### 11. A-01 Route composition

先加“只增不减”的趋势告警：root LOC/case/concrete presenter/table imports。然后选择一个新改动频繁 domain
做样板 extraction，不批量搬文件。验收：root 只 dispatch，domain handler 自带 focused fixture。

### 12. A-03 Shared declarations

第一步不是拆 2,592 行，而是让 repo-owned declaration strict check 能跑：

1. 修现有解析/未导入错误；
2. 移除 shared → main alias；
3. CI 对 `src/shared/**/*.d.ts` 使用 `skipLibCheck=false`；
4. 冻结 compatibility core 新 export；
5. 随 feature touch 按 domain 提取。

### 13. A-02 AgentRuntime split

直接恢复已有
[`agent-runtime-presenter-split/tasks.md`](../../architecture/agent-runtime-presenter-split/tasks.md)，按 T2-T7
执行。先 state-owning service、后 turn runner；每个 extraction 独立 PR，不与行为修复混合。

### 14. A-07/A-09 Lifecycle identity

- HooksNotifications 改 late-bound identity，不再 dummy-first/reassign。
- FileWatcher singleton 获得 process owner/final teardown 或 idle-stop。
- 两项都需要 real Presenter/lifecycle integration test，避免只测 isolated class。

## P2：清理与 owner 决策

| Finding | 行动 |
| --- | --- |
| D-01 | Remote catalog 单一真源，失败显示 unavailable |
| D-02/D-03 | 支持窗口确认后删 Compat 壳与专用 status route |
| D-04 | required agent capability 与显式 optional descriptor 分开 |
| D-05 | 明确 ChatService 是 enqueue owner 还是 generation owner |
| D-06 | 删除 fake `ISQLitePresenter`，需要时注入窄 activity port |
| D-07 | 保留 MCP 双保险；只统一无 spec 依据的重复 teardown |
| D-08 | 共享 compaction default/limit，产品确认 per-agent step 语义 |
| D-09 | 删除常量 true flag，或改真实 runtime capability |
| A-12 | 明确 workspace capability 是 app/session/webContents scope |
| P-11 | 决定 consumed steer retention/TTL/delete policy |
| P-12 | 先按 payload 类型测量各层物理 bytes，达到预算阈值后再讨论 offload/retention |

## 明确不做

- 不把 349-case switch 换成“更快的数据结构”来假装解决 A-01。
- 不在没有 profile 时把 snapshot 全面改 delta。
- 不删除 MCP final shutdown fallback。
- 不删除 legacy JSON/Tape/FTS 任一层而不先完成 migration/retention 设计。
- 不因为当前只有一个 agent implementation 就删除 Registry。
- 不新增通用 retry/cache/process framework；先修现有语义。

## 每个实施 PR 的最低验证

- focused unit/integration test，覆盖 failure/timeout/cancel，不只 happy path；
- `pnpm run typecheck`；
- `pnpm run format`；
- `pnpm run i18n`；
- `pnpm run lint`；
- main hot path 改动补 `test:main`；renderer event/list 改动补 `test:renderer`；
- SQLite/index 改动必须用已有 DB migration fixture + query plan/规模数据；
- UI 行为变化提供 BEFORE/AFTER ASCII layout；本审计本身没有 UI 改动。
