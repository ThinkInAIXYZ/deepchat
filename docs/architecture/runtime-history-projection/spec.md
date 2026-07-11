# Runtime History Projection

Status: implemented; maintained projection contract

Task: `HIS-003B`

Findings: `P-01`, `P-02`

Evidence: `docs/architecture/history-read-model-baseline/results/{raw.json,report.md}`

## 问题

`DeepChatMessagesTable.getBySession()` 是 UI/debug rich read：它为每条 message 提供 `traceCount`，但实现会先
聚合整个 `deepchat_message_traces`。runtime predicate、context、compaction 和 Tape lazy backfill 不使用
trace count，却复用了同一 query。HIS-001 的 12 个 query plan 都证明 global trace materialize/scan；HIS-002
和 HIS-003A 已先把完整 read 次数与 structured N+1 分别收敛。

## Projection Contract

| Projection | Owner / caller | Trace contract |
| --- | --- | --- |
| rich history | public `AgentRuntimePresenter.getMessages()`、renderer/debug consumer | 保留真实 `traceCount` |
| runtime history | pending/question guard、context fallback、compaction fallback、Tape lazy backfill | 不 join/count trace；record 的 `traceCount` 固定为 `0` |
| paged UI history | 现有 `listMessagesPage()` | 保留按 message id 的 correlated trace count，不在本任务修改 |

- `DeepChatMessagesTable.getBySessionForRuntime()` 只按 session/order 读取 message header，不引用
  `deepchat_message_traces`。
- `DeepChatMessageStore.getRuntimeMessages()` 复用现有 structured bulk materialization，不复制 parser 或 domain
  policy。
- public `getMessages()` 保持 rich 行为与返回 shape，不用 runtime projection 冒充 UI data。
- `deleteFromOrderSeq()`、单 message mutation/retraction 等需要现有完整 fact 行为的路径不顺手迁移。

## Tape / Replay Compatibility

- Tape message record 的 `traceCount` 从来不是 trace UI 的真源；trace UI/replay trace payload 继续读取
  `deepchat_message_traces`。
- runtime backfill 写入的 message record 使用 `traceCount=0`。历史 Tape 中已有的非零值保持可读，不做 data
  migration，也不重写旧 entry。
- message/tool provenance、payload shape、effective view、ViewManifest selection、replay export shape不变。
- live append 仍走现有 single-message read；本任务只改变 lazy full-history backfill/query。

## 非目标

- 不改 trace schema、retention、Trace UI 或 replay trace payload。
- 不做 Tape watermark、snapshot/cache、history call 合并或 AgentRuntime service extraction。
- 不引入 repository abstraction、runtime flag、event bus 或兼容 fallback。

## 验收

- real SQLite runtime query plan 不出现 `deepchat_message_traces` / `MATERIALIZE t`，rich query仍返回真实 count；
- runtime guard/context/compaction/Tape backfill 不调用 rich full-history query；public getMessages仍调用 rich query；
- legacy Tape nonzero traceCount 可读，new runtime backfill为0，manifest/replay focused tests不回归；
- HIS-001 direct quick仍为 `7 reads / 35 SQL`，但 7 次都来自 runtime projection；正式 raw/report不被覆盖；
- typecheck、format、i18n、lint、targeted tests、diff check通过；独立审查 `PASS / 0 BLOCKER`；
- 无 full/E2E，无 `[NEEDS CLARIFICATION]`。

## 实施结果

- runtime predicate、context/compaction fallback 与 Tape full backfill 均使用 trace-free projection；public rich、
  paged UI、single-message 与 mutation paths保持原 contract。
- direct quick 为 `7` 次 history read：`0 rich / 7 runtime`，对应 `0 rich header / 7 runtime header / 35 SQL`。
- real SQLite runtime plan 不含 trace table或 `MATERIALIZE`，rich projection仍返回真实 `traceCount=2`。
- legacy Tape `traceCount=7` 可读，新 runtime backfill全部为 `0`；Tape、manifest、replay focused tests通过。
- Electron focused `340 passed`，另有 Tape focused `53 passed`；typecheck、format、i18n、lint、guards、diff
  check通过，正式raw/report hash不变；独立审查 `PASS / 0 BLOCKER`，未跑full/E2E。
