# LoopEngine 与可等待生命周期

> 状态：目标设计，不是 current API reference。此 loop 只属于 `kind=deepchat` session，其中 provider
> 仍可按兼容合同选择 ACP。下文 stage/type 伪代码表达生命周期合同；当前 concrete API 以实施进度和
> `src/main/agent/deepchat/loop/` 为准。

> Current ownership: `TurnCoordinator` owns initial/resume preparation,
> `DeepChatLoopRunner` owns provider-attempt execution and context-pressure recovery, and
> `DeepChatLoopEngine` remains the inner provider-round/tool-batch decision engine. The presenter is
> the composition root and compatibility façade; session/run state remains in
> `DeepChatAgentInstance`/`LoopRun`.
>
> Implementation progress: ASLR-050 introduced the per-turn `LoopRun` and narrow provider, tool,
> Tape, output, and context port contracts. That slice left the legacy `processStream` control flow
> unchanged while moving provider-round state, provider-attempt sequencing, and recovery flags into
> the same run object registered with the instance at the existing late
> active-generation boundary. ASLR-051 extracted the outer provider-round/tool-batch loop into
> `DeepChatLoopEngine`: it owns round and tool limits plus terminal/next-round decisions, while the
> compatibility `processStream` adapter still owns the existing accumulator, dispatch, interaction,
> and skill-refresh details in their original order. ASLR-052 added fixed `updateOutput`,
> `afterRoundPersisted`, and `settleTurn` callbacks. The engine now controls those commit points while
> the retained adapter continues to use the existing echo, message projection, stable per-fact
> `TapeRecorder`, and terminal writers. The engine invokes `settleTurn` exactly once. Within that adapter,
> a normal settlement write failure still enters the legacy error/abort fallback; a settlement
> failure while already handling a thrown round error is not replayed. ASLR-053 added separate
> `BasePromptAssembler` and `PostCompactionPromptAssembler` seams. The first is scoped to the
> captured DeepChat instance and remains before compaction intent preparation; the second fixes
> summary, reconstruction, and the awaited fail-open `MemoryPromptContributor` after normal compaction
> completion. ASLR-054 extracted typed input-preparation and context coordinators. Initial input now
> has a source-level history -> nullable intent -> compaction projection/user fact -> apply ->
> normal-return Memory-trigger order; resume passes the stale/abort checkpoint before refreshing
> history after its optional compaction seam and does not call that trigger; pressure recovery uses
> the extraction-enabled return/throw boundary. Manual
> compaction also remains outside compaction extraction. The context coordinator owns
> post-compaction view assembly and actual provider-attempt preflight, recovery, strict retry,
> request-sequence, ViewManifest, rate-gate and stream order. Presenter code supplies narrow retained
> algorithm/data adapters, while assistant placeholder creation and active-run registration remain
> at their existing late boundary. ASLR-055 connected the session-scoped `ToolCatalogPort`,
> `ToolExecutionPort`, and `ToolResultPort`: `processStream` and legacy dispatch now consume those
> capabilities instead of `IToolPresenter`, a normalization callback, or concrete `ToolOutputGuard`.
> ToolPresenter remains the sole merged/collision-resolved catalog and execution owner. ASLR-056
> made the retained dispatcher return a discriminated `ToolBatchOutcome`: only pre-check permission,
> question interception, post-call permission, and post-success skill-draft confirmation can pause a
> batch. The outcome carries ordered interactions plus the persisted call/invocation/result state;
> the instance owns that state until the final response creates one fresh resume run. ASLR-057
> replaced the mixed `ProcessHooks` callback bag with a typed notification observer, control
> collaborators, and an internal diagnostics seam. Notification delivery receives a detached
> snapshot and never awaits observer promises or thenables; synchronous throws and asynchronous
> rejection are logged without changing the loop outcome. `NewSessionHooksBridge` still delegates
> to the existing `HooksNotificationsService`, whose `queueMicrotask`, payload, command timeout and
> routing behavior remain unchanged. Interleaved-reasoning trace persistence remains an internal
> diagnostic and is not exposed as an external hook event.

