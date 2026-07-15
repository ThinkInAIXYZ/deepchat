# Tape 与可观测性

> 状态：目标合同，不是 current API reference。ASLR-052、ASLR-054、ASLR-080..081 与 ASLR-090 已接入
> 下述 round commit、ViewManifest、causal observation 和 stable per-fact recorder slice。继续使用现有
> Tape；不新建 event store 或 entry kind。

> Implementation progress: ASLR-052 placed the existing tool-round snapshot behind the fixed
> `afterRoundPersisted` callback. ASLR-090 retired that snapshot adapter: after the message projection
> commit, the callback now writes terminal tool-call/result facts through the stable per-fact
> `TapeRecorder.appendToolFact` port. Existing provenance, idempotency, pending exclusion, fact ordering and
> fail-open behavior remain unchanged. No Tape schema, entry kind, provenance field, or per-token write was
> added. ASLR-054 moved the existing
> ViewManifest attempt into the typed provider-attempt coordinator: each actual request sequence
> synchronously attempts its matching manifest before rate admission/provider streaming, and a
> persistence failure remains fail-open.
> ASLR-080 added a pure-read causal observation slice in the existing Tape service. It joins only persisted
> facts and reports the renderer event-history gap explicitly. ASLR-081 proved the reader does not mutate Tape,
> projections, replay state or Memory ingestion; the event-history gap remains explicit and unresolved.
> Subagent Tape lineage now separates true fork merge from production subagent finalization. True fork deltas
> and their receipt commit atomically; production children remain independent Tapes linked by a frozen-head
> `subagent/tape_linked` event and exposed only through an explicit, authorized, read-only View scope.

## 1. 模块目的

Tape 是当前 agent transcript pipeline 的 append-only semantic ledger：在存续 lineage 内，以有序事实解释一个 turn
看到了什么、产生了什么、为何进入下一步。它与 message projection、trace storage 各有不同职责：

```text
Tape          semantic facts, anchors, manifests, lineage
Message store mutable renderer projection and compatibility history
Trace store   sensitive/raw request-response diagnostics correlated by existing messageId/requestSeq
```

“append-only”不表示永久保存。session clear/delete/destroy 仍按当前合同删除 Tape。

## 2. BEFORE

现有 `tapeService.ts` 已经提供 bootstrap、effective view、search、manifest、replay 和 fork。相关写入
分散在 runtime、dispatch、compaction、handoff 与 Memory 接线中；mutable stream block 则主要存在于
message projection。

所以本次不是重新设计 Tape，而是把调用时序和 provenance 收敛成一个窄 `TapeRecorder`，避免新
`LoopEngine` 再次到处直接操作 store。

## 3. AFTER 的边界

```text
LoopEngine / DeepChatAgentInstance
        │ semantic operation
        ▼
TapeRecorder
├─ TapeStore (existing schema/order)
├─ ViewManifest writer
└─ Replay/query service

MessageProjection <--- projection mapper ---> Tape facts
TraceStore        <--- existing messageId/requestSeq correlation ---> observation reader
```

`TapeRecorder` 是现有 service 的窄 application adapter，不拥有新的数据库。direct `kind=acp` 为兼容
restart/search/export，也通过 `AcpCompatibilityProjectionAdapter` 写当前外层 pipeline 已经写入的 Tape
子集，但不运行 DeepChat LoopEngine。

## 4. 语义事实链

一个普通 turn 至少可以形成以下因果链：

```text
user message fact
  -> context/view manifest
  -> assistant content/tool-call facts
  -> tool result facts
  -> optional compaction/handoff/memory audit anchors
  -> current terminal message status + optional current runtime status
```

因果 observation 通过现有 `sessionId`、message/tool provenance、request sequence 联结 Tape、message、
status 与 trace。renderer event history 当前没有 durable store，因此 read model 只能返回
`eventHistory=not_persisted`，不得从 message status 推断 event。本目标不增加
interaction/terminal/trace-reference Tape entry；若以后证明有缺口，单独建立 data/behavior SDD。

## 5. `TapeRecorder` 合同

```ts
interface TapeRecorder {
  ensureSession(input: EnsureTapeSession): Promise<TapeHead>
  appendUserMessage(input: AppendUserMessageFact): Promise<TapeEntryRef>
  appendViewManifest(input: AppendViewManifest): Promise<TapeEntryRef | null>
  appendAssistantFact(input: AppendAssistantFact): Promise<TapeEntryRef>
  appendToolFact(input: AppendToolFact): Promise<TapeEntryRef>
  appendAnchor(input: AppendTapeAnchor): Promise<TapeEntryRef>
  readEffectiveView(input: ReadEffectiveView): Promise<TapeView>
}
```

