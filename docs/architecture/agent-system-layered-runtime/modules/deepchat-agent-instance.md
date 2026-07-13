# DeepChatAgentInstance

> 状态：目标设计，不是 current API reference。一个 active/hydrated DeepChat app session 对应一个实例；
> 下文 class/interface 与流程伪代码描述目标边界，当前事实只以“实施进度”和 current architecture docs
> 明确列出的 slice 为准。

> 实施进度：ASLR-040..046 已接入 lazy runtime/instance shell，并迁入 identity、project、effective
> generation settings、status、first-turn readiness、pre-stream abort controller、active generation 与
> stale-run guard、pending drain/steer merge state，以及 ordered interaction projection、response/resume
> guards、deferred-tool cancellation、live provider-permission continuation、message-scoped runtime skill
> selection、prompt/tool snapshot caches 和 compaction in-flight projection。持久 pending rows 已归入
> `agent/deepchat/pending`，持久 interaction blocks、Skill/Tool/MCP owners、configured selections 和
> persisted summary 仍是事实源。ASLR-090 让 typed DeepChat backend 直接组合 runtime/instance 与 required
> presenter port，并删除 reflection-based legacy backend；instance 只持有 stable Memory session handle。
> Memory kernel/schema 保持在 `MemoryPresenter`，cursor/queue/epoch orchestration 已迁到
> `MemoryRuntimeCoordinator`，既有 trigger policy 保持不变。

## 1. 模块目的

`DeepChatAgentInstance` 把当前 singleton 中按 `sessionId` 分散保存的状态收回到真实实例。它管理
session 的长期运行态和 turn 排队，但不实现 provider/tool loop；每次 turn 的短期状态交给
`LoopRun`。

## 2. BEFORE

`AgentRuntimePresenter` 通过几十个 `Map<sessionId, ...>` 保存 generation、abort、pending、permission、
skill、Memory 和 provider recovery 等状态。方法接收 `sessionId` 后自行查多个 Map，状态创建与清理
分散在 `processMessage`、`processStream`、`dispatch` 和 session routes 中。

这会产生四类负担：

- 无法从对象边界判断一个 session 当前拥有什么；
- close/delete/clear 需要记住清理所有 Map；
- turn-local 状态容易泄漏成 session-global；
- unit test 必须构造整个 singleton 和大量 Presenter。

## 3. 实例边界

```ts
class DeepChatAgentInstance implements AgentSessionHandle {
  readonly kind = 'deepchat'
  readonly sessionId: AppSessionId

  private effectiveConfig: EffectiveDeepChatConfig
  private status: DeepChatSessionStatus
  private preStreamAbortController?: AbortController
  private activeRun?: LoopRun
  private pendingInputs: PendingInputQueue
  private pendingInteractions: PendingInteraction[]
  private sessionResources: SessionResourceSelection

  send(input: AgentInput): Promise<MessageStartResult>
  steer(input: AgentInput): Promise<void>
  retry(input: RetryInput): Promise<void>
  cancel(reason?: string): Promise<void>
  snapshot(): Promise<DeepChatSessionSnapshot>
  close(): Promise<void>
}
```

构造函数只接收 session-scoped identity/config 和窄 ports。不得接收整个 Presenter registry 或 Electron
window。

## 4. 状态所有权

| 状态 | Owner | 说明 |
| --- | --- | --- |
| effective agent/session config | instance | config revision 变化时明确 refresh |
| session status | instance | idle/generating/waiting/error 等兼容状态 |
| pending/steer input queue | instance | 跨当前 turn 等待下一执行点 |
| ordered pending interactions | instance | 同一 tool batch 可有多个；响应首项后其余继续 pending |
| selected skills/MCP/extensions references | instance | 保存选择引用，不拥有资源内容 |
| pre-stream abort/status | instance | 在 tools/prompt/compaction/context 的长 await 前注册，但不冒充 active generation |
| active generation | instance -> `LoopRun` | assistant placeholder/context 之后才按当前时点注册 |
| abort signal、per-attempt requestSeq、outer providerRoundCount、round messages | `LoopRun` | turn 完成必须释放 |
| provider recovery/overflow flags | `LoopRun` | 不跨 turn 泄漏 |
| Tape/message/trace data | stores through ports | 不复制到实例作为事实源 |
| Memory rows/vector/maintenance | `MemoryPresenter` | instance 不拥有 |
| Memory chains/epochs/cooldown/access dedupe/cursor orchestration | runtime-scoped `MemoryRuntimeCoordinator` | instance 只保留 session handle |

