# Memory 集成与不可回归合同

> 状态：目标合同，不是 current API reference。ASLR-059..062 已接入 coordinator、prompt contributor、
> ingestion observer 并完成 Memory 专项门禁；下文类型和流程仍是不可回归合同，不是 concrete API 清单。
> 本模块只改变接线位置，不改变 `MemoryPresenter`、schema、retrieval、projection 或 maintenance。

> 实施进度：ASLR-046 在 instance 上建立 identity-only、per-instance stable Memory session handle；
> ASLR-054 固定 `MEM-14` 的 existing entry-point asymmetry。ASLR-059 已将 prompt/accounting、
> extraction queue/chains/counter、epoch/cursor、projection fallback/cooldown 与 injection-access dedupe
> 机械提取到唯一 runtime-scoped `MemoryRuntimeCoordinator`。retained Presenter 只保留构造接线和调用委托，
> `MemoryPresenter` data orchestration 未迁移。AST architecture guard 以 class/property structure 固定唯一
> owner，并拒绝 Presenter owner 回流；public seam tests 覆盖 128-turn access cap 与 256-session cooldown
> cap。ASLR-060 已让 coordinator 直接实现最小 `MemoryPromptContributor`，PostCompaction 固定 slot 传入
> captured stable handle；Presenter 不再拥有私有 Memory injection callback。ASLR-061 已让同一 coordinator
> 直接实现 discriminated `MemoryIngestionObserver`，按 `MEM-13/14` 接入 terminal/compaction，并在 composition
> shutdown 先同步关闭 ingestion admission、fence epoch，再由 `MemoryPresenter.dispose()` abort provider-bound
> work，再 bounded-await existing chains 后关闭 SQLite；timeout 返回 typed pending diagnostics，不冒充
> settled。coordinator epoch 与 disposed Memory operation fence 共同禁止 late commit。
> ASLR-062 已完成 correctness/privacy/performance/native 收口，并证明 Phase 9 未改变 Memory schema、config、
> route/event DTO、DuckDB sidecar 或 ingestion projection version。

## 1. 模块目的

Memory 对 DeepChat loop 有两个方向完全不同的参与点：

```text
read path:  awaited, fail-open prompt contribution before provider request
write path: background, serialized ingestion after the currently eligible returned turn/compaction outcomes
```

把两者放进一个万能 `MemoryHook` 会再次混合生命周期。目标由一个有状态 coordinator 暴露两个窄
ports，并冻结当前所有语义。

## 2. BEFORE

Memory 是近期进入 `AgentRuntimePresenter` 的复杂模块。runtime 负责 query/injection、view anchor、turn
selection/dedupe、effective Tape extraction、cursor、fallback、cooldown、epoch/rewind、delete cleanup、
background queue 和 shutdown fencing。

这些调用虽集中在大 Presenter 中，但已经有严格的安全和 lineage 规则。本次不能把“代码移动成功”
误当成“行为等价”。Memory 必须用独立 causal fixtures 验证，并最后接线。

## 3. AFTER 的唯一 orchestration owner 与两个端口

一个 runtime-scoped `MemoryRuntimeCoordinator` 已接收现有 runtime 中的 mutable orchestration state，
成为唯一 owner：

- `memoryExtractionChains`；
- extraction queue 与 monotonic queue counter；
- `memoryExtractionEpochs`；
- `memoryIngestionProjectionRetryAfter`；
- `memoryInjectionAccessByTurn`。

它还通过现有 DeepChat session state port 读写 cursor。`MemoryPresenter` 继续拥有 memory rows、
persona/working-memory、retrieval/write、vector 与 maintenance；instance 只持 coordinator 的 session
handle，不复制上述 maps。

