# Database Query Baseline Tasks

## DB-001

- [x] 从 production source 固定五类 query family、metadata N+1 和现有 index truth。
- [x] 定义 deterministic 10k/100k fixture、样本数、warmup、机器信息与结果边界。
- [x] 定义 full/partial/minimal 候选组合，但不提前批准 production migration。
- [x] 实现 temp-only Electron-ABI benchmark CLI 与 fixture/result-equivalence assertions。
- [x] 覆盖 current/dbCore/partialSuite/assistantPartial/fullComposite 的 pre/post-ANALYZE plan、latency、direct
  index build、page/file bytes。
- [x] 覆盖 page 1、50%/90%/99% cursor、regular/agent session list 和 metadata 31/2/1 query variants。
- [x] 覆盖 expanded-OR/row-value keyset control，并断言所有结果等价。
- [x] 覆盖四组 5k insert + message/session/input lifecycle write cost。
- [x] 完成 1k smoke。
- [x] 生成 10k/100k raw JSON。
- [x] 写 keep/drop 结果报告，并明确后续 `DB-002`/`SES-LIST-001`/`SES-LIST-002` 输入。
- [x] 独立 verifier 复核 SQL 等价性、数据分布、统计口径和结论边界。
- [x] 跑 `typecheck:node`、`format:check`、script `oxlint --no-ignore`、syntax、`git diff --check`；不跑
  full/E2E。
- [x] 本地 squash 合并为 `8d0b158f`，并回填统一实施台账。

## Blocking gate

- [x] 无 `[NEEDS CLARIFICATION]`。
- [x] benchmark 不写仓库 temp DB 或用户数据库。
- [x] raw result 记录被测 git commit、机器、OS、CPU、内存、Node、SQLite/native module 版本。
- [x] 所有 measured SQL 与 production source 对账。
- [x] 结果不把单机毫秒外推为所有用户绝对耗时。
- [x] 没有把 metadata、recovery、retention 等真实需求当成“可以直接删除”。
- [x] 没有仅凭 temp B-tree/scan 名称就批准索引；同时记录读收益、migration、size、write cost。
- [x] 报告明确 isolated SQL/direct index build 不能代替完整 constructor/backfill 或 production migration。

## Final verification

- HEAD `94d4f34a` 独立复核通过，`0 BLOCKER`。
- current 与四组 candidate 共 `400` 个 query records 的 ordered-row hash 全等；expanded OR 与 row-value
  50%/90%/99% 结果全等；pre/post-ANALYZE plan key 完整。
- raw 的 15 samples、median/IQR/min/max/descriptive p95/mean 全量复算一致；report 的成本、size、write、query
  和 metadata 数字与 raw 一致。
- 1k smoke、受控失败 temp cleanup、Node syntax、script `oxlint --no-ignore --deny-warnings`、
  `typecheck:node`、`format:check`、`git diff --check` 通过。
- 未运行 full/E2E；本任务不改 production runtime，完整 migration/open/result/parse 仍是后续切片 gate。
