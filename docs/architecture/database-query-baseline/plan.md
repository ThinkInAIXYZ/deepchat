# Database Query Baseline Implementation Plan

## 顺序

1. 复制 production 的相关 table/index/query shape 到独立 benchmark fixture，并用 source path 注释标记 owner。
2. 用 1k smoke 先验证 row counts、query result、cursor tie-breaker、plan capture 和 temp cleanup。
3. 生成 10k/100k current schema 数据库；从同一 base clone 出 current、DB core partial、full partial suite、
   assistant partial、full composite 五个场景，逐项记录 index/drop build time。
4. 各组先保存 `ANALYZE` 前 plan，再记录 `ANALYZE` 时间；分别执行 first measured invocation、3 次 warmup +
   15 次 samples，保存 raw plan、median/IQR 与 descriptive p95；first measured invocation 不称为 cold/new
   connection。每个 deep cursor 同时跑 production expanded-OR 与等价 row-value control，并断言结果一致。
5. 四组各执行 5k insert + lifecycle update/delete，记录 transaction、checkpoint、page/file bytes 变化。
6. 生成 JSON，再由代码真相人工复核 plan/result，写 `report.md` 的 keep/drop 决策。
7. 独立 verifier 检查 SQL 等价性、fixture 分布、统计口径和结论边界；blocking finding 回原 branch 修复后只重跑
   benchmark/相关检查，不跑 full/E2E。
8. 本地合并并回填统一实施台账。

## 数据流

```text
production SQL/index inventory
            |
            v
deterministic base fixture -----> current clone -------------> query + lifecycle writes
            |
            +-------------------> DB core partial clone -----> query + lifecycle writes
            +-------------------> partial suite clone --------> query + lifecycle writes
            +-------------------> assistant partial clone ---> query + lifecycle writes
            +-------------------> full composite clone ------> query + lifecycle writes
                                                               |
                                                               v
                                                    raw JSON + keep/drop report
```

## 结果判读

索引不是按“有改善”就保留。逐项考虑：

- 100k plan 是否真正移除全表 scan/temp sort；
- page 1 与 50%/90%/99% cursor 是否都受益；
- median/IQR 是否稳定；15 samples 的 p95 只描述本次运行，不作为尾延迟承诺；
- 是否与另一个候选完全重叠；
- build time、DB bytes 和 5k incremental write 是否值得；
- query 是否每次启动/首屏触发，还是只在一次性 backfill 触发。

metadata batch/join 只证明 query-count/latency tradeoff，不在 `DB-001` 选择 owner API；Cron metadata 解析、
missing 语义、`getMany()` 与 `prioritizeSessionId` 仍由 `SES-LIST-002` 集成验证。

本报告只测与 index 直接相关的 SQL。完整 normalization/usage 会继续写 search/usage tables，pending/claimed
recovery 会继续 materialize/update；直接建索引也不是尚未存在的 production migration。这些不能从 DB-001
结果外推，分别留给 `DB-002`/`SES-LIST-*` 的真实 migration 与 focused integration gate。

## 验证命令

```bash
ELECTRON_RUN_AS_NODE=1 pnpm exec electron scripts/database-query-baseline.mjs \
  --rows 1000 --samples 3 --warmups 1 --write-rows 100
ELECTRON_RUN_AS_NODE=1 pnpm exec electron scripts/database-query-baseline.mjs \
  --rows 10000,100000 \
  --samples 15 \
  --warmups 3 \
  --write-rows 5000 \
  --output docs/architecture/database-query-baseline/results/2026-07-11-macos-arm64.json
pnpm run typecheck:node
pnpm run format:check
git diff --check
```

不运行 full suite 或 E2E：本任务不改 production runtime，准确性由 SQL source 对账、fixture assertions、plan、
raw samples 和独立复核证明。

## 回滚

本任务只有 benchmark/docs。回滚删除对应 script、结果和 SDD 即可；没有用户数据库或 migration 需要回滚。