```ts
interface MemorySessionHandle {
  readonly sessionId: AppSessionId
}

interface MemoryPromptContributor {
  contribute(input: {
    session: MemorySessionHandle
    basePrompt: string
    query: string
    messageId?: string | null
  }): Promise<string>
}

interface MemoryIngestionDrainOutcome {
  timedOut: boolean
  pendingSessions: readonly string[]
}

interface MemoryIngestionObserver {
  afterTurnSettled(input: {
    session: MemorySessionHandle
    origin: 'initial' | 'resume'
    outcome:
      | { kind: 'returned'; status: 'completed' | 'paused' | 'aborted' | 'error' }
      | { kind: 'thrown'; error: unknown }
  }): void
  afterCompactionApplyReturned(input: {
    session: MemorySessionHandle
    origin: 'initial' | 'context-pressure'
    targetCursorOrderSeq: number
  }): void
  drainAndFence(): Promise<MemoryIngestionDrainOutcome>
}
```

prompt contributor 属于 fixed ordered prompt composition；ingestion observer 接收 committed snapshot 后
排入 coordinator 的 per-session background serialization。observer 的 enqueue 可以同步确认，实际提取
不阻塞 turn terminal path。方法名使用 `ApplyReturned`，因为当前 `succeeded=false` 也触发，而 throw 不
触发。

## 4. Read path 合同

```text
assemble request
  -> build sanitized Memory query input
  -> select active persona only + eligible working memory
  -> MemoryPresenter retrieval
  -> sanitize again at boundary
  -> apply hard token/character budget
  -> produce read-only PromptSection with provenance
  -> best-effort audit/view anchor under current rule
```

必须同时满足：

1. retrieval/injection fail-open；Memory 失败不能阻塞 provider request；
2. 注入文本经过现有 sanitization；
3. 有独立 hard budget，不能挤掉不可缺失的 system/tool context；
4. 只注入 active persona；working memory 独立处理；
5. draft session 不参与当前不允许的 Memory path；
6. prompt contribution 是 read-only，不在 query 时写 persona/working memory；
7. view/audit anchor 写失败不能反向移除已允许的 prompt contribution；
8. provenance 不泄露不应进入 provider/Tape 的内部字段。

## 5. Write path 合同

一次 ingestion job 分两段冻结，不能在 enqueue 时提前读取 cursor/tail：

```text
settled turn or eligible settled compaction attempt (initial/context-pressure only)
  -> evaluate current eligibility
  -> enqueue the trigger path without capturing an epoch
       compaction path additionally captures the existing targetCursorOrderSeq upper bound
  -> when this task reaches the head of the per-session serial queue:
       ensure/read the current epoch
       read latest committed cursor
       read latest fallback tail, or use captured compaction upper bound
       build effective Tape projection/window + exact sourceEntryIds
       freeze that built window for this task
  -> MemoryPresenter extraction/upsert/audit/vector work
  -> commit cursor only when result.ok === true and epoch/lineage still valid
```

禁止从 mutable assistant blocks 或 renderer event 构建窗口。读取“task 开始时的最新 committed
cursor/tail”是当前防重复语义，不能改成 enqueue-time snapshot；window 建成后才是 immutable。

## 6. 冻结不变量