## 1. 模块目的

`LoopEngine` 把一个 DeepChat turn 的 prepare、context、provider round、tool batch、permission、persist
和 settle 组成固定、typed、可观察的执行序列。它使用现有 Tape 记录语义事实，并在少数明确 seam
允许 `await` 或 persistent pause。

它不是开放式 workflow engine，也不是任意插件可以重排的 hook bus。

## 2. BEFORE

当前 lifecycle 被切在以下位置：

- `AgentRuntimePresenter.processMessage()`：generation/session/resource/Tape/Memory/compaction 起点；
- `runStreamForMessage()`：prompt/context/provider attempt/preflight/manifest；
- `processStream()`：stream accumulation、tool batch、next round；
- `dispatch.ts`：tool execution、permission、pause、normalization、persistence、renderer echo。

同一个 turn 的状态依靠参数、closure 和 session-keyed Map 传递。当前 external hooks 通过
`queueMicrotask` 触发，是 notification，不是 lifecycle gate。

## 3. 固定 stage

```text
prepareTurn
  -> prepareInput
  -> assembleRequest
  -> startProviderRun
  -> enterProviderRound
       -> beforeProviderRequest (1..n attempts within this outer round)
       -> consumeProviderRound
  -> executeToolBatch (0..n)
  -> afterRoundPersisted
  -> settleTurn
```

stage 名称是控制流骨架，内部 seam 才是模块参与点。执行顺序由代码声明，不提供 priority、dynamic
registration 或第三方 stage insertion。

## 4. Stage 合同

### `prepareTurn`

- claim input；
- set `status=generating` and register the pre-stream AbortController；
- resolve effective config、session resource references、final ToolPresenter tool set；
- assemble base/runtime/env/skill/tooling/permission prompt sections。

此时尚未注册 externally visible active generation。

### `prepareInput`

- ensure Tape and snapshot pre-turn history；
- prepare optional compaction intent using the already assembled base prompt；
- no intent: append user message fact；
- with intent: create compaction projection, append user fact, then await compaction apply；
- only after a normal initial compaction return, run the current compaction-to-Memory trigger；
- emit user refresh and fire `UserPromptSubmit` notification，绝不 await。

这个顺序是兼容合同：user fact 在 compaction apply 前，AbortError/throw 不触发 compaction Memory
extraction。

context-pressure recovery 同样是 extraction-enabled path；resume/manual compaction 不调用该 trigger，
resume terminal fallback 继续由 `MEM-13` 决定。

### `assembleRequest`

- append summary/reconstruction and awaited fail-open Memory contribution；
- assemble effective Tape view/context；
- fit budget without changing existing policy；
- produce immutable `PreparedProviderRequest` for this attempt。

### `startProviderRun`

- create mutable assistant placeholder；
- clear current plan state and re-check pre-stream abort；
- consume the claimed pending row and emit initial assistant refresh when current flags require；
- enter provider execution and register active generation/`LoopRun` at the current point。

### `enterProviderRound`

- increment `providerRoundCount` at each outer-round entry；
- enforce `maxProviderRounds` before creating/reading the next stream；
- a strict provider overflow retry stays inside this outer round and does not increment this counter again。

### `beforeProviderRequest`

- refresh prompt/final ToolPresenter tools for later rounds when current skill/resource rules require；
- context preflight / pressure recovery；
- increment `requestSeq` once per actual provider attempt, including strict overflow retry in the same outer
  round；
- synchronously attempt request `ViewManifest`；write failure logs and remains fail-open；
- pass rate-limit gate；
- obtain provider stream using `ProviderPort`。

manifest attempt 与 provider request 的相对顺序是审计合同，不能异步补写；成功 entry 不是每次 request
必然存在的前置条件。