API 应贴近现有 store 能力。不能引入通用 `append(type, payload)` 让所有调用方重新依赖内部 schema。

每个 write 只携带当前 store 已经支持的 `sessionId`、message/tool provenance、anchor metadata 等字段。
不为了新接口强加不存在的 `runId`/epoch column 或 trace ref payload。ViewManifest adapter 捕获当前 write
error、记录 warning 并返回 `null`，保持请求 fail-open。

## 6. 顺序与事务

- `entry_id` 继续提供 per-session monotonic order；
- user fact 必须在依赖它的 request manifest 之前；
- ViewManifest 必须描述实际交给 provider attempt 的 effective view；
- ViewManifest 在 request 前同步尝试，但 write failure 允许 request 继续；
- assistant/tool final facts 必须在 round persisted callback 之前可见；
- terminal message/status/event projection 只 settle 一次，Tape 不新增 terminal entry；
- message projection 与 Tape 无法单事务时，保持当前 commit/recovery 顺序并测试 crash window；
- Memory extraction 使用 effective Tape lineage，不从临时 mutable blocks 猜测最终事实。

### True fork 与 production subagent lineage

- true fork 在创建时记录精确 parent head，在 merge 开始时冻结 fork head；只复制 cutoff 内的 semantic
  delta，排除 `session/start` 与 `fork/start`；
- copied delta 与 parent `fork/merge` receipt 在同一 SQLite transaction 中 append；失败不留下部分 delta，
  已提交 retry 复用并校验既有 receipt；
- production subagent 是 durable child session/Tape，其 child entries 不进入 parent effective view。
  结算统一调用 typed `linkSubagentTape()`，以 `completed | error | cancelled` outcome append
  idempotent `subagent/tape_linked`；
- link receipt 冻结 child head/count，link event 同时冻结 child Tape incarnation identity。缺失
  capability 或 append 失败不得把任务标记为 Tape finalized；
- legacy external `fork/merge` 可在 direct-child ownership 成立时作为 completed link 读取；legacy
  `fork/discard` 只保留 audit 语义。true fork receipt 不会被误判为 external child link。

### Cross-Tape recall

- `AgentTapeViewScope` 只允许 `current | linked_subagents | current_and_linked`，默认仍是 `current`；
- linked source 每次读取都以 `new_sessions` 的 persisted direct-child relationship 授权，并同时校验
  link 的 Tape incarnation identity 与 frozen head；不递归 grandchildren，不接受任意 session id；
- search result 携带 source `sessionId` 并在所有 source 合并后应用一个 global limit；context 的
  `sourceSessionId` 每次只展开一个 Tape，窗口不跨 source；
- linked read 不触发 bootstrap、backfill、projection/FTS repair、Memory ingestion 或 event publish；已
  finalize 但被单独删除或 reset/rebuild 的 child 明确返回 unavailable，直到新 incarnation 被重新
  link；
- model surface 仍只有 `tape_search` 与 `tape_context`，没有第三个 tool，也不会把 linked child 自动注入
  provider context。

## 7. ViewManifest 与 trace

ViewManifest 记录 context 的构成、policy/version、source entry references、summary/reconstruction 等可审计
信息。它不能包含无需持久化的 secret。

provider request/response 的 raw body、headers 或敏感诊断继续进入 trace storage。现有 replay 使用
message id/request sequence 查找 trace，并与 ViewManifest/Tape 联结；Tape 不新增 trace id、request hash
或 raw request 副本。这样 replay 能解释因果，但不会把 Tape 变成 request dump。

## 8. Mutable projection

streaming 期间 assistant blocks 可以在 message projection 中节流更新。它们不是每次 mutation 都写
Tape：

```text
raw provider event -> in-memory accumulator -> throttled renderer/message projection
                                      └------> final semantic Tape fact
```

retry、replacement、retraction、rollback 继续通过现有事实/anchor/lineage contract 表达。不能用 SQL
update 伪造已经发生的历史，也不能因为 Tape append-only 就禁止现有 session delete。

## 9. Replay 范围

支持的是 audit/replay slice：给定 session/message/request，联结 input view、effective assistant/tool facts
与当前 terminal message projection；interaction/runtime event history 不持久化。明确不支持：

- 自动重放 provider 网络请求；
- 重做 tool side effect；
- 从逐 token log 恢复 UI 动画；
- 在缺少旧 trace retention 时凭空还原 raw request。

### ASLR-080 causal observation read model