权威合同是 [migration-and-validation.md 的 `MEM-01..14`](../migration-and-validation.md#4-memory-no-regression-contract)。
特别注意两个容易混淆的事实：

- `MEM-04` 是 prompt injection access accounting，不是 extraction dedupe：有 messageId 时执行当前
  session/message TTL/cap dedupe；pressure recovery 的 null messageId 调用保持每次记录；
- `MEM-07` 要求 queued task 开始时读取最新 cursor/tail，`MEM-06` 的 exact lineage 指随后构建并冻结
  的 effective Tape window。

若产品希望修正 `MEM-13` 或 `MEM-14`，必须另写行为变更 spec。

## 7. Trigger mapping

明确用现有调用点建立迁移表，而不是只按新 stage 名猜测：

| 当前语义 | 新 seam | 执行方式 |
| --- | --- | --- |
| compaction 后、request 前 Memory query/injection | `MemoryPromptContributor` | awaited + fail-open |
| initial returns completed | `afterTurnSettled(origin=initial, outcome=completed)` | enqueue |
| initial returns aborted/paused/error or any throw | explicit outcome/error path | no enqueue |
| resume returns completed or aborted | `afterTurnSettled(origin=resume, returnedOutcome=...)` | enqueue |
| resume returns paused/error or throws | explicit outcome/error path | no enqueue |
| initial/context-pressure non-null compaction apply normally returns (`succeeded=true|false`) | `afterCompactionApplyReturned` | enqueue with intent target upper bound |
| initial/context-pressure has no intent or compaction apply throws | explicit no-op/error path | no enqueue |
| resume/manual compaction with any outcome | no compaction observer | no enqueue; resume terminal fallback remains under `MEM-13` |
| edit/delete/retry/rollback | instance/data operation | rewind + epoch fence |
| clear/destroy/shutdown | instance/runtime close | drain/fence before data close |

`SettledTurnMemoryInput` 必须带 origin 和“returned outcome vs thrown error”；compaction callback 只在
normal return 后调用。完整 outcome matrix 以 `MEM-13/14` 为准。

## 8. Queue、cursor 与 epoch

- queue key 使用 app session id；同 session 严格串行，不同 session 可按当前限制并发；
- enqueue 时只保留 trigger path；compaction 额外捕获 current intent upper bound；
- task 到达 per-session queue 头部时才 ensure 当前 epoch；同一 job 的 chunk continuation 显式传递
  `expectedEpoch`，epoch 不在普通 enqueue 时冻结；
- task 真正开始时读取最新 cursor；fallback 同时读取最新 tail，compaction 使用已捕获 upper bound；
- task 在此时构建并冻结 effective Tape chunks/sourceEntryIds；后续 queued task 因最新 cursor 不会重复；
- 开始执行和提交前都重新验证 fence；
- `ok: false`、throw、abort、fallback projection 或 stale epoch 都不得前移 cursor；
- cooldown/queue/epoch/access-dedupe 由 `MemoryRuntimeCoordinator` 管理，LoopEngine/instance 不复制 maps；
- clear/delete/destroy 先建立 fence，之后的 late job 不能回写已重建的同 id session；
- shutdown 必须先永久关闭 coordinator admission、fence active epochs，再 dispose Memory 以 abort provider
  work 并关闭 Memory operation fence，最后 bounded-await captured chains。timeout outcome 必须显式携带
  pending session diagnostics；composition root 记录 warning 后才可继续关闭 SQLite，不能把 timeout 表述为
  settled；late resolve/reject 仍不得写 row/audit/vector、触发 embedding/event 或前移 cursor/anchor。

当前 start-time epoch 语义存在一个已知边界：旧 session 的普通 queued task 若在 destroy 后才首次开始，
可能读取到复用后的同 session id epoch。ASLR-059 为保持 baseline 不改变该行为；session-id reuse 的产品
语义与修复必须另写 behavior spec，不能隐含塞入 ownership refactor。

## 9. 删除与 lineage 变化

edit/delete/retry/rollback 会改变有效历史。新 instance/data operation 只调用 Memory adapter 的现有
rewind/invalidation API，不自行计算 cursor。删除相关 rows/audit 与 vector cleanup 的事务/补偿语义保持；
部分失败必须能被现有 maintenance/retry 识别。

session clear/destroy 的 Tape、message、Memory 顺序以当前 tests 为准。不能因为新 owner 边界把它们
改成无序 `Promise.all`。

## 10. 失败策略

| 失败点 | Foreground turn | Cursor | Audit/telemetry |
| --- | --- | --- | --- |
| query/retrieval | 继续，无 Memory section | 不相关 | 记录安全错误 |
| sanitization/budget | 丢弃或裁剪当前 section | 不相关 | 保持当前统计 |
| view anchor | 继续已构建 request | 不相关 | best-effort failure |
| projection fallback | turn 已完成，不回滚 | 不提交 | cooldown/current fallback audit |
| extraction/upsert | turn 已完成，不回滚 | 不提交 | retry/maintenance 可见 |
| vector cleanup | 不影响已完成 turn | 按当前 delete contract | compensation/maintenance 可见 |
| shutdown timeout | 阻止 unsafe DB close or fence per current policy | 不错误提交 | 明确 shutdown reason |

composition root 在调用 `drainAndFence()` 后立即持有其 rejection handler，避免 Memory dispose 期间出现
unhandled rejection；随后独立记录 dispose failure、drain failure 或 typed timeout，并继续尝试 SQLite
close。该 continue policy 的安全前提由生产实现固定：coordinator 在第一个 await 前永久关闭 admission 并
fence epoch，`MemoryPresenter.dispose()` 也在第一个 await 前标记 disposed 与 abort provider。任一后续
reject/timeout 都不能重新开放写入。

## 11. 迁移步骤

1. 在任何代码移动前冻结 `MEM-01..14` 和两个 outcome matrix 的 fixture/test。
2. [ASLR-059 已完成] 从 runtime 机械提取唯一 `MemoryRuntimeCoordinator` owner，queue/counter、四组
   maps/cursor call sites 原样移动；instance 只取得 session handle。
3. [ASLR-060 已完成] coordinator 直接实现 `MemoryPromptContributor`，以 stable session handle 接入现有
   PostCompaction slot，并对比 exact prompt/budget/sanitization/selection/accounting/anchor。
4. [ASLR-061 已完成] 为 terminal/compaction 建只携带 trigger/origin/upper-bound 的 DTO；普通 task 在开始时 ensure epoch，
   只有同一 job continuation 携带 `expectedEpoch`；不要提前抓 cursor/tail/window。
5. [ASLR-061 已完成] 接入 `afterTurnSettled`，分别验证 initial returned、resume returned 和 thrown paths。
6. [ASLR-061 已完成] 只在 initial/context-pressure 接入 `afterCompactionApplyReturned`，覆盖 normal
   `succeeded=true|false` return；throw/no-intent 不调用，resume/manual 不接入该 observer。
7. [ASLR-061 已完成] 保留 edit/delete/retry/rollback/clear/destroy fence，并将 shutdown 接到两阶段
   fence/dispose/bounded-drain-outcome/SQLite close 顺序；timeout 记录 pending diagnostics，late work 由两层
   operation fence 拒绝。
8. [ASLR-062 已完成] 删除 legacy runtime ingestion trigger 接线后统一运行 Memory correctness/privacy/
   performance/native gates，并对比 Phase 9 前后的 schema/config/wire/projection contracts。

## 12. 验证矩阵

- Memory disabled/enabled、无 persona、一个/多个 persona、active 切换；
- working memory empty/present/oversized/malicious content；
- retrieval success/throw/timeout、anchor write failure；
- repeated null-messageId pressure recovery access accounting，以及 130 个 non-null turns 对 128 cap 的
  dedupe/eviction/TTL parity；
- initial/resume returned completed、returned aborted、thrown AbortError、thrown non-abort error；
- initial/resume returned paused、returned error；
- turn with 0/1/N tools、duplicate renderer/message callbacks；
- initial/context-pressure compaction no intent、normal return succeeded=true、normal return
  succeeded=false、thrown AbortError、thrown non-abort error；resume/manual 各 outcome 均无 compaction
  extraction；
- projection primary/fallback/cooldown，以及 257 个 failed sessions 对 256 cap 的 oldest eviction；
- cursor success/failure/stale epoch；
- concurrent sessions 与 same-session serialized jobs；
- first job 尚未完成时连续触发第二 job并落入新 turn；验证第二 job 在执行时看见第一 job 推进后的
  cursor，且不重复 sourceEntryIds；
- edit/delete/retry/rollback/clear/destroy during queued/running job；
- shutdown with empty/queued/running/failed jobs；
- rows/audit/vector cleanup fault injection；
- exact effective Tape sourceEntryIds，以及 injection-access selected manifest ID accounting（non-null
  message dedupe / null-message recovery non-dedupe）。

## 13. 明确不做

- 不改 Memory schema、embedding/vector provider、retrieval ranking 或 prompt 文案；
- 不把 ACP 接入 DeepChat Memory；
- 不将 ingestion 改成阻塞 turn；
- 不统一现存 initial/resume 或 compaction trigger 不对称；
- 不把 Memory data owner 搬进 `DeepChatAgentInstance` 或 `LoopEngine`。
