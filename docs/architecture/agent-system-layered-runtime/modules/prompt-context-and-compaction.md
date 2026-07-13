# Prompt、Context 与 Compaction

> 状态：目标设计，不是 current API reference。顺序与 budget policy 是兼容合同，不在重构中优化；
> 下文 contributor/type 伪代码表达边界，current concrete API 以实施进度和 loop source 为准。

> 实施进度：ASLR-046 已把 session-scoped compaction in-flight projection 迁入
> `DeepChatAgentInstance`，persisted summary 仍是事实源，`compacting` projection 仍优先。ASLR-053
> 增加了 scoped `BasePromptAssembler` 与固定 `PostCompactionPromptAssembler`：initial、resume 和
> manual compaction 都在 intent preparation 前完成原有 base/runtime/env/skills/tooling/permission/
> verification 组合；normal initial/resume/pressure paths 在 compaction 后固定按
> summary -> reconstruction -> awaited fail-open Memory 顺序组合。initial tool-skill refresh
> 重用两个 phase；resume later-round refresh 继续保留原有 base-only 差异。manual compaction 仍只消费
> base prompt，不新增 post-compaction request assembly。ASLR-054 introduced typed
> `InputPreparationCoordinator` and `DeepChatContextCoordinator` seams. They now own the existing
> initial/resume/pressure compaction order, post-compaction Tape view assembly, provider preflight,
> pressure recovery, strict retry, request sequence and synchronous fail-open ViewManifest attempt.
> Existing `CompactionService`, `buildTape*View`, context-budget and message/Tape adapters remain the
> algorithms and data owners. ASLR-060 replaced the fixed awaited Memory call with
> `MemoryPromptContributor`; ASLR-061 routes only initial/context-pressure normal compaction returns through
> `MemoryIngestionObserver.afterCompactionApplyReturned`, while resume/manual compaction retain their
> no-trigger baseline. No prompt, budget, schema or cache policy changed.

## 1. 模块目的

这个模块把 prompt contributors、Tape effective view、context budget、provider preflight/recovery 和
compaction 协调成明确的数据流。它参与 DeepChat `LoopEngine`，但不拥有 provider、skills、Memory 或
Tape 的底层数据。

## 2. BEFORE

当前 prompt/context 构建横跨 runtime、`contextBuilder`、Tape view、compaction service、provider
preflight 和 Memory orchestration。初始 turn、tool 后续 round、overflow recovery 与 resume path 的
刷新时机并不完全相同。

这些差异有业务含义。把它们“统一得更优雅”会改变模型实际看到的请求，因此首先需要锁定 request
fixtures，而不是先抽一个 generic prompt pipeline。

## 3. AFTER 数据流

```text
session config + resource revisions + input
  -> ordered BasePromptContributor[]
       base/runtime/env/skills/final tooling/permission
  -> ensure Tape/history + prepare optional compaction intent using that base prompt
  -> append user fact (and compaction projection first when intent exists)
  -> apply compaction intent when present
  -> ordered ContextPromptContributor[]
       summary/reconstruction/Memory at their current positions
  -> effective Tape view (policy remains legacy_v1 until separately changed)
  -> ContextAssembler / budget fit
  -> assistant placeholder + active generation registration
  -> provider-specific preflight/recovery
  -> immutable PreparedProviderRequest
  -> synchronous ViewManifest attempt (fail-open)
  -> ProviderPort
```

`PreparedProviderRequest` 创建后不可由 unrelated observer 修改。provider adapter 可以做现有的 wire
format mapping，但不得重新查询资源并改变逻辑顺序。

## 4. 固定 prompt 顺序

顺序分成两个固定 phase，不能用一个统一 contributor array 放到 compaction 之后：

```text
base agent prompt
  -> runtime capabilities/instructions
  -> system environment
  -> skill catalog metadata
  -> pinned/activated skill content
  -> tooling/MCP instructions
  -> permission/verification instructions
  -> [prepare compaction intent; append user; apply compaction]
  -> persisted summary/reconstruction sections
  -> Memory persona/working-memory contribution at current insertion point
  -> current effective conversation/tool context
```

若当前不同入口存在合法差异，则在 typed `PromptAssemblyMode` 中显式表达，而不是让 contributor 自行
根据全局状态猜测。

## 5. Contributor 合同

```ts
interface BasePromptContributor {
  readonly id: PromptContributorId
  contribute(context: BasePromptContext): Promise<PromptSection[]>
}

interface ContextPromptContributor {
  readonly id: PromptContributorId
  contribute(context: PostCompactionPromptContext): Promise<PromptSection[]>
}

interface PromptSection {
  id: string
  source: 'base' | 'runtime' | 'environment' | 'skill' | 'tooling' | 'memory' | 'other'
  content: string
  visibility: 'provider'
  provenance?: PromptProvenance
}
```

两组排序分别在 composition root 的固定数组中声明，不提供 runtime priority，也不允许 contributor
跨过 compaction 边界。contributor 必须：

