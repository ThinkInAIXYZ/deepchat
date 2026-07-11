# Database Query Baseline Specification

Status: accepted for measurement

Task: `DB-001`

## 先说结论

这里不能直接加一包索引。当前代码确实存在全表扫描、临时排序和 session metadata N+1，但索引会永久增加
数据库体积、migration 时间和每次写入成本。`DB-001` 先用与 production SQL 等价的 10k/100k fixture 把读写
收益量出来，再分别决定 `DB-002`、`SES-LIST-001` 和 `SES-LIST-002` 应做什么。

本任务不修改 production schema、query 或 migration，也不声称用户已经获得性能提升。

## 代码真相

| Query family | Production owner | Current SQL shape | Current index truth |
| --- | --- | --- | --- |
| pending message recovery | `DeepChatMessagesTable.getByStatus()` | `status = ? ORDER BY updated_at DESC` | 只有 `(session_id, order_seq)` |
| mainline normalization | `AgentSessionPresenter.runMainlineNormalizationBackfill()` | session `(updated_at,id)` 与 message `(created_at,id)` keyset | session 只有单列 `updated_at DESC`；message 没有 cursor index |
| usage backfill | `DeepChatMessagesTable.listAssistantUsageCandidatesPage()` | `role='assistant'` + `(created_at,id)` keyset + session join | message 没有 `(role,created_at,id)` |
| session list | `NewSessionsTable.listPage()` | regular/agent filter + `(updated_at DESC,id DESC)` keyset | 单列 `agent_id` 和单列 `updated_at DESC` |
| claimed input recovery | `DeepChatPendingInputsTable.listClaimed()` | `state='claimed' ORDER BY session_id,created_at` | index 以 `session_id` 开头，不能按全局 state 定位 |
| session metadata | `NewSessionManager.mapRowToRecord()` | 每个 page row 单独 `get(sessionId)` | metadata PK 查询单次便宜，但 30-row page 是 1+30 queries |

这些 query 都有真实用途。crash recovery、usage/normalization migration、Cron badge 和 steer exactly-once 不能为
了减少 SQL 被删除或改成不可靠 fallback。

## 测量目标

1. 对 10k 和 100k 规模记录 current schema 的 `EXPLAIN QUERY PLAN`、first measured invocation、raw samples、
   median/IQR/min/max；p95 只作描述，不用 15 samples 声称稳定尾延迟。first measured invocation 发生在 cursor
   setup 之后，不冒充新进程、新连接或 cold OS cache。
2. 对 DB core partial、full partial suite、assistant partial 与 full composite 四组候选重复同一 SQL，记录
   `ANALYZE` 前后 plan，
   确认 planner 是否从 scan/temp sort 变成有界 index search。
3. 记录在已有 10k/100k 数据库上创建每个候选索引的时间和组合后的物理 pages/bytes 增量。
4. 对 current/三组 candidate 各执行 5k lifecycle write：insert 后再做 message finalize、session updated-at
   update、pending input claim + consume/delete，记录同一事务写入时间和 bytes 增量。
5. session list 同时测 page 1、50%/90%/99% cursor、regular filter、agent filter；metadata 比较当前 31 queries、
   `IN (...)` 的 2 queries 和 `LEFT JOIN` 的 1 query，不在本任务改 production owner。
6. 输出机器、OS、CPU、内存、Node、SQLite、native module、样本数、warmup 数和原始 samples，避免跨机器直接比
   毫秒。
7. production keyset 当前用展开的 `a > ? OR (a = ? AND id > ?)`；额外测等价 SQLite row-value comparator
   `(a,id) > (?,?)` 作为 control，并断言结果完全一致。若 index 在旧 SQL 下仍无法形成 range search，报告必须
   把 query-shape 改动列为后续前提，不能只批准索引。

## Fixture contract

每个 scale 的 `rowCount` 分别用于 `new_sessions`、`deepchat_messages` 和
`deepchat_pending_inputs`。fixture 使用固定 seed/公式，不使用随机数：

- sessions：90% regular、10% subagent；10 个均匀 agent；10% 带 Cron metadata；时间戳每 10 行共享一次，
  覆盖 keyset tie-breaker；agent filter 当前没有 renderer production caller，只作为“不应提前加 index”的
  对照组；
- messages：50% assistant；约 0.1% pending，其余 sent；时间戳每 10 行共享一次；`deepchat_sessions` 保留
  usage join 所需 provider/model；