pending input 的事实源仍是现有 SQLite rows。`agent/deepchat/pending` 中的 store/coordinator 负责持久化、
claim/order/recovery 与通知；instance 只持有 drain single-flight 和 rapid-steer merge id，避免把 rows
复制成第二份内存状态。

## 5. Hydration 与缓存

实例采用 lazy hydration：只有被 open/send/snapshot 的 session 才创建。hydration 顺序固定：

```text
load app session metadata
  -> verify kind=deepchat and agent descriptor
  -> load effective config/resource selections
  -> inspect persisted generation/interaction recovery state
  -> ensure Tape bootstrap when operation requires it
  -> publish ready snapshot
```

runtime 可以缓存 active instances，但 cache 不是事实源：

- cache key 是 `AppSessionId`；
- concurrent `open()` 对同一 id 必须 coalesce；
- open/send/snapshot 等入口使用 `getOrHydrate()`；stale completion、cleanup 与只读 status guard 使用
  `getHydrated()`，不得在 close/delete 后重新创建空实例；
- idle eviction 只能发生在无 pre-stream work、active run、pending input、pending interactions 和
  background close fence 时；
- eviction 不删除持久化数据；
- delete/clear 显式进入 closing fence，阻止随后 lazy recreate 使用旧 epoch。

## 6. 输入与并发

`send()` 不直接展开 loop 细节：

```text
validate instance state
  -> apply current pending/steer policy
  -> claim one input
  -> register status + pre-stream AbortController
  -> prepare resources/Tape/compaction/user/context and assistant placeholder
  -> create/register LoopRun at the current active-generation point
  -> await LoopEngine provider/tool rounds
  -> commit instance-visible terminal status
  -> drain next pending input when current rules allow
```

公开 `send()` 保留现有 `MessageStartResult`，包括 queued path 允许 `requestId/messageId=null` 的语义。
普通 send 与 create-session initial send 当前等待/非阻塞差异也由 route fixtures 锁定，不能被一个新
handle 偷偷统一。

必须保持当前规则：输入何时作为 pending、steer 如何影响 active generation、retry/rollback 从哪个
projection/Tape point 开始、draft session 何时转成正式 session。重构不把它们统一成新的 queue 语义。

## 7. `LoopRun` 分界

```ts
interface LoopRun {
  readonly runId: GenerationId
  readonly sessionId: AppSessionId
  readonly input: ClaimedAgentInput
  readonly abortController: AbortController
  readonly startedAt: number

  phase: LoopPhase
  requestSeq: number
  providerRoundCount: number
  roundMessages: ProviderMessage[]
  mutableAssistant?: MutableAssistantProjection
  pendingToolBatch?: ToolBatch
  pendingInteractions: PendingInteraction[]
  terminal?: LoopTerminalOutcome
}
```

`LoopEngine` 可以修改 `LoopRun`，但不能持有跨 session Map。instance 只保留 active run reference；run
terminal 后先完成所需 commit，再清除 reference。

interaction pause 会 settle/clear 当前 run。用户响应时先按 origin 处理/持久化第一项；仍有 interaction
就保持 paused，不创建 run。只有最后一项解决后，instance 才从持久 message/Tape context 重建输入并
注册一个新的 resume `LoopRun`；`originRunId` 只用于审计/stale guard，不是恢复旧 call stack 的 token。

## 8. 资源刷新