- 尊重 `AbortSignal`；
- 不直接写 renderer、Tape 或 session status；
- 返回 section/provenance，不拼接整份 prompt；
- 按自己的明确 policy fail-open 或 fail-closed；
- 不缓存超出 owner revision 的内容。

## 6. InputPreparation 与 ContextCoordinator

```ts
interface ContextCoordinator {
  assemble(input: PostCompactionContextInput): Promise<PreparedContext>
  recoverFromPressure(input: ContextPressureInput): Promise<PreparedContext>
}
```

`InputPreparationCoordinator` 包装现有 Tape/history、compaction intent、user fact 和 apply 顺序；
`ContextCoordinator` 组合现有 `ContextBuilder`、Tape view policy 与 pressure recovery。职责包括：

- 选取 effective Tape slice；
- 合并 summary/reconstruction 和 prompt sections；
- 计算当前 provider/model budget；
- 执行现有 fitting/truncation policy；
- pressure recovery 时按当前 base prompt/compaction/Memory rebuild 顺序尝试 compaction；
- 在 provider preflight/overflow 时执行当前 recovery policy；
- 返回 ViewManifest 所需 provenance。

它不负责发网络请求或执行 tools。

## 7. Compaction 边界

compaction 是 awaited operation，必须可取消，但不是 persistent pause。initial input path 明确包含：

```text
base prompt + Tape/history
  -> prepare nullable intent
  -> if intent: create compaction projection
  -> append user fact
  -> apply intent (summarize + CAS/lineage + commit/reject)
  -> on any normal return, invoke current compaction Memory trigger
  -> on any throw, including AbortError, do not trigger
```

pressure recovery 没有新的 user fact，但同样只在 non-null intent 正常返回后触发。`succeeded=false`
仍是正常返回并触发；no intent 或 throw 不触发。权威矩阵见
[MEM-14](../migration-and-validation.md#4-memory-no-regression-contract)。

resume 与 manual compaction 仍不触发 compaction extraction；resume 完成后的 terminal fallback extraction
由 `MEM-13` 单独决定，不能与 `MEM-14` 合并。

## 8. Memory 参与

Memory prompt contributor 是 awaited、read-only、hard-budgeted、fail-open 的 section source。它不控制
context policy，也不修改 working memory/persona rows。当前 active persona、working memory、draft exclusion
和 sanitization 规则保持。

Memory ingestion 是 turn/compaction settle 后的 background observer，不属于 request assembly。

## 9. Round 刷新

每个 provider attempt 使用 immutable request snapshot。以下情形按当前规则重新 assemble：

- tool batch 完成并激活/改变 skill/resource；
- provider fallback 需要不同 model/wire capabilities；
- overflow/preflight recovery 改变 context；
- resume/retry 从新的 lineage 继续。

普通 raw stream event 不触发 prompt refresh。refresh 前必须完成前一 round 所需的 Tape/tool persistence。

## 10. 错误与取消

- Memory query 失败：按现有 fail-open，不阻塞 request；
- required base/config/provider mapping 失败：fail-closed，产生兼容 error projection；
- initial/context-pressure compaction `succeeded=false`：执行当前 fallback并仍触发现有 compaction
  Memory path；resume/manual 维持不触发；
- budget 无法 fit：沿用 provider preflight/overflow recovery 和 terminal error；
- abort：所有 awaited contributors/compaction/recovery 尽快终止，late result 通过 run/lineage fence 丢弃；
- ViewManifest 在 request 前同步尝试；写入失败记录 warning 并继续发送，不异步补写。

## 11. 迁移步骤

1. 捕获各入口、provider、tool round、Memory on/off、compaction on/off 的 request fixture。
2. 为每个现有 prompt fragment 标注 owner、order、refresh trigger、failure policy。
3. 分别引入 pre-compaction base contributors 与 post-compaction context contributors，输出仍交给旧
   builder。
4. 包装 Tape view/context builder 为 `ContextCoordinator`。
5. 把 Tape/history -> intent -> compaction projection/user fact -> apply 迁入
   `InputPreparationCoordinator`，保持 return/throw trigger matrix。
6. 接入 provider preflight/recovery，比较 exact request/manifest。
7. 最后迁移 Memory contributor，执行 Memory parity suite。
8. 删除 runtime 中重复拼 prompt、重算 budget 的分支。

## 12. 验证

- provider request golden fixture 比较 role/order/content/tool definitions 和 budget结果；
- initial、tool follow-up、fallback、overflow recovery、resume、retry、draft/subagent；
- skill activation 后下一 round prompt/tool refresh；
- compaction no-op/success/failure/abort/stale CAS；
- Memory on/off/query failure/anchor failure/oversized retrieval；
- ViewManifest 与实际 request source refs 一致；
- ViewManifest write failure 仍发出 request；
- cancellation at every awaited contributor；
- external hooks 不参与也不能改变 request assembly。

## 13. 明确不做

- 不改 prompt 文案、section 顺序或 budget 数值；
- 不把 contributors 做成第三方 priority plugin system；
- 不更换 Tape view policy；
- 不重写 compaction algorithm；
- 不把 provider-specific wire mapping搬进通用 context。
