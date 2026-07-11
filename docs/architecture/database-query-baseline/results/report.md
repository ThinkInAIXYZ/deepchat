# DB-001 Database Query Baseline Report

Status: measured and independently verified

Raw data: [`2026-07-11-macos-arm64.json`](./2026-07-11-macos-arm64.json)

Measured commit: `1769720a54e40433b8fd4b6c440e290a08e1e8bb` (`gitDirty=false`)

## 先说结论

初版“给五类 query 各加一个 full composite index”不成立。数据支持的是一个更小的组合：

1. message pending recovery 用 partial index；
2. message normalization/usage 共用一个 `(created_at,id)` index；
3. claimed input recovery 用 partial index；
4. 所有 deep keyset query 把展开的 `OR` 改成等价 row-value comparator。

100k fixture 上，这个 DB core 组合占用约 `3.06 MiB`，direct index build `22.04ms`，5k lifecycle write 从
`42.01ms` 增至 `46.32ms`（本机约 `+10%`）。full composite 组合占用 `21.30 MiB`，build `193.94ms`，
同一 write 增至 `76.30ms`（约 `1.82x`）。两者对 pending/claimed 的读取收益几乎相同，因此 full 方案是
过度索引。

另一个更重要的反常识结果是：session deep cursor 的主要问题不是缺 index，而是展开的 `OR` 破坏 range
search。只改成 row-value comparator，在 current schema 上 regular session 50% cursor 从 `6.060ms` 降到
`0.035ms`（约 `175x`）；此时再加 session composite index 只有约 `1.2x` 的小幅改善。
`SES-LIST-001` 不应直接加 index。

## 测量环境与口径

| 项目 | 值 |
| --- | --- |
| 机器 | Apple M5，10 logical CPUs，24 GiB RAM |
| OS | macOS Darwin `25.5.0`，arm64 |
| Runtime | Electron Node `v24.15.0`，ABI `143` |
| SQLite | `3.53.0` |
| Native module | `better-sqlite3-multiple-ciphers 12.9.0` |
| Scale | 10k / 100k rows，分别写入 sessions/messages/pending inputs |
| Samples | cursor/setup 后的 first measured invocation + 3 warmups + 15 raw samples；不代表 cold/new connection |
| Summary | median/IQR；p95 只保存在 raw JSON，不作稳定尾延迟承诺 |
| Journal | WAL；size 前 checkpoint；transaction 与 checkpoint 分开 |
| Write workload | 每组 5k insert，随后 message finalize、session updated-at、input claim + consume/delete |

Fixture 是 deterministic 压力点，不是用户 percentile：90% regular session、10 个均匀 agent、10% Cron
metadata、50% assistant message、0.1% pending/claimed、大量 sent/consumed terminal rows，timestamp 每 10 行
碰撞一次。payload 固定且很小，避免混入 P-12 storage budget。

四组 candidate 与 current 都从同一个 base DB clone；所有 query result 在 current/candidate 之间一致，expanded
OR 与 row-value control 也逐项断言结果一致。每组都保存 `ANALYZE` 前后 plan。

## 组合成本

### 100k scale

| Scenario | 内容 | Direct build | Index bytes | 5k lifecycle write | Write allocated bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| current | production indexes | — | — | `42.01ms` | `2.85 MiB` |
| DB core | pending partial + message cursor + claimed partial | `22.04ms` | `3.06 MiB` | `46.32ms` (`1.10x`) | `3.06 MiB` |
| partial suite | DB core + 两个 session indexes | `91.17ms` | `7.15 MiB` | `58.04ms` (`1.38x`) | `3.75 MiB` |
| assistant partial | partial suite + assistant-only cursor | `101.91ms` | `8.68 MiB` | `59.59ms` (`1.42x`) | `3.86 MiB` |
| full composite | full status/role/agent/state composites | `193.94ms` | `21.30 MiB` | `76.30ms` (`1.82x`) | `4.88 MiB` |

100k base DB 是 `55.49 MiB`。DB core 的 index 增量约为 base 的 `5.5%`；full composite 约为 `38.4%`。
这不是所有真实数据库的固定比例，只说明同一 deterministic payload 下的相对成本。

### 10k scale

| Scenario | Direct build | Index bytes | 5k lifecycle write |
| --- | ---: | ---: | ---: |
| current | — | — | `41.49ms` |
| DB core | `2.17ms` | `0.31 MiB` | `43.83ms` |
| partial suite | `6.62ms` | `0.74 MiB` | `54.19ms` |
| assistant partial | `7.40ms` | `0.89 MiB` | `54.46ms` |
| full composite | `14.52ms` | `2.15 MiB` | `69.34ms` |

这些是 direct `CREATE/DROP INDEX` 数字，不是尚未实现的 production `SQLitePresenter.open()+migrate()`。

## Query 结果

下表是 100k median；所有 raw samples、IQR、first measured invocation、50%/90%/99% cursor 和 plan 在
JSON 中。

