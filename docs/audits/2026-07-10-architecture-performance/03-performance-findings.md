# 03 - 性能热点与数据库查询问题

本章的“高”表示静态调用次数、SQL 形状或数据复制路径已被证明；除明确列出的 query plan 外，没有
真实用户库 profiler，因此不写虚构毫秒数。

---

## P-01 [高][已确认] 常规一次发送约 8 次完整物化同一 session history

### 适用条件

DeepChat session 已存在且有历史消息、runtime state 已加载、当前 idle、无 pending interaction，发送入口走
`queuePendingInput`。这是当前 built-in agent 的常见长会话路径；空会话也会重复调用，但 structured
child-table 查询会走空集合 fast path。

### 调用链

```text
AgentSessionPresenter.sendMessage
  1. agent.getSessionState -> hasPendingInteractions -> getMessages
  2. agent.getMessages -> 仅用于 hadMessages
  -> AgentRuntime.queuePendingInput
     3. getSessionState -> hasPendingInteractions -> getMessages
     4. isAwaitingToolQuestionFollowUp -> getMessages
     5. canStartPendingQueueDrain -> isAwaiting... -> getMessages
     6. canStartPendingQueueDrain -> hasPendingInteractions -> getMessages
     -> processMessage (fire-and-forget starts synchronously)
        7. hasPendingInteractions -> getMessages
        8. ensureSessionTapeReady -> getMessages
```

关键位置：