- request 是 `manifest_bound`、`manifest_missing`、`manifest_malformed` 或 `request_unavailable`；
- explicit `requestSeq` 优先，否则取 raw ViewManifest `source_seq` 与 positive trace `request_seq` 的最大值，
  忽略 interleaved-reasoning 的 `request_seq=0` sentinel；
- `manifest_bound` 复用现有 replay slice；missing/malformed 只返回同 sequence 的 metadata-only trace，
  不伪造 manifest，hash integrity invalid 仍保留 readable invalid record；
- assistant message/tool facts 没有 request sequence，output 固定声明 `message_only` correlation；terminal
  assistant projection 只暴露 status/order/timestamps 和 content/metadata hashes；
- 默认不暴露 Tape payload/meta、trace headers/body 或 message content/metadata/blocks/errors；显式 opt-in
  只复用现有 `includeTapePayloads` / `includeTracePayload`；
- old sessions、pending messages 与未 hydrate runtime 分别返回 unavailable/partial、无 terminal message、
  current runtime unavailable，且读取不触发 bootstrap/backfill/projection/Memory/event side effect。

### ASLR-081 non-interference proof

- repeated default、explicit/latest request、trace-only 与 payload opt-in reads 前后，Tape rows/max/order、
  ViewManifest rows、message/trace rows、effective view、existing replay slice/hash 完全相同；
- fixture 同时包含 replacement、retraction、pending assistant 与 final tool-call/result facts；observation
  output 仍为 `message_only`，不会改变 effective fold；
- Memory ingestion projection meta/range 与 session cursor 不变，现有 projection/cursor write seams 为零调用；
  TapeService 不拥有也不暴露 runtime cooldown，不能在本任务伪造 snapshot；cooldown 的公共合同与迁移属于
  `ASLR-059`；
- default serialization 不暴露 Tape payload/meta、trace headers/body 或 terminal message raw fields；opt-in
  只增加现有 replay flags 允许的 Tape/trace payload 以及由此派生的 replay slice hash；
- old sessions 不 bootstrap/backfill/insert，architecture guard 禁止 observation reader 引入 write、SQL、
  event subscription/publication、projection mutation 或 Memory runtime value-import/call edge；
- native SQLite 可用时，同一套 proof 直接比较现有 Tape/message/trace/Memory projection/session tables 与
  `sqlite_master` 的完整 user schema（排除 SQLite internal objects）。本 test/proof slice 没有 production
  route/schema/raw-token log/durable event 改动。renderer event history 仍为 `not_persisted`。

## 10. Memory 与 Tape

- `memory/*`、`persona/*` anchors 继续是 non-reconstruction；
- prompt injection 即使 view anchor 写入失败，也按当前 fail-open 合同处理；
- extraction 必须读取本次确定的 effective Tape slice 和 exact lineage；
- cursor commit 只发生在 Memory job `ok: true` 后；
- retry/rollback/edit/delete/clear/destroy 继续推进 rewind/epoch，拒绝 stale ingestion。

详见 [Memory integration](./memory-integration.md)。

## 11. 迁移步骤

1. 冻结现有 entry sequence、ViewManifest、trace/replay golden fixtures。
2. 用 `TapeRecorder` 包住现有 service，不改变 schema。
3. 按 user -> view -> assistant/tool 的顺序迁移 runtime call sites；terminal 继续使用现有 projection。
4. 迁移现有 compaction/handoff anchors，不新增 interaction audit entry。
5. 最后迁移 Memory anchors/extraction references。
6. 删除 LoopEngine 对 concrete Tape store 的直接 import。
7. 若发现现有 entry 无法满足新的审计需求，记录单独 SDD，不在本目标增加 entry type。

## 12. 验证

- normal/tool/pause/retry/rollback/compaction/handoff/Memory 的 ordered entry golden tests；
- ViewManifest source references 与真实 provider context 一致；
- ViewManifest write failure 继续发送 provider request且不异步补写；
- raw secrets/request body 不因迁移进入 Tape；
- crash/abort at projection-before-Tape 与 Tape-before-projection recovery；
- duplicate/late terminal projection callback 幂等且无新 Tape entry；
- replay slice 在迁移前后等价；
- clear/delete/destroy 完成 Tape/trace/message/Memory 当前清理合同；
- large stream 不产生 per-token Tape growth。

## 13. 明确不做

- 不创建第二个 Tape 或通用 event-sourcing framework；
- 不把 message store 整体替换为 Tape projection；
- 不逐 token 持久化；
- 不扩张 trace retention 或隐私范围；
- 不承诺可重放外部 side effect。