| Query | Current | DB core / control | 代码真相 |
| --- | ---: | ---: | --- |
| pending recovery | `1.850ms` | partial `0.045ms` | partial/full 分别 `0.045/0.045ms`；full 无读收益 |
| claimed inputs | `2.020ms` | partial `0.040ms` | partial/full 分别 `0.040/0.042ms`；full 无读收益 |
| message normalization page 1 | `2.512ms` | cursor index `0.020ms` | 移除 table scan + temp sort |
| message normalization 50%, expanded OR | `2.578ms` | cursor index `1.020ms` | index 仍是 scan，不是有界 range |
| message normalization 50%, row-value | `2.513ms` | cursor index `0.022ms` | plan 变为 `(created_at,id)>(?,?)` range search |
| usage page 1 | `8.440ms` | generic cursor `0.034ms` | generic index 已够；不需要 role index |
| usage 50%, expanded OR | `5.619ms` | generic cursor `1.053ms` | 仍从 index 前部 scan |
| usage 50%, row-value | `5.573ms` | generic cursor `0.039ms` | generic/assistant/full 为 `0.039/0.041/0.042ms`，差异不足以支付永久 index |
| session normalization 90%, expanded OR | `2.316ms` | partial suite `2.104ms` | 新 session index 几乎没解决 OR plan |
| session normalization 90%, row-value | current `0.025ms` | partial suite `0.018ms` | query rewrite 约 `92x`；index 只有约 `1.4x` |
| regular session 50%, expanded OR | `6.060ms` | session index `1.280ms` | index 改善，但仍线性走到 cursor |
| regular session 50%, row-value | current `0.035ms` | session index `0.028ms` | query rewrite 约 `175x`；index 只有约 `1.2x` |
| agent-filter page 1 | `1.953ms` | agent composite `0.027ms` | 但当前 renderer 没有传 `agentId` 的 production caller |

### Plan truth

- pending current：`SCAN deepchat_messages` + temp B-tree；partial：只扫描
  `candidate_messages_pending_updated_partial`，无 temp sort；full 虽显示 `SEARCH status=?`，median 没更好。
- claimed current：扫描 session-leading index并对最后排序项建 temp B-tree；partial：只扫描 claimed partial
  index；full state-leading index没有额外收益。
- message/usage 在 generic `(created_at,id)` + row-value 下变成真正的
  `SEARCH ... ((created_at,id)>(?,?))`。
- `ANALYZE` 没有修好 expanded-OR；session normalization 反而形成 `MULTI-INDEX OR` + temp sort。不能用
  `ANALYZE` 替代 query-shape 修复。

## Metadata N+1

100k current schema、30-row page 的 metadata lookup 部分：

| Shape | Page total query count | Median | 结论 |
| --- | ---: | ---: | --- |
| current per-row get | 31 | `0.089ms` metadata step | 30 次 PK prepare/get，结果正确但 query count 线性增长 |
| batch `IN (...)` | 2 | `0.017ms` metadata step | current schema 即可使用，约 `5.2x` |
| `LEFT JOIN` | 1 | `18.892ms` without session index | current planner 全表 scan + sort，不可直接采用 |
| `LEFT JOIN` + session kind index | 1 | `0.011ms` | 很快，但为了省 1 个 query 绑定一个高写成本 index，不划算 |

因此 `SES-LIST-002` 应先实现 batch metadata port，保持 Cron parse/missing 语义；不要为了 JOIN 顺手批准
session index。`getMany()` 和 `prioritizeSessionId` 也要复用 batch owner，否则只修 listPage 会留下另一条 N+1。

## Keep / drop 决策

### 进入 `DB-002`

1. **Keep** partial pending recovery：

   ```sql
   CREATE INDEX ... ON deepchat_messages(updated_at DESC) WHERE status = 'pending';
   ```

2. **Keep** shared message cursor：

   ```sql
   CREATE INDEX ... ON deepchat_messages(created_at, id);
   ```

3. **Keep** partial claimed recovery：

   ```sql
   CREATE INDEX ... ON deepchat_pending_inputs(session_id, created_at)
   WHERE state = 'claimed';
   ```

4. **Required companion change**：normalization 与 usage keyset 改成 row-value comparator。只加 index 仍会在
   deep cursor 扫描大量 index entries。

5. `DB-002` 必须补真实 old-current DB migration、fresh/upgraded index parity、0/1/10/100 pending/claimed、
   `SQLitePresenter.open()+migrate()` 阻塞时间和 query result tests。本报告的 direct build 不能代替这些 gate。

### 不进入 `DB-002`

- **Drop** full `(status,updated_at)`：与 pending partial 读延迟相同，却覆盖所有 status 并参与热更新。
- **Drop** permanent assistant-only/`(role,created_at,id)`：row-value 后 generic cursor 一样快；它只服务一次性
  backfill，却永久增加约 `1.53 MiB`（100k）和写成本。
- **Drop** full `(state,session_id,created_at)`：与 claimed partial 读延迟相同，却索引全部 consumed tombstone。
- P-11 retention 仍未决定；partial index 只修启动 lookup，不等于解决永久 payload 增长。

### 改写 `SES-LIST-001` 输入

先把 session keyset 的 expanded OR 改为 row-value comparator，并在真实 regular/subagent density 下重测。
本 fixture 90% regular 时，current single-column updated index 已把 row-value deep cursor 控制在约 `0.03ms`；
两个额外 session indexes增加约 `4.09 MiB`、让 5k lifecycle write 从 DB core `46.32ms` 增到 `58.04ms`，
当前证据不足以批准。

agent composite 虽显著加速 synthetic agent filter，但当前 renderer 没有该 production caller，明确否决。

## 不能从本报告推出什么

- 不能推出真实用户启动会快多少；isolated SELECT 后还有 materialization、session lookup、rewrite/update。
- 不能决定 consumed steer 是 delete、TTL 还是精简 tombstone；这是 `STEER-001` 的 retention contract。
- 不能把 10k/100k synthetic 密度当用户分位数，也不能把 Apple M5 毫秒外推到其他机器。
- 不能用 15 samples 声称稳定 p95；决策基于 plan、median/IQR 和组合成本。
- 不能声称 migration 已安全；production migration 尚未实现。
- 不涉及 E2E、renderer、packaged app 或大 payload；这些不属于 index selection 的证据边界。