- [`AgentSessionPresenter.sendMessage`](../../../src/main/presenter/agentSessionPresenter/index.ts#L736)：
  [L759](../../../src/main/presenter/agentSessionPresenter/index.ts#L759) 全量读取只为 `.length > 0`，结果仅
  决定 title generation。
- [`getResolvedSessionState`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L951) 调
  `hasPendingInteractions()`。
- [`queuePendingInput`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L1055) 与
  [`canStartPendingQueueDrain`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4208) 重复 guard。
- [`processMessage`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L1234) 再检查一次。
- [`hasPendingInteractions`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L7023) 和
  [`isAwaitingToolQuestionFollowUp`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L7036) 都先完整
  `messageStore.getMessages()`，再遍历、parse assistant blocks。
- [`ensureSessionTapeReady`](../../../src/main/presenter/agentRuntimePresenter/tapeService.ts#L868) 再读取全部
  history。

### 单次 `getMessages()` 的真实成本

[`messageStore.getMessages`](../../../src/main/presenter/agentRuntimePresenter/messageStore.ts#L284) 不是轻量
header query：

1. `deepchat_messages.getBySession` 查询全部消息；
2. [`toRecords`](../../../src/main/presenter/agentRuntimePresenter/messageStore.ts#L707) 重建所有 record；
3. [`loadStructuredMaps`](../../../src/main/presenter/agentRuntimePresenter/messageStore.ts#L938) 对 user、file、
   link、assistant blocks 再做四个批量查询；
4. `materializeContent` 重新组装并 `JSON.stringify` 内容。

因此普通一次发送约为 8 轮 O(N) 物化，基础形状约 8 × 5 = 40 条同步 better-sqlite3 query，另加
blocks parse、Tape/provenance 查询和后续 context 工作。这里的“约”来自分支和空集合 fast path，
不是 benchmark 推算。

### 意图核验

pending interaction guard 是正确性要求，structured bulk read 也已经避免逐消息 N+1；问题不是这些能力
不该存在，而是每个 guard 各自构建相同 rich read model。代码后续已经把 `tapeReady.historyRecords`
复用于 compaction/context，说明单次 snapshot 复用符合现有设计。

### 建议与验证

- 先将 `hadMessages` 改为 existence/count API；当前已有 `getMessageIds`，表层还有
  [`getMaxOrderSeq`](../../../src/main/presenter/sqlitePresenter/tables/deepchatMessages.ts#L252) 可提供 O(1)
  语义，但最终应定义明确 `hasMessages`。
- 为 pending/question guard 维护增量 runtime state，或在一次 send orchestration 内共享一份 history。
- 用 10/100/1k/10k messages 统计 provider start 前 `getMessages` 次数、SQL 数、event-loop delay；验收
  目标先定“每 send 一次 history snapshot”，再谈毫秒。

---

## P-02 [高][已确认] 每次 rich history read 都先聚合全局 trace 表

[`deepchatMessages.getBySession`](../../../src/main/presenter/sqlitePresenter/tables/deepchatMessages.ts#L142)
使用：

```sql
LEFT JOIN (
  SELECT message_id, COUNT(*) AS trace_count
  FROM deepchat_message_traces
  GROUP BY message_id
) t
```

subquery 没有先限制当前 session。trace 索引只有 `(message_id, request_seq DESC)` 和
`(session_id, created_at DESC)`。

按当前 schema 的内存 SQLite query plan：

```text
MATERIALIZE t
SCAN deepchat_message_traces USING COVERING INDEX idx_trace_message_seq
SEARCH m USING INDEX idx_deepchat_messages_session (session_id=?)
SEARCH t USING AUTOMATIC COVERING INDEX (message_id=?) LEFT-JOIN
```

因此读取任意一个 session 时，会先扫描/聚合全局 trace table。P-01 又可能在一次发送内重复执行多次。

### 意图核验

trace count 确实用于 UI/debug metadata；分页读取已经使用按 message id、可走索引的 correlated count
([`listPageBySession`](../../../src/main/presenter/sqlitePresenter/tables/deepchatMessages.ts#L161))。问题是
runtime guard/context/Tape 复用了带 UI trace count 的 rich read model。

### 建议与验证

拆分 runtime history 与 UI history projection；runtime predicate/context 不读取 trace count。固定当前
session 1k messages，分别准备全局 0/10k/100k traces 测 `getBySession()`。

---

## P-03 [高][已确认] Tape lazy backfill 永久停在“每次全量核对”模式

### 代码真相

每次 [`ensureSessionTapeReady`](../../../src/main/presenter/agentRuntimePresenter/tapeService.ts#L868)：

1. 读取并排序全部 messages；
2. 对每条 history 调 `appendMessageRecordToTape(..., 'backfill')`；
3. 写一次 idempotent migration event；
4. 再读取全部 Tape entries，构建 effective view 并返回 history。

每条 idempotent append 还会检查 provenance，assistant tool fact 会 parse blocks、hash payload。新消息本来
已经通过 [`appendLiveTapeFacts`](../../../src/main/presenter/agentRuntimePresenter/messageStore.ts#L669) 实时写
Tape，但下一轮仍从第一条 message 开始核对。

所有 Tape info/search/context/anchor API 都先调用 ensure；resume 路径在一次操作中还会调用两次
([`AgentRuntimePresenter`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4470)、
[L4495](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4495))。

### 复杂度判断

单轮是 O(N messages + E tape entries + provenance checks)。随着 turn 增长，每轮从头核对，累计工作
接近二次增长；tool facts 多时更重。这是复杂度事实，实际耗时仍需真实数据验证。

### 意图核验

Tape append-only、audit/replay、legacy session lazy backfill 都是明确需求，见
[`deepchat-tape-baseline/spec.md`](../../architecture/deepchat-tape-baseline/spec.md) 和
[`deepchat-tape-view-manifest/spec.md`](../../architecture/deepchat-tape-view-manifest/spec.md)。Tape 本身不是
重复设计。

冲突是缺少 `ready watermark / migration version / max source orderSeq` fast path，导致兼容迁移变成永久
hot path；message 与 Tape 两个 source 长期每次全量对账。

### 建议与验证

保存 per-session migration version 和最后 backfill source cursor；live append 成功后推进 watermark。
同一无变化 session 连续调用两次 ensure，第二次应为 O(1) 或只读取增量；记录 provenance query、parse
row 数和总耗时。

---

## P-04 [高置信风险，待 profile] streaming 全量 snapshot 在多层放大

### 当前全链路

主进程 renderer flush 120ms、DB flush 600ms
([`echo.ts`](../../../src/main/presenter/agentRuntimePresenter/echo.ts#L8))。

每次 renderer flush：

1. 全 blocks 做 `JSON.stringify` → `JSON.parse` → block Zod parse
   ([L19-L23](../../../src/main/presenter/agentRuntimePresenter/echo.ts#L19))；
2. typed publisher 再 parse 全 payload
   ([`publishDeepchatEvent`](../../../src/main/routes/publishDeepchatEvent.ts#L20))；
3. `sendToAllWindows` 遍历 main windows、每个 tab、settings、floating
   ([`WindowPresenter`](../../../src/main/presenter/windowPresenter/index.ts#L371))；
4. 有 listener 的 renderer bridge 再做 boundary parse
   ([`createBridge`](../../../src/preload/createBridge.ts#L52))；
5. inactive session 到 renderer 后才过滤
   ([`messageIpc`](../../../src/renderer/src/stores/ui/messageIpc.ts#L35))；
6. active renderer 做 blocks fingerprint/deep stable-block comparison。

这里还有一个契约错位：shared
[`IWindowPresenter`](../../../src/shared/types/presenters/window.presenter.d.ts#L55) 把
`sendToAllWindows` 声明为 `void`，concrete implementation 实际是 `async Promise<void>`；publisher 因而
fire-and-forget。若一次 tab enumeration 超过 120ms，下一次 snapshot fan-out 可以与上一轮重叠。

每次 DB flush：

- [`updateAssistantContent`](../../../src/main/presenter/agentRuntimePresenter/messageStore.ts#L218)；
- [`replaceForMessage`](../../../src/main/presenter/sqlitePresenter/tables/deepchatAssistantBlocks.ts#L99)
  transaction 内 DELETE 当前消息全部 block，再 INSERT 全量当前 block。

若 snapshot 随输出线性增长，累计复制、校验、IPC bytes 和 DB block rewrite 是
`Σ snapshot_size`；大 tool response、image/base64 block 会在后续文字 chunk 中反复携带。

### 意图核验与反驳

- 120ms/600ms throttle 是已有性能保护。
- snapshot 有丢包收敛、顺序简单和 renderer 恢复优势；不能无数据就改 delta。
- main authority 与 renderer trust boundary 两次 Zod validation 有安全/契约意义，不应简单删掉。
- preload 在没有 listener 时不会做第二次 parse，但 Electron IPC clone/send 已发生。

真正需要验证的是：内部 JSON deep clone、全窗口 fan-out、完整 snapshot 和 DB full replace 的组合上限，
不是“Zod 出现三次”本身。

### 验证门槛

分别测试 10KB/100KB/1MB text，再加 1MB tool response；窗口数 1/3；记录 event bytes、JSON/Zod CPU、
IPC clone、DB DELETE/INSERT rows、renderer commit time。数据出来后再选：targeted snapshot、large stable
block reference、append/upsert changed blocks，或真正 delta。

---

## P-05 [高][已确认] keyset backfill 已分页，但缺 cursor 对应 index

2026-07-06 修复已把 normalization 和 usage backfill 改成 50 条 keyset page，并纳入 coordinator：

- normalization query：
  [`AgentSessionPresenter`](../../../src/main/presenter/agentSessionPresenter/index.ts#L3539) 按
  `(created_at, id)` 排序；
- usage query：
  [`deepchatMessages`](../../../src/main/presenter/sqlitePresenter/tables/deepchatMessages.ts#L279) 按
  `role='assistant'` + `(created_at, id)` 排序。

但表只建 `(session_id, order_seq)` 索引
([`getCreateTableSQL`](../../../src/main/presenter/sqlitePresenter/tables/deepchatMessages.ts#L33))，没有
`(created_at,id)` 或 `(role,created_at,id)`。

等价 query plan：

```text
normalization: SCAN deepchat_messages; USE TEMP B-TREE FOR ORDER BY
usage:         SCAN m; ...; USE TEMP B-TREE FOR ORDER BY
```

每页会重新 scan/sort，N/50 页累计可能接近 O(N²/50) row visits。修复已经解决 `.all()` 内存峰值和
batch yield，但没有完成 keyset pagination 的数据库侧前提。

### 意图与优先级

这些任务只在升级、失败重试时运行，completed 后不再跑，所以不是日常 hot path。单次 SQL 仍是同步
better-sqlite3，yield 无法拆开一次全表 scan。应在下一轮修复中补 index，并评估写成本。

---

## P-06 [高启动风险][已确认] critical constructor 每次无索引扫描全部 messages

### 代码真相

- `AgentRuntimePresenter` constructor 同步执行
  [`recoverPendingMessages`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L726) 和 claimed input
  recovery。
- Presenter 在 critical READY hook 构造
  ([`presenterInitHook`](../../../src/main/presenter/lifecyclePresenter/hooks/ready/presenterInitHook.ts#L10))；
  splash 等所有 phase 完成后才关闭。
- recovery 使用
  [`getByStatus('pending')`](../../../src/main/presenter/agentRuntimePresenter/messageStore.ts#L601)。SQL 是
  `WHERE status=? ORDER BY updated_at DESC`
  ([`deepchatMessages`](../../../src/main/presenter/sqlitePresenter/tables/deepchatMessages.ts#L223))。
- 当前没有 `(status, updated_at)` index。

等价 query plan：

```text
SCAN deepchat_messages
USE TEMP B-TREE FOR ORDER BY
```

即使 pending=0，每次启动也扫描全部 message。存在 pending 时还会 structured materialize 并逐条写回。

### 意图核验

crash recovery 必要；对 pending question/permission 保留的 `shouldKeepPending` 也有正确性意义。问题是
query/index 和 critical constructor placement，而不是要删除 recovery。

这也修正了 2026-07-04 报告 F4 中“当前 constructor 只做引用装配”的说法；当前代码至少存在这一条
同步 DB 工作，详见[旧报告对账](./06-prior-audit-reconciliation.md)。

---

## P-07 [高正确性][已确认] 两层 system prompt cache 让性能 fallback 破坏语义

### 内层 AGENTS cache

- 首次 read budget 200ms、TTL 30s
  ([`systemEnvPromptBuilder`](../../../src/main/lib/agentRuntime/systemEnvPromptBuilder.ts#L22))。
- 超时返回空/旧 fallback，但原 disk Promise 继续完成并更新 module cache
  ([L128-L190](../../../src/main/lib/agentRuntime/systemEnvPromptBuilder.ts#L128))。

### 外层 session prompt cache

- 在读取 AGENTS/skill content 之前计算 fingerprint
  ([`AgentRuntimePresenter`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4713))。
- fingerprint 相同且 local day 相同就直接返回旧 composed prompt
  ([L4734-L4741](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4734))。
- 只有 cache miss 才调用 `buildSystemEnvPrompt`
  ([L4785-L4798](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4785))。
- fingerprint 不含 AGENTS 内容/mtime，也不含 skill content 或 tool schema，仅含名称/signature
  ([L5089-L5123](../../../src/main/presenter/agentRuntimePresenter/index.ts#L5089))。

### 已确认组合后果

```text
首次 AGENTS read > 200ms
-> env prompt 不含 AGENTS
-> 外层缓存 composed prompt 到当天
-> 后台 read 完成，内层已有新内容
-> 下一 turn 在外层提前 return
-> 新内容不再被读取
```

除非显式 invalidation、其他 fingerprint 字段变化或跨日，慢读结果可能整天不生效。即使首次读取成功，
当天原地修改 AGENTS/skill 内容也没有内容/mtime fingerprint 或 watcher invalidation 保证。

### 意图核验

内层测试只证明“直接再次调用 builder 会拿到 late cache”
([`systemEnvPromptBuilder.test.ts`](../../../test/main/lib/agentRuntime/systemEnvPromptBuilder.test.ts#L71))；
没有覆盖真实外层 cache。历史目标正是“不阻塞首轮、后续消息复用新内容”，当前组合违背目标。

### 建议

正确性优先于 cache hit：外层 fingerprint 纳入 env/skill content revision，或 late refresh 完成后主动
invalidate 对应 session；加入两层组合测试。module-global AGENTS cache 和 per-session prompt/tool cache
也应有容量/生命周期预算，但那是次级问题。

---

## P-08 [中高][已确认] lightweight session list 仍有全表排序与 metadata N+1

Renderer 首屏 page size 为 30
([`session store`](../../../src/renderer/src/stores/ui/session.ts#L72))。

### 主 page query

[`newSessions.listPage`](../../../src/main/presenter/sqlitePresenter/tables/newSessions.ts#L215) 常见条件是
`session_kind='regular'`，排序 `(updated_at DESC,id DESC)`。已有 index 只有 `agent_id` 与
`updated_at DESC` ([L69-L75](../../../src/main/presenter/sqlitePresenter/tables/newSessions.ts#L69))，没有
`(session_kind,updated_at,id)` 或 filter 对应复合 index。合成 100k rows 的等价 plan 会出现 table scan
或 temp B-tree/last-term sort。

### metadata N+1

[`NewSessionManager.listPage`](../../../src/main/presenter/agentSessionPresenter/sessionManager.ts#L93) map 每条
row；[`mapRowToRecord`](../../../src/main/presenter/agentSessionPresenter/sessionManager.ts#L235) 对每条调用
metadata table `get(sessionId)`，所以 30 条首屏是 1 个 page query + 30 个 PK query。

metadata 是 Cron session badge 的真实需求，不是无用字段；它在 `0b615c7b` 加入。问题是 feature 加到
read model 后没有 batch/join。

### 建议

按真实 filter/order 建 index；metadata 用 LEFT JOIN 或 `WHERE session_id IN (...)` 批量加载。用 1k/100k
sessions 比较 page 1 和深 cursor，并确认新增 index 的 write/migration 成本。

---

## P-09 [高][已确认] FTS 零命中被误判为 FTS 不可用

### 调用链

Spotlight 80ms debounce 后对每个非空 query 调 history search
([`spotlight.ts`](../../../src/renderer/src/stores/ui/spotlight.ts#L298))。

[`AgentSessionPresenter.searchHistory`](../../../src/main/presenter/agentSessionPresenter/index.ts#L1178)：

1. FTS search；
2. 如果 `rows.length === 0`，对 structured search documents 执行 `%LIKE%`
   ([L1190-L1201](../../../src/main/presenter/agentSessionPresenter/index.ts#L1190))；
3. structured 仍无可用 hit，再对 `new_sessions`、`deepchat_messages` 做 raw `%LIKE%`
   ([L1261-L1301](../../../src/main/presenter/agentSessionPresenter/index.ts#L1261))。

[`DeepChatSearchDocumentsTable`](../../../src/main/presenter/sqlitePresenter/tables/deepchatSearchDocuments.ts#L75)
已有 `isFtsAvailable()`，但 caller 不使用；`searchFts()` 把“不支持”和“正常零结果”都表现成 `[]`。
另一方面，FTS query 真正 throw 时这里没有 catch，反而不会进入 LIKE fallback。

### 意图核验

历史 normalization spec 明确要求“FTS 不可用或失败时回退 LIKE”，不是“零结果时扫描所有旧表”。
现实现把正常 negative query 变成最重路径，而且 raw `%query%` 很难使用普通 B-tree prefix index。

### 建议

根据 availability + migration/backfill state 选 fallback；FTS 正常且迁移完成时零命中应直接返回。测试必须
断言正常 zero hit 不调用 structured/raw LIKE，并覆盖 FTS throw 的真实 fallback。

---

## P-10 [高场景风险] FFF 失败后新 query 仍重试；满额延迟待测

### 代码真相

- FFF 与 filesystem fallback 各有 2,500ms budget
  ([`fileSearcher.ts`](../../../src/main/presenter/workspacePresenter/fileSearcher.ts#L21))。
- warning 有 30s 去重，但失败尝试没有 cooldown/circuit breaker
  ([L178-L196](../../../src/main/presenter/workspacePresenter/fileSearcher.ts#L178))。
- 每个 cache entry 都先 FFF、catch 后 filesystem
  ([L327-L373](../../../src/main/presenter/workspacePresenter/fileSearcher.ts#L327))。
- cache key 包含 query/pattern，新输入产生新 entry；失败 finder 又会被删除
  ([`fffSearchService`](../../../src/main/lib/agentRuntime/fffSearchService.ts#L422))。
- 现有测试明确断言两个不同 query 调 FFF 两次、warning 只一次
  ([`fileSearcher.test.ts`](../../../test/main/presenter/workspacePresenter/fileSearcher.test.ts#L125))。

所以“不同 query 会重复尝试”是已确认行为；2,500ms 是 timeout budget，不是每次固定延迟。
native/import 失败可能立即返回，只有 scan timeout 类场景可能再付出最多该 budget；其命中率和总延迟需动态测量。

### 意图核验

[`fff-large-workspace-timeout/spec.md`](../../issues/fff-large-workspace-timeout/spec.md) 明确要求保留 bounded
filesystem fallback，并要求 warning 去重；fallback 本身不是过度设计。文档没有要求对同一 workspace
反复执行已知失败的 FFF。

filesystem fallback 每次从 root BFS，达到 20k entries/2.5s 后没有持久 cursor，下一 query 还可能重复
扫描同一前缀。

### 建议

保留 fallback，但不对所有 FFF error 统一熔断。先将失败分为 native library/初始化
不可用、workspace scan timeout、query/pattern 特定错误和瞬时 IO 错误：只有前两类可以进入
per-workspace cooldown，query-specific error 不得压掉其他查询，瞬时错误使用短冷却。状态机至少需记录
`failureKind`/`disabledUntil`，冷却后只放行一次 half-open probe，成功即清状态；冷却值应由
连续输入 telemetry 决定，不在静态审计里猜毫秒。filesystem scan 另行支持可恢复 cursor。
验收要覆盖 5-10 个连续 query、half-open 恢复和“一个坏 pattern 不影响其他 query”。

---

## P-11 [中低][已确认留存，意图不明] consumed steer tombstone 永久保留

[`pendingInputStore`](../../../src/main/presenter/agentRuntimePresenter/pendingInputStore.ts#L259) 对 queue consumed
直接 delete，对 steer consumed 只改 `state='consumed'` 并保留完整 payload。仓内没有 consumed history 的
业务读取或 retention cleanup；只在删除整个 session 时清表。

启动 recovery 的 `listClaimed()` 按全局 `state='claimed'` 查询
([`deepchatPendingInputs`](../../../src/main/presenter/sqlitePresenter/tables/deepchatPendingInputs.ts#L119))，
现有 index 以 `session_id` 开头，不支持按全局 state 定位。consumed rows 越多，启动 scan 基数越大。

steer spec 需要“消费后不能重跑”，但没有证据表明必须保存永久审计 row；queue 又选择 delete。应先确认
是否有未来审计需求，再选择 delete、TTL 或精简 tombstone；当前不能武断判定一定应删除。

---

## P-12 [C][待测预算缺口] message、search、Tape 多层表示没有 size/retention budget

这里不把五层简化成“完整 payload 存了五遍”。当前代码可以精确证明的是：

1. [`deepchat_messages.content`](../../../src/main/presenter/sqlitePresenter/tables/deepchatMessages.ts#L35)
   保留完整序列化 message；user create 和 assistant finalize 的 dual-write 分别在
   [`messageStore.ts#L142`](../../../src/main/presenter/agentRuntimePresenter/messageStore.ts#L142) 和
   [`messageStore.ts#L227`](../../../src/main/presenter/agentRuntimePresenter/messageStore.ts#L227)。
2. assistant structured table 把 block 拆成 text/tool fields，并把 `imageData`、tool preview 等写入
   [`extra_json`](../../../src/main/presenter/sqlitePresenter/tables/deepchatAssistantBlocks.ts#L25)；因此对带图像或工具
   response 的 block，这一层会与 legacy JSON 重叠显著 payload。
3. [`deepchat_search_documents`](../../../src/main/presenter/sqlitePresenter/tables/deepchatSearchDocuments.ts#L45)
   只存提取后的 searchable text/title；FTS 是 external-content index，不应计为第三份完整
   message payload。
4. Tape message fact 确实将完整 `ChatMessageRecord.content` 和 metadata 放入
   [`payload_json`](../../../src/main/presenter/agentRuntimePresenter/tapeFacts.ts#L232)；Tape tool-result fact 另外保存
   `response` 和 `imagePreviews`（[`tapeFacts.ts#L151`](../../../src/main/presenter/agentRuntimePresenter/tapeFacts.ts#L151)）。

因此“存在多层物理放大”有代码证据，但放大倍数、哪类 payload 主导和用户数据库增长均
没有实测；所以 P-12 是 C 级 budget gap，不是已证明的性能故障。

### 意图核验

[`agent-system.md`](../../architecture/agent-system.md) 明确 structured + legacy fallback + FTS；Tape spec 明确
append-only/replay。多副本是 compatibility、query projection、audit 三个目标叠加，不能简单删除任一层。

缺口是没有跨层 storage amplification 指标、payload-specific offload、retention/compaction budget。先用
SQLite `dbstat`/表级 page 统计和代表性 fixture，分别计算 text/tool/image/file 逻辑 bytes 对应的
`messages`、structured rows、search projection/index 和 Tape bytes，再判断是否需要 offload 或 retention 政策。
