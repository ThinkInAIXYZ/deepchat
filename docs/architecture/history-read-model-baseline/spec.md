# History Read Model Baseline

Status: implemented; maintained measurement contract

Task: `HIS-001`

Findings: `P-01`, `P-02`

## 问题

当前一次常规 `sendMessage` 会在 provider 真正开始前多次调用
`DeepChatMessageStore.getMessages()`。每次调用都读取完整 session header、四类 structured rows，随后重建
全部 `ChatMessageRecord`；header query 还会聚合全局 `deepchat_message_traces`。

静态调用链证明重复工作存在，但不能据此虚构墙钟收益，也不能直接批准 cache、snapshot 或 query 重写。
`HIS-001` 只建立可复验基线，不改变发送、history、trace 或 provider 行为。

## 测量边界

一次样本从 `AgentSessionPresenter.sendMessage()` 开始，到第一次调用 provider `coreStream()` 为止。
只统计这段边界内的 history read：

| 指标 | 含义 |
| --- | --- |
| `getMessagesCallCount` | 完整 history read 次数 |
| `headerRows` | `deepchat_messages` header 返回行数总和 |
| `structuredRows` | user、file、link、assistant block 返回行数总和及分类 |
| `historySqlStatementCount` | `getMessages()` 边界内实际执行的 table query 数 |
| `historySqlDurationMs` | 上述 query 的累计墙钟时间 |
| `materializationDurationMs` | structured rows 转为 `ChatMessageRecord` 的累计时间 |
| `providerStartElapsedMs` | send 入口到第一次 provider call 的时间 |
| `eventLoopDelayMs` | 同一边界内 timer delay；若 timer 未在首次 provider 入口前触发则为 `null` 并标记 censored，不等待边界外 timer，也不把它伪装成 CPU profiler |

指标不得记录 prompt、message content、file path、tool payload、provider credential 或 trace payload。

## Fixture 矩阵

- Target session message 数：`10 / 100 / 1,000 / 10,000`。
- Global trace noise：`0 / 10,000 / 100,000` rows，共 12 个 scenario。
- Target messages 按 user/assistant 交替，包含当前 inline item schema；global trace noise 关联到其他 session 的
  messages，从而隔离“读取一个 session 却聚合全局 trace”的成本。
- 每个 scenario 记录 `1` 次 warmup 和 `5` 次 measured samples；报告 median、p95 和原始 samples。
- 保存 Node、Electron、SQLite、CPU、OS、commit、时间、fixture seed、数据量和重复次数。

## Contract

- instrumentation 只存在于 benchmark Vitest harness：prototype spy 包裹
  `DeepChatMessageStore.getMessages()`，并包裹同一 real `SQLitePresenter` 的五类 table 实例；不增加
  production runtime port、route 或常驻 observer。
- production 未安装 benchmark spy，自然不生成指标、不写文件、不增加额外 SQL。
- benchmark collector 是测量真源；collector 抛错必须让 benchmark 失败，不能吞错后生成残缺报告。
- SQL 计数来自真实 table call 包装，不用常量 `5` 推导；structured row 数来自真实 query result。
- provider-start 只在第一次进入 provider 前结算一次；retry 和后续 provider round 不重复结算该 sample。
- sample 在首次 provider 入口同步冻结；timer 未触发的 event-loop probe 立即取消并记 censored，不能为补齐数字等待边界外事件。
- benchmark 生成结果到本 SDD 的 `results/raw.json` 与 `results/report.md`，不得覆盖其他审计报告。
- 不改 schema、query、cache、Tape watermark、pending predicate 或 UI；不跑 full/E2E。

## 测量结论

正式结果来自 clean commit `e16b00c403190d72aa791bf86312b12434b25cef`。12 个 scenario
均为 `1` 次 warmup 加 `5` 次 measured sample，fixture count 无漂移：

- 每个 sample 在首次 provider 入口前固定发生 `8` 次完整 `getMessages()`；因此非空 session 的
  `hadMessages` 检查本身已造成一次完整 materialization，后续 runtime 路径又重复读取。
- 交替 user/assistant fixture 的真实 SQL statement 总数为 `120 / 840 / 8,040 / 80,040`，分别对应
  `10 / 100 / 1,000 / 10,000` 条 target message。除每次 history read 的五类批量 table call 外，空
  file/link projection 会按 user message 再触发真实 fallback table call；这是 benchmark 观察到的代码
  真相，不是用常量推导的估算。
- header rows 和 structured rows 都是 `8 × target message count`；当前 fixture 的 structured 分类各为
  一半 user、一半 assistant block，file/link 为 `0`。
- 12 个 query plan 都先 `MATERIALIZE` trace 子查询并扫描 `deepchat_message_traces`。固定 target size 时，
  global trace noise 从 `0` 增至 `100,000`，SQL median 在四组 target size 上分别从
  `0.824 → 14.614ms`、`4.646 → 18.300ms`、`44.465 → 57.734ms`、
  `512.728 → 529.244ms`；影响在本机五次 measured sample 中可重复。
- 10,000-message fixture 的 provider-start median 从 0-trace 的 `933.941ms` 增至
  100,000-trace 的 `974.807ms`。这是本机墙钟基线，不外推为其他设备收益预测。
- 60 个 event-loop timer probe 全部在 provider 入口前未触发，因此全部记录为 `null / censored`；本轮
  不对 event-loop delay 或 CPU 占用下结论。

完整原始样本和环境见 `results/raw.json`，deterministic 汇总和 query plan 见 `results/report.md`。

## Go / No-go

| 后续任务 | HIS-001 证据 | 结论 |
| --- | --- | --- |
| `HIS-002` | 非空 session 的 `hadMessages` 路径真实执行完整 history materialization | `GO`，可进入 predicate contract 工作 |
| `HIS-003` | real history query/materialization 携带 trace count；12 个 plan 均全局聚合 trace，noise 对 SQL time 有重复影响 | `GO`，可进入 projection contract 工作 |
| `HIS-004` | 一次 send 在 provider-start 前有 `8` 次完整 read，但 `HIS-002/003` 尚未先完成 contract 稳定 | `NO-GO`，保持顺序门禁，不提前做 cache/snapshot |

若数据否定 finding，对应任务标记“证据否定”，不得为了完成路线图强行重构。

## 验收

- benchmark prototype/table wrapper 的 exact-count、first-provider-only、production-absent、
  collector-failure 反例通过；
- 12 个 scenario 原始结果可由同一命令重新生成，报告能从 raw data deterministic render；
- query plan 明确记录 global trace aggregation 是否发生；
- typecheck、format、i18n、lint、targeted tests、diff check 通过；
- 独立 reviewer 对代码、raw data 和报告复算后 `PASS / 0 BLOCKER`；
- 无 `[NEEDS CLARIFICATION]`，无 full/E2E。