- pending inputs：约 0.1% claimed、约 20% pending、其余 consumed；queue/steer 各半；
- payload 只保留固定小 JSON/text。DB-001 测 index/query 成本，不把 P-12 大 payload 放大混入结果。

10k/100k 是明确压力点，不冒充真实用户 percentile；仓库没有真实状态密度分布。当前 fixture 选择稀疏
pending/claimed 和大量 terminal rows，用于比较 full/partial index，但结果报告必须保留这一限制。

每个 measured query 在 cursor/setup 完成后先记录一次 measured invocation，再 warmup 3 次、记录 15 次。
benchmark 在单进程、同步 SQLite、与 production 一致的
`journal_mode=WAL` 下运行；需要比较物理 bytes 时先做 checkpoint，并把 checkpoint 时间与 transaction 时间分开
记录。current 与所有 candidate 都从同一 base DB clone，并同时记录 `ANALYZE` 前 plan、`ANALYZE` 成本与
分析后的 plan/latency。query benchmark 发生在 write benchmark 前，避免追加数据改变读样本。

## 候选索引

候选只是待测输入，不是预先批准的 migration。必须比较 partial 与 full，而不是把大量 sent/error/consumed
terminal rows 永久塞进新 index：

```sql
-- dbCore: DB-002 的稀疏启动状态与 message cursor 最小组合
CREATE INDEX ... ON deepchat_messages(updated_at DESC) WHERE status = 'pending';
CREATE INDEX ... ON deepchat_messages(created_at ASC, id ASC);
CREATE INDEX ... ON deepchat_pending_inputs(session_id, created_at) WHERE state = 'claimed';

-- partialSuite: 额外评估 session index，但不预设它们值得保留
CREATE INDEX ... ON new_sessions(updated_at DESC, id DESC);
DROP INDEX idx_new_sessions_updated; -- replaced, not duplicated
CREATE INDEX ... ON new_sessions(session_kind, updated_at DESC, id DESC);

-- assistantPartial: compare permanent one-time-backfill specialization
CREATE INDEX ... ON deepchat_messages(created_at, id) WHERE role = 'assistant';

-- fullComposite control: measure the tempting but potentially over-indexed design
CREATE INDEX ... ON deepchat_messages(status, updated_at DESC);
CREATE INDEX ... ON deepchat_messages(role, created_at, id);
CREATE INDEX ... ON new_sessions(agent_id, session_kind, updated_at DESC, id DESC);
CREATE INDEX ... ON deepchat_pending_inputs(state, session_id, created_at);
```

不得因为候选出现在本文件就全部实施。结果报告必须逐项给出：受益 query、plan 变化、100k median/IQR、index
build time、bytes 增量、组合 lifecycle write 成本，以及 keep/drop 结论。agent composite 没有 current
production caller，即使更快也不得据此实施。

## 输出

- 可重复 benchmark：`scripts/database-query-baseline.mjs`；
- 原始 JSON：`docs/architecture/database-query-baseline/results/*.json`；
- 人类可读结论：`docs/architecture/database-query-baseline/results/report.md`；
- 本 SDD 的 `plan.md`、`tasks.md`。

临时 SQLite 文件必须写入 OS temp directory 并在成功/失败时清理，不能进入仓库或用户数据库。

## 非目标

- 不修改任何 production table、index、query 或 migration；
- 不修 metadata N+1、pending retention 或 consumed steer policy；
- 不使用 E2E、renderer 或真实用户数据库；
- 不把单机毫秒外推为所有用户的绝对启动时间；
- 不把 query benchmark 与 P-12 payload/storage benchmark 混为一项。
- 不把 isolated SELECT latency 写成完整 constructor/startup 改善；pending/claimed recovery 后续还有
  materialization、session lookup 和 UPDATE。
- 不把直接 `CREATE INDEX` 时间冒充真实 `SQLitePresenter` open+migrate；`DB-002` 必须在写出 migration 后补
  current-version old DB、fresh/upgraded index parity 和完整 open+migrate 阻塞时间。

## 验收

- 五类 query family 和 metadata N+1/batch/join 都有
  current/dbCore/partialSuite/assistantPartial/fullComposite 结果；
- 10k/100k 都有 plan、raw samples、summary、migration、page/bytes、incremental write 数据；
- SQL 与当前 production source 对账，结果文件记录被测 git commit；
- 报告明确哪些索引进入 `DB-002`/`SES-LIST-001`，哪些被否决以及原因；
- 对无法由结果回答的 retention、UI、packaged 行为不作结论；
- 无 `[NEEDS CLARIFICATION]`。