### `consumeProviderRound`

- consume raw stream on hot path；
- update accumulator and throttled mutable output；
- normalize final assistant blocks/tool calls；
- never await generic observers per token/event；
- return terminal assistant response or `ToolBatch`。

### `executeToolBatch`

- normalize/validate calls；
- run current pre-check permission when applicable；
- intercept question interactions without calling the underlying tool；
- execute according to current concurrency policy；
- capture post-call `rawData.requiresPermission` and post-success skill-draft confirmation；
- normalize/fit outputs, persist tool facts and renderer projection；
- return `completed` or `paused` with all ordered interactions and the batch execution state；
- refresh activated skills/resources before next round when required。

### `afterRoundPersisted`

- ensure assistant/tool facts and projection required for this round are committed；
- emit round-complete internal callback；
- decide terminal versus next `assembleRequest`。

`providerRoundCount` 与 `requestSeq` 不是 commit counters：前者在 outer round 入口推进，后者在每个
provider attempt 的 manifest preparation 处推进。strict retry 可让一次 outer round 对应多个 request
sequence。

### `settleTurn`

- write current final assistant/message/status/event terminal projection；
- flush required output；
- on pause, persist ordered interactions and settle/clear the current run；
- otherwise clear run only after required commit；
- drain pending input under current rule；
- enqueue Memory ingestion under current eligibility；
- fire external notifications without blocking the loop。

## 5. Typed seam

```ts
interface BasePromptAssembler {
  assemble(input: BasePromptInput): Promise<BasePrompt>
}

interface InputPreparationCoordinator {
  prepare(input: PreparedTurnInput): Promise<PreparedInputAndSummary>
}

type ToolBatchOutcome =
  | { type: 'completed'; results: ToolExecutionResult[] }
  | {
      type: 'paused'
      interactions: PendingInteraction[]
      executionState: PersistedToolBatchState
    }

type PendingInteractionOrigin =
  | 'pre-check-permission'
  | 'question'
  | 'post-call-permission'
  | 'skill-draft-confirmation'
```

实际实现使用这些窄 ports，不创建一个包含所有 callback 的 `LoopLifecycle` mega-interface。base prompt、
input/compaction、post-compaction context、provider attempt、tool batch、round commit 和 turn settlement 的
顺序在 source-level composition 中固定。

## 6. Await 与 pause 语义

`await` 表示当前阶段必须等依赖完成或收到 abort；它不自动产生可持久恢复状态。persistent pause 只能
由上述四种合法 tool interaction origin 产生，不能由 generic observer 任意返回：

```text
awaited wait: same call stack/run, abortable, no resume token
persistent pause: ordered interactions + execution state committed, current run settles
response: process/persist first interaction; stay paused while more remain
resume: after the final interaction, rebuild context and create one fresh run
```

compaction、Memory query、rate gate、provider preflight 只是 awaited wait；失败按各自
fail-open/fail-closed policy 处理。pause 不保存 JavaScript call stack，也不假设旧 `runId` 可恢复。

## 7. 端口

LoopEngine 只依赖以下能力类型：

- `ProviderPort`：prepare/stream/cancel provider request；
- `ToolCatalogPort`：只从 ToolPresenter aggregate 获取最终 merged/collision-resolved definitions；
- `ToolExecutionPort`：optional pre-check + execute，传递 exact options/current `AbortSignal` 并返回 raw
  result；没有 owner 不支持的第二条 cancel channel；
- `ToolResultPort`：screenshot/result normalization、output preparation/offload 和 batch fitting；
- `BasePromptAssembler` 与 post-compaction context contributors：两个固定时点；
- `InputPreparationCoordinator` / `ContextCoordinator`：Tape view、budget、compaction；
- `TapeRecorder`：semantic fact/manifest/anchor；
- `MessageProjection` 与 `OutputSink`；
- typed tool interaction resolver；
- `MemoryPromptContributor` 与 `MemoryIngestionObserver`；
- clock/id/rate-limit 等窄 platform ports。