instance 保存 selection/revision，不缓存资源 owner 的可变内部对象：

- skill catalog/content 由 `SkillPresenter` adapter 按 revision 读取；
- MCP/tools 由 `ToolPresenter`/MCP adapter 解析；
- provider config 由 provider port 解析；
- Memory 由 Memory adapter 按 session/persona/query 调用。

refresh 触发点必须与当前 turn/round 顺序一致。工具执行激活 skill 后，需要在下一 provider round 前刷新
prompt/tools，不能延迟到下一 turn，也不能每个 token 重查。

## 9. 关闭与 epoch fence

`close()` 与 data delete 不等价：

1. 标记 closing，拒绝新输入；
2. cancel pre-stream work/active run，并处理全部 ordered pending interactions；
3. 按当前策略 settle/drain 或丢弃 pending inputs；
4. 等待 required Tape/output commits；
5. 与 Memory background queue 建立 drain/fence；
6. 释放 instance state。

clear/delete/rollback/retry 会改变 session lineage 时，必须推进现有 epoch/rewind 语义，防止旧 Memory
job 或旧 async callback 回写新 lineage。

## 10. 迁移步骤

1. 列出并测试 singleton 中全部 session-keyed maps 的创建/读取/清理点。
2. 引入 instance shell，但最初委托旧 runtime 方法。（ASLR-040 已完成）
3. 先迁移 identity/config/status 等纯 session state。（ASLR-041 已完成）
4. 保留 pre-stream abort 与 active-generation 的当前注册边界，将两者迁入 instance。（ASLR-042
   已完成；全局 run-id sequence 暂留 compatibility runtime，`LoopRun` 与 request/round/overflow state
   属于 ASLR-050）
5. 迁移 pending drain/steer merge state，并将持久 queue store/coordinator 归入 DeepChat pending
   模块。（ASLR-043 已完成）
6. 把 permission/question/post-call/skill-draft continuation 收敛为 instance ordered interaction state，
   保留 fresh-run resume。（ASLR-044 已完成基础 state ownership；ASLR-056 已完成 typed batch outcome、
   origin/order 与 persisted execution-state ownership）
7. 迁移 message-scoped runtime skill selection 与 prompt/tool snapshot caches；resource owner revision
   只使对应 snapshot 失效，不复制 Skill/Tool/MCP owner 内部状态。（ASLR-045 已完成）
8. 迁移 compaction in-flight projection；persisted summary 继续作为事实源。ASLR-046 当时只给 instance
   stable Memory session handle；ASLR-059 后续把四组 orchestration state 迁到唯一 coordinator。
9. 让 route/runtime cache 只通过 instance 操作 session。（`ASLR-090` 已完成 typed backend 接线）
10. 对每个旧 Map 做“无读写引用”检查后逐个删除。
11. 最后把 loop orchestration 迁入 `LoopEngine`；Memory 接线在其他状态稳定后迁移。

## 11. 验证

- 同一 session concurrent open 只生成一个实例；
- 不同 session 的 pending、permission、abort、tool、provider recovery 状态隔离；
- normal、retry、regenerate、steer、pending drain、draft promotion 的序列 parity；
- multiple interactions 同批排序、逐项响应、中间项保持 paused、最后一项后的 fresh resume run parity；
- cancel at prepare/provider/tool/permission/finalize 各阶段均可终止且无悬挂状态；
- close/clear/delete 后不存在 active timers、continuations 或 background writes；
- idle eviction 后 rehydrate 的 snapshot 与未 eviction 一致；
- singleton map leak regression test：大量 open/close 后 instance/runtime state 回到基线。

## 12. 明确不做

- 不让 instance 变成包含所有 Presenter 的 service locator；
- 不在实例内复制 Tape、message 或 Memory 数据库；
- 不把 ACP 做成 `DeepChatAgentInstance` subtype；
- 不新增 actor framework、DI container 或通用 state machine library；
- 不在状态迁移时修改现有 pending/steer/retry 行为。
