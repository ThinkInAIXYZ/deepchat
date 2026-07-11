# History Existence Query

Status: implemented; maintained existence contract

Task: `HIS-002`

Finding: `P-01`

Evidence: `docs/architecture/history-read-model-baseline/results/{raw.json,report.md}`

## 问题

`AgentSessionPresenter.sendMessage()` 在发送前只需要知道 session 是否已有消息，却调用完整
`getMessages()`。HIS-001 的 real-send fixture 证明 provider-start 前固定有 8 次完整 history read，其中一次就是
这个 `hadMessages` 判断。

## Contract

- `IAgentImplementation.hasMessages(sessionId)` 是 required capability，不增加 optional fallback。
- DeepChat owner 使用 `SELECT 1 FROM deepchat_messages WHERE session_id = ? LIMIT 1`；不读取 message ID、content、structured rows 或 trace count。
- `sendMessage()` 用该结果保持原 title generation 语义：只有 non-draft 且此前无消息时异步生成标题。
- existence query 失败沿用当前 send 行为向调用方抛出，不能返回 `false`、`true` 或空数组掩盖错误。
- 已有只判断 boolean 的 transfer/reusable-draft helper 复用同一 required API；其原有 catch-and-conservative-true contract 保持不变。
- `getMessageIds()` 保留给真实需要 ID 列表的调用方，不改变 public route、renderer、schema、migration 或 UI。

## 非目标

- 不修 empty file/link bucket 的 per-user fallback N+1。
- 不拆 runtime/UI history projection，不改 global trace aggregation。
- 本切片不做一次 send snapshot/cache；当时 `HIS-004` 保持 NO-GO，待
  HIS-002/003 contract 稳定后已由独立 architecture SDD 实施。
- 不增加 runtime flag、metric hook、事件总线或通用 repository abstraction。

## 验收

- real SQLite empty/non-empty existence 与 query plan 有 focused test；
- send 的 empty/non-empty/draft/title/error contract 有反例，且 hadMessages 不再调用 `getMessages/getMessageIds`；
- HIS-001 quick real-send fixture 从 `8` 次完整 read 降为 `7`，10-message fixture 的 history SQL 从 `120` 降为 `105`；正式 HIS-001 raw baseline 不被覆盖；
- typecheck、format、i18n、lint、targeted tests、diff check 通过；
- production diff 仅包含 existence contract 的必要调用链；无 full/E2E；
- 独立审查 `PASS / 0 BLOCKER`，无 `[NEEDS CLARIFICATION]`。

## 实施结果

- `DeepChatMessagesTable.hasBySession()` 到 required `IAgentImplementation.hasMessages()` 的调用链已落地；
  `sendMessage()` 和 boolean-only helper 不再用完整 history 或 ID 列表判断存在性。
- real SQLite empty/non-empty/query-plan tests `3/3`；相关 main focused tests `337 passed / 2 ABI skipped`。
- HIS-001 direct quick fixture 从 `8 → 7` 次完整 read、`120 → 105` 条 history SQL；正式
  `raw.json/report.md` hash 前后一致，没有用新结果覆盖历史基线。
- typecheck、format、i18n、lint、diff check 通过，独立审查 `PASS / 0 BLOCKER`；未跑 full/E2E。