禁止 import Presenter root、Electron route/window、ACP-agent runtime 或 concrete database singleton。
generic ProviderPort 可以解析 `providerId=acp`，但 LoopEngine 不据此把 session 当成 ACP agent。

## 8. 错误、取消与 terminal outcome

```ts
type LoopTerminalOutcome =
  | { type: 'completed' }
  | { type: 'aborted'; reason: AbortReason }
  | { type: 'failed'; error: NormalizedLoopError }
  | { type: 'paused'; interactions: PendingInteraction[] }
```

- 所有 stage 在入口和长 await 后检查同一 `AbortSignal`；
- provider fallback/retry/overflow recovery 保持当前 attempt policy，不泛化成通用 retry middleware；
- stage 失败必须写与当前行为等价的 message/status/event terminal projection；
- tool 单项失败与 turn failure 的区分保持；
- terminal commit 幂等，late provider/tool callback 通过 run id/epoch 被拒绝；
- notification observer 错误只记录，不反向改变 terminal outcome。

## 9. Tape 与 replay

LoopEngine 控制“何时记录”，`TapeRecorder` 控制“怎样记录”。本目标只包装现有 user、effective view
manifest、assistant/tool facts 与 compaction/handoff/memory audit anchors。interaction/terminal 继续由当前
message/status/event projection 表达；不新增 Tape entry。raw token stream 不进入 Tape；mutable projection
不是永久事实。

replay 指审计时重建输入/输出因果 slice，不表示重新执行 provider 或 tool side effect。

## 10. 迁移步骤

1. 为当前完整 call order 增加 causal golden tests，不先抽象。
2. 区分 pre-stream operation 与 late active-generation registration，再把 provider/tool turn-local state
   移入 `LoopRun`。
3. 包装现有 provider、tool、Tape、output 为 ports，逻辑仍调用旧函数。
4. 先收拢 `consumeProviderRound` hot path，再收拢 tool batch；保持输出节流。
5. 按现有顺序建立固定 stages，逐个替换旧 orchestration。
6. 把 pre-check/question/post-call permission/skill-draft 映射成 ordered `ToolBatchOutcome`。
7. 分别接入 compaction 前的 base prompt 与 compaction 后的 summary/reconstruction/Memory context。
8. 最后接入 Memory 两个 adapter，并跑专门 parity suite。
9. 删除旧 `processMessage`/`processStream`/`dispatch` 中已无调用的 orchestration。

## 11. 验证

- 记录 stage + fact + renderer event 序列，迁移前后 golden diff 为零；
- provider 0/1/N tool rounds、parallel/sequential tools、tool error/oversized output；
- provider fallback、rate wait、overflow recovery、preflight failure；
- providerRoundCount outer-entry/max check 与 requestSeq per-attempt/strict-retry advancement；
- compaction intent/no-intent、user-before-apply、apply return false、apply throw/abort；
- ViewManifest success/fail-open；
- cancel/pause at every awaited seam；
- multiple ordered interactions、pre/post permission、question、skill draft、中间项保持 paused、最后一项后
  fresh-run resume；
- prompt/tool refresh after skill activation；
- external hooks 慢、失败或悬挂时不阻塞 turn；
- LoopEngine instance 无跨 session mutable map；
- import graph test 阻止 ACP、Electron 和 Presenter root 依赖。

## 12. 明确不做

- 不支持用户任意注册/reorder lifecycle stage；
- 不引入 generic event bus、middleware stack 或 workflow DSL；
- 不逐 token 写 Tape；
- 不把 `kind=acp` protocol loop 纳入此 engine；DeepChat + ACP-provider compatibility 仍通过 generic
  ProviderPort；
- 不在重构中改变 tool 并发、provider fallback 或 compaction 策略。
