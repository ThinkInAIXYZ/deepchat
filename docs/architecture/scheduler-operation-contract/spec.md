# Scheduler Operation Contract

## 状态

- Task：`SCH-001`
- Finding：`A-04`
- 文档类型：Architecture SDD
- 决策状态：已定稿，无 `[NEEDS CLARIFICATION]`
- 后续实施：`SCH-002A`、`SCH-002B`、`PRV-CAN-001`、`SCH-003A`、`SCH-003B`

## 先纠正一个分类误区

`cancellable`、`idempotent`、`non-cancellable` 不是严格互斥的三种性质。

- `cancellable` 描述“能不能要求正在执行的 attempt 停止，并观察到它已经结束”。
- `idempotent` 描述“重复执行是否仍然只有同一个业务效果”。
- `non-cancellable` 是 cancellation capability 的反面，不是 idempotency 的反面。

例如一个只读查询可以同时是 cancellable 和 idempotent；一个写入也可能不可取消但有唯一键，因此
idempotent。若把三个词直接做成一个 `kind`，调用方会误以为“能取消就能安全 retry”或“幂等就可以并发
retry”。这两种推导都不成立。

本设计保留审计报告要求的三种**执行策略**，但先按两个维度证明能力，再选择策略：

| 执行策略 | cancellation capability | replay safety | 典型处理 |
| --- | --- | --- | --- |
| `cancellable` | owner 能接收 `AbortSignal`，并能证明 attempt 最终 settle | 可幂等也可不幂等 | deadline 发出 abort，等 attempt settle；默认不自动 retry |
| `idempotent` | 可以不可取消 | owner 已证明重复执行效果相同 | 只在上一 attempt 已 settle 后 retry；deadline 后关闭 retry loop |
| `non-cancellable` | 不能证明可停止 | 重复有副作用、成本或结果不确定 | operation identity + `pending/unknown` + reconciliation |

选择顺序是：先证明可取消；证明不了时再证明完整幂等；两者都证明不了就按 non-cancellable
mutation 处理。默认策略是最后一种，不能凭函数名或 HTTP method 猜测。

## 用户需要

当前 route `Scheduler.timeout()` 能让调用方在 deadline 到达时收到 `TimeoutError`，但不能停止底层
operation。若 operation 是 session create、发送输入或工具交互，界面可能显示失败，而后台稍后成功。
若外层紧接着 retry，还可能同时运行两个 attempt。

用户需要的是：

1. timeout、cancel、retry 的名字与真实能力一致；
2. retry 永远不与同一次调用中尚未 settle 的 attempt 重叠；
3. 不可取消 mutation 不再伪装成确定失败；
4. 有意的异步 settlement 设计继续保留，不因“看起来反常”被误改；
5. 改造按小 PR 交付，避免一次重写 session、chat、provider 和 runtime。

## 目标

- 固定 `deadline`、`cancellation request`、`attempt settlement`、`operation settlement` 的不同含义。
- 把现有 route `Scheduler` 改名并收窄为 `OperationRunner`；它不再假装自己拥有 domain mutation。
- 为当前有 consumer 的 idempotent operation 定义窄 API；cancellable 只保留 owner-specific future
  contract，不预建零 consumer API。
- 为 non-cancellable mutation 定义 domain-owned operation/reconciliation contract。
- 给现有每个生产 consumer 一个有代码证据的迁移去向。
- 保留 `AgentRuntimePresenter.cancelGeneration()` 的 request-only、stream-handler-settlement 设计。
- 让 `sessions.create` 成为第一个 unknown-outcome mutation 样板。

## 范围澄清：这里说的 Scheduler 是谁

本设计只处理 [`src/main/routes/scheduler.ts`](../../../src/main/routes/scheduler.ts) 的 route operation
helper。它不是：

- Cron Jobs 的 `SchedulerProcessManager` / utility host；
- `StartupWorkloadCoordinator` 的 startup task queue；
- Knowledge Presenter 的 knowledge task scheduler；
- renderer 的 polling、debounce 或 animation scheduling。

这些模块碰巧也使用 scheduler/task 命名，但有自己的队列、状态机和 owner。本轮不建立全仓统一调度框架，
也不把它们塞进 `OperationRunner`。

## 代码真相

### 1. 当前 timeout 只结束等待，不结束 operation

[`TimeoutInput`](../../../src/main/routes/scheduler.ts#L9) 接收已经启动的 `Promise<T>`。调用
`timeout()` 以前，JavaScript 已经求值 `task:` 右侧表达式并启动 operation。

[`timeout()`](../../../src/main/routes/scheduler.ts#L91) 的实际流程是：

```text
already-started task ────────────────────────────── late resolve/reject
                  └─ Promise.race ── deadline ── caller gets TimeoutError
                                      └─ abort timer only
```

`finally` 中 abort 的是 `node:timers/promises` 的 delay controller，不是底层 operation。外部
`signal` 也只让 race reject；它没有传给 task。

因此当前 `TimeoutError` 只证明“caller 不等了”，不证明：

- operation 收到 cancel；
- operation 停止；
- operation 没有副作用；
- operation 不会稍后成功。

### 2. 当前 retry 可以在 timed-out attempt 仍运行时启动下一次

[`retry()`](../../../src/main/routes/scheduler.ts#L106) 每轮调用 `task()`，只等待这一层 Promise 的
结果。`SessionService.restoreSession()` 把 `timeout()` 放进 retry task：

```text
attempt 1 underlying read ───────────────────────── late settle
              timeout wrapper ── 5s reject
                                 25ms
                                      attempt 2 starts
```

对应代码在
[`SessionService.restoreSession()`](../../../src/main/routes/sessions/sessionService.ts#L38)。这不是
理论推演：wrapper 的 rejection 与 underlying read 的 settlement 是两个不同 Promise。

`SES-001` 已确认 restore read-only retry 是故意保留的产品策略，但该策略只允许 retry 已 settle 的
transient read；它没有授权 overlapping retry。

### 3. `sessions.create` 是确定的 non-cancellable mutation

当前路径是：

```text
SessionService.createSession
  -> Scheduler.timeout(5s, already-started Promise)
    -> AgentSessionPresenter.createSession
      -> resolve agent/provider/config
      -> NewSessionManager.create          # SQLite record/search/environment writes
      -> initializeSessionRuntime          # runtime/provider initialization
      -> bindWindow
      -> publish sessions.updated
      -> read runtime state
      -> enqueue initial input             # generation continues separately
```

证据：

- route timeout：
  [`sessionService.ts`](../../../src/main/routes/sessions/sessionService.ts#L27)
- record 创建后才 await runtime 初始化：
  [`agentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L315)
- 创建 record 会同步写 `new_sessions`、search document 和 environment：
  [`sessionManager.ts`](../../../src/main/presenter/agentSessionPresenter/sessionManager.ts#L45)
- runtime 成功后才 bind window、发 event、读取 state：
  [`agentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L405)
- 初始输入在 session result 形成后另行启动：
  [`agentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L430)

所以 5 秒可能落在 record 已写、runtime 正初始化或即将 binding 的任意位置。caller 收到
`TimeoutError` 后，这条调用链仍可完成。`createSession()` 没有 `AbortSignal` 参数，也没有 operation id。

此外，better-sqlite3 是同步调用。若同步 SQLite 工作阻塞 event loop，deadline timer 本身也不能按时
运行；Promise race 不能抢占同步 JavaScript/SQLite。

当前 production agent implementation inventory 只有一条实际 runtime owner：constructor 只把
`agentRuntimeAgent` 注册成 `deepchat`；`resolveAgentImplementation()` 对 catalog type 为 `deepchat` 或 `acp`
都返回这一个 registered `deepchat` implementation。该 implementation 实现了 `queuePendingInput()`，并在
SQLite pending-input store 创建 record 后返回；ACP 不是另一个缺少 queue 的 implementation。create 中的
`else processMessage()` 是 optional interface 的 compatibility fallback，当前没有 production owner 会走到。
因此后续不为零 consumer 设计 accepted-start API，而是删除 create 的 fallback 并用 static inventory guard
阻止未来无 queue implementation 静默接入。

### 4. activate/deactivate 和 provider model timeout 是无效包装

[`activateSession()` / `deactivateSession()`](../../../src/main/presenter/agentSessionPresenter/index.ts#L1869)
的方法体没有 `await`：它们同步修改 `windowBindings` 并同步 publish event，随后才返回 resolved
Promise。`SessionService` 得到 Promise 时副作用已经发生，5 秒 timeout 不可能保护这段工作。

[`ProviderService.listModels()`](../../../src/main/routes/providers/providerService.ts#L16) 更直接：

```ts
Promise.resolve(providerCatalogPort.getProviderModels(providerId))
```

`getProviderModels()` 在 `Promise.resolve()` 之前同步执行。这里的两个 timeout 只增加 timer/race，不能
中断或限制同步 model lookup。

### 5. provider connection test 的 5 秒外层 timeout 会留下真实请求

[`ProviderService.testConnection()`](../../../src/main/routes/providers/providerService.ts#L39) 用 5 秒
route timeout 包住 `LLMProviderPresenter.check()`。

带 `modelId` 时，`check()` 会发起真实 `provider.completions()`，内部另有 60 秒 race；外层 5 秒先
返回 `TimeoutError` 后，请求仍会继续，见
[`llmProviderPresenter/index.ts`](../../../src/main/presenter/llmProviderPresenter/index.ts#L639)。

60 秒也只是 observation deadline：它 resolve `null`，没有把 signal 传给 `provider.completions()`，所以
不能称 provider owner timeout。未传 `modelId` 时则直接 `await provider.check()`；不同 provider 实现各自
决定网络/SDK 行为，`LLMProviderPresenter` 没有统一 deadline，更没有统一 cancellation。部分实现可能由 SDK
内部超时，部分可能无界；在逐 provider 证明前，文档不能概括成“owner 已有 timeout”。

这类 probe 虽不修改 DeepChat 数据，却可能消耗 provider quota/cost，因此不能只凭“查询”二字认定完整
幂等，也不能在 5 秒后自动重试。

### 6. ChatService controller 不拥有 generation settlement

[`ChatService`](../../../src/main/routes/chat/chatService.ts#L16) 的 `activeControllers` 只传给 route
Scheduler race；`ProviderExecutionPort.sendMessage()` 没有 signal 参数。当前 send 实际上通常在 durable
pending input 被接收后就返回，generation 在 runtime 后台继续。

因此 30 分钟 `CHAT_SEND_TIMEOUT_MS` 不是 generation handle 的 timeout。这个 owner 混淆由 `D-05` 的
`CHAT-001/002` 决策，不在 SCH 中顺手重写。

### 7. `cancelGeneration()` request-only 是故意的

[`AgentRuntimePresenter.cancelGeneration()`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L2204)
只 abort controller 并释放 deferred tool/permission controller。它明确不写 terminal block、不发 terminal
hooks、不设 idle，也不从 active map 提前清理。

这不是遗漏。commit `3ea97717` 为 steer/queue race 修复了重复 settlement：真正的 terminal settlement
由 in-flight `processMessage()` / stream handler exactly once 完成。对应测试覆盖：

- aborted turn 只发一次 `user_stop` hook；
- stale aborted run 不覆盖 newer run；
- cancel 后 terminal block 由 stream completion 写入。

所以 SCH 不会把 `cancelGeneration(): Promise<void>` 重新解释为“generation 已物理结束”。它只表示
“cancel request 已发出”。如果调用方需要等待 terminal settlement，应由 generation owner 按 `runId`
提供单独的 observable handle；不能让 route Scheduler 猜。

## 历史意图核验

commit `8ef5c858` 同时引入：

- route `Scheduler` 代码；
- `SessionService` / `ChatService` / `ProviderService`；
- 已归档的 `main-kernel-refactor/ports-and-scheduler.md`。

历史文档的目标是统一 timeout/retry/cancel、提高 cleanup 可靠性和 fake scheduler 可测性；它还声称
cancel owner 需要统一。但同一份建议接口已经把 `TimeoutInput.task` 定义成 `Promise<T>`，使 signal 无法
传入 operation。

结论：抽出窄 timing port 的意图是故意且合理的；“deadline race 等于 cancellation”不是有证据支持的
产品语义，而是第一版接口能力与目标冲突。正确处理是保留窄 port/测试 seam，修正 contract，不回退到
散落 timer，也不引入第三方 retry framework。

commit `9cce714e` 增加 message pagination 时沿用了既有 timeout wrapper，只说明调用方式延续，不能证明
unknown-outcome 是有意产品行为。

## 术语

| 术语 | 本文定义 |
| --- | --- |
| `attempt` | 一次具体 task invocation，从 task function 被调用到它的 Promise settle |
| `deadline` | caller 最多愿意等待到的时间点；本身不等于 cancellation |
| `cancellation request` | owner 收到停止请求；不等于 operation 已终止 |
| `attempt settlement` | attempt Promise fulfilled/rejected，且 owner 声明该 attempt 不再继续产生效果 |
| `operation settlement` | domain operation 到达 `succeeded` 或确定 `failed` terminal state |
| `pending` | operation 仍由 owner 跟踪并可能完成 |
| `unknown` | 当前没有足够证据宣称成功或失败；不得自动开始新 operation |
| `reconciliation` | 用 operation id 查询权威状态，并将 `pending/unknown` 收敛到可行动状态 |

## 架构决策

### D1. `Scheduler` 重命名为 `OperationRunner`

route helper 不排队、不分配资源，也不拥有 Cron/background task。`OperationRunner` 更准确。它只负责：

- abortable sleep/backoff；
- idempotent observation deadline；
- strictly sequential bounded retry。

它不负责：

- domain operation id；
- session create journal；
- generation active-run state；
- compensation/rollback；
- cross-process recovery。

### D2. 不做万能 `run({ kind })`

分别使用 capability-specific API，避免 caller 用一个字符串绕过类型和 review：

```ts
interface OperationRunner {
  sleep(input: SleepInput): Promise<void>

  observeIdempotent<T>(input: {
    task: () => Promise<T>
    deadlineMs: number
    reason: string
    signal?: AbortSignal
  }): Promise<T>

  retryIdempotent<T>(input: {
    task: (attempt: number) => Promise<T>
    maxAttempts: number
    initialDelayMs: number
    backoff: number
    overallDeadlineMs: number
    reason: string
    signal?: AbortSignal
    shouldRetry: (error: unknown) => boolean
  }): Promise<T>
}
```

这是 contract 方向，不要求实现照抄属性排列。必须保留的语义是 task factory、overall deadline、
sequential attempt 和 explicit `shouldRetry`。

当前生产 consumer 中，没有一处同时满足“真实 owner 接收 signal”和“abort 后可观察 physical settlement”。
因此 `SCH-002A` 不实现 `runCancellable()`，也不把 unused method 放进 port。未来只有真实 consumer 与 owner
一起证明 cancellation/settlement 后，才建立 owner-specific slice；下面 D4 是该 slice 的验收规则，不是
本轮待实现接口。

### D3. `observeIdempotent` 明确只是 observation deadline

contract：

1. runner 先安装 deadline/abort listener，再调用 task factory；
2. deadline 到达时 caller 收到 `ObservationDeadlineError`；
3. 若 task 不支持 cancellation，底层 attempt 可以晚 settle；
4. runner 必须给 late resolve/reject 安装 handler，不能产生 unhandled rejection；
5. 此 API 只允许 read-only 或完整 idempotent operation；
6. 它不自动 retry，也不把 late result 写回 caller state。

`ObservationDeadlineError` 的名字用于阻止上层把它理解成“operation 已失败”。

### D4. future cancellable API 必须等待 cancellation settlement

contract：

1. task 必须是 `(signal) => Promise<T>`，不能传 already-started Promise；
2. deadline 或外部 abort 会 abort runner 创建/组合的 signal；
3. runner 在 task Promise settle 前不启动任何 replacement/retry；
4. deadline 导致的 abort 只有在 attempt settle 后才映射为 `TimeoutError`；
5. 外部 abort 只有在 attempt settle 后才映射为 `AbortError`；
6. task 若忽略 signal 并永不 settle，runner 也不会伪造“已取消”。这是 owner contract violation，不能用
   第二个 race 掩盖；此类 operation 应重新分类为 non-cancellable。

`TimeoutError` 在新 contract 中因此具有更强含义：cancellation request 已发出，且本 attempt 已 settle。
它仍不自动授权 retry；retry 还要单独证明 idempotency 或 no-effect failure。

该决策现在只冻结语义。`SCH-002A` 不实现、导出或测试 `runCancellable()`；首次真实 consumer 必须在
owner-specific follow-up slice 中同时补 signal propagation、settlement proof 和 focused tests，不能只在
generic runner 中加一个无人使用的方法。

### D5. `retryIdempotent` 只 retry 已 settle 的 rejection

contract：

1. 任意时刻最多一个 attempt running；测试断言 `maxConcurrentAttempts === 1`；
2. 只有 task Promise 已 reject 且 `shouldRetry(error) === true` 才进入 backoff；
3. fulfilled 直接返回；`shouldRetry === false` 直接抛出；
4. overall deadline/外部 abort 到达时关闭 loop，之后绝不启动新 attempt；
5. 若 deadline 到达时 attempt 仍运行，caller 可结束等待，但 late attempt 只被 drain，不能触发下一轮；
6. backoff 期间 deadline/abort 立即阻止下一 attempt；
7. `maxAttempts` 必须是有限正整数；默认不 retry。

`SES-002` 的 restore/getActive 都把 `transient_error` result 转成 typed rejected read attempt，且只有该
rejection 的 `shouldRetry` 返回 true。`missing`、`unavailable`、validation error、observation deadline 都不
retry。

### D5.1. 数值输入先验证，再启动 task

runner 不接受 JavaScript timer 的隐式 coercion。所有数值必须在 task factory 调用前验证：

- `deadlineMs`、`overallDeadlineMs`、`initialDelayMs`：有限整数，`0..2_147_483_647`；`0` 表示立即截止；
- `maxAttempts`：有限正整数；production caller 必须用常量，本轮只允许已评审的 `2`；
- `backoff`：有限且非负；每次算出的实际 delay 也必须仍是有限整数并在 timer 上限内；
- history `limit`：route schema 约束为整数 `1..50`，默认 `20`；cursor `createdAt` 必须是 finite
  nonnegative integer，cursor `operationId` 复用 UUID/length schema；
- `NaN`、`Infinity`、负数、小数毫秒、乘法溢出全部 typed reject，且 task/timer 均不得启动。

这些是 correctness validation，不是业务 timeout 调参。`25ms`、`2 attempts` 和 route observation deadline
仍由 consumer contract 固定，caller 不能从未验证的 IPC 值覆盖。

### D6. non-cancellable mutation 由 domain owner 管理

`OperationRunner` 不接收 non-cancellable mutation。domain contract 至少包含：

```ts
type OperationState<T> =
  | { state: 'pending'; operationId: string }
  | { state: 'succeeded'; operationId: string; value: T }
  | { state: 'failed'; operationId: string; code: string }
  | { state: 'unknown'; operationId: string; code: string }
```

这里的 TypeScript 只是解释状态机。真实 session operation DTO 只由
`src/shared/contracts/routes/sessions.routes.ts` 的 Zod schema 定义，并从 schema/route contract inference
得到类型；不得在 `src/shared/types/agent-interface.d.ts` 再定义一份 operation DTO。后者属于 agent/runtime
消息领域，不是 sessions route contract owner。

规则：

- observation deadline 返回 `pending`，不是 throw `TimeoutError`；
- 同一 `operationId` 的重复请求复用同一 attempt/state，不启动第二个；
- `failed` 只允许在 owner 能证明 attempt settle 且补偿完成时写入；
- cleanup/compensation 任一结果不确定时必须是 `unknown`；
- `unknown` 不自动 retry；用户显式 retry 也必须先 reconcile 原 operation；
- reconciliation 查询权威记录，不按 error message 猜状态；
- operation result 不因 renderer 停止等待而丢失。

### D7. cancel request 和 settlement handle 分开

以下两个 API 语义不能复用一个 `Promise<void>`：

```ts
requestGenerationCancel(sessionId: string): Promise<void>
waitForGenerationSettlement(runId: string): Promise<GenerationTerminalState>
```

当前 `cancelGeneration()` 保持第一种语义和兼容名称。第二种只有 `CHAT-001/002` 证明真实 consumer 需要时
才新增；SCH 不预建无 consumer 的 generation abstraction。

## 三类策略的完整 contract

| 项目 | `cancellable` | `idempotent` | `non-cancellable` |
| --- | --- | --- | --- |
| task 输入 | `(signal) => Promise<T>` | `() => Promise<T>` | domain command + `operationId` |
| deadline 到达 | abort signal，等待 settle | caller 停止观察；attempt 可晚 settle | 返回 `pending` |
| external cancel | 请求 abort，等待 settle | 只停止观察/关闭 retry loop | caller 停止等待；operation 继续 |
| timeout 后能否称失败 | task settle 后可称 timed out | 不能称 underlying 失败 | 不能；只能 pending/unknown |
| retry 条件 | settle 后，且另证幂等/no-effect | settle rejection + explicit classifier | 不自动 retry；同 id reconcile |
| overlap | 禁止 | 禁止 retry overlap | 同 id 永远 single-flight |
| reconciliation | 通常不需要 | 通常不需要 | 必须 |
| late result | 已由 settle 消化 | drain 丢弃，不触发 retry | 写 operation state，供查询 |

## 现有 production consumer 的分类与去向

| Consumer | 代码事实 | 策略/处置 | 实施 owner |
| --- | --- | --- | --- |
| `sessions.create` | 多阶段 DB/runtime/input mutation；当前还提前 bind window；无 signal | non-cancellable operation；operation id + reconciliation；新 backend 不负责 binding | `SCH-003A/B` |
| `sessions.restore` session read | read-only；`SES-001` 明确保留 bounded transient retry | `retryIdempotent`；overall deadline 后不再启动 attempt | `SCH-002B`，需基于 `SES-002` contract |
| `sessions.listMessagesPage` | read-only page lookup | `observeIdempotent` | `SCH-002B` |
| `sessions.list` | record read + runtime state snapshot/cache hydration；无 retry | 只读/idempotent observation；不加 per-row retry | `SCH-002B`，保持 `SES-*` 四态 |
| `sessions.getActive` | read + 当前 missing 时 unbind；`SES-*` 正在拆四态 | 与 restore 一样保留 typed transient、settled-only `2 attempts/25ms`；attempt/deadline/transient 期间不清 binding | `SES-002` → `SCH-002B` |
| `sessions.activate/deactivate` | 同步 map set/unset + event，Promise 返回前已完成 | 直接 await/call；删除无效 timeout，不 retry | `SCH-002B` |
| `providers.listModels` | getter 在 `Promise.resolve` 前同步完成 | 直接调用；删除两个无效 timeout | `SCH-002B` |
| `providers.testConnection` | 真实 probe；route 5s 不取消；model 60s 也只观察；no-model 无统一 bound | `SCH-002B` 暂不改，保留为已知 legacy exception且绝不 retry；真实 owner cancellation 另立 `PRV-CAN-001` | provider owner task 后再迁移 |
| Chat preflight session/agent lookup | read-only；stop 可以停止 route 继续进入 mutation | `observeIdempotent` + route wait signal；同 session 的 send 与全部并发 steer preflight 都纳入 stop fence，late read 不继续 mutation | `SCH-002B` |
| `chat.sendMessage/steer/respond` | durable queue/tool mutation；现有 task 不收 signal | 删除 mutation 外层 deadline，等待 owner acceptance；不自动 retry | `SCH-002B`；generation owner 仍属 `CHAT-*` |
| `chat.stopStream` cleanup | controller abort + permission clear + cancel request；cancel 不是 terminal settle | 保留 request semantics，直接等待 cleanup request results；不宣称 generation settled | `SCH-002B` / `CHAT-*` |

`sessions.restore` 与 `sessions.getActive` 的 retry 数值不是建议值，而是 SES contract：最多 `2 attempts`、
两次之间 `25ms`，只对已 settle 的 typed `transient_error` retry。尤其 `getActive` 在第一次 transient、backoff、
第二次 attempt、observation deadline 或 late settlement 期间都必须保留原 binding；只有 SES-002 的权威
`missing` terminal 结果才有资格 unbind。`unavailable`、deadline 和 transient 都不等于 missing。

## `sessions.create` reconciliation 样板

### Operation identity

- renderer 每次用户 create intent 用平台 `crypto.randomUUID()` 生成一个 `operationId`；同一 intent 的
  transport retry 必须复用该 id。
- route schema 使用 `z.string().uuid().length(36)`；empty、非 UUID、前后空白和超长值都在 handler/DB/runtime
  副作用前失败。history cursor 中的 operation id 复用同一 schema。
- main 在执行副作用前登记 operation，并预分配 `sessionId`。
- 同 id + 同 input fingerprint 返回既有 state；同 id + 不同 fingerprint 在 service 内可使用 typed
  `OperationConflictError`，绝不覆盖旧 operation；route 必须把它映射为 serializable `conflict` output。
- 新 id 在 insert 前还要查询相同 fingerprint 的所有 `pending/unknown` operation，包括已经 dismiss 的记录。
  命中时 service 可使用 typed `ExistingCreateOperationError`，route 映射为 serializable `existing` output，
  携带 content-free old operation identity/state，不启动新的 session/runtime/input。`failed/succeeded` 已
  terminal，不阻止用户创建内容相同的新 session。
- fingerprint 只用于冲突检测，和 session 数据保存在同一 SQLite/SQLCipher database；不得另建
  plaintext sidecar。日志不得记录 message、file path、fingerprint 或 payload。

operation id 是 transport identity，fingerprint 是 restart 后丢失 id 时的 duplicate guard，二者不能互相
替代。`unknown` 必须先 reconcile：权威 session/runtime/queue 证据能收敛才改成 `succeeded/failed`；仍无法
证明时继续阻止相同 fingerprint 的新 create。dismiss 不是 abandon，也不授权 retry。

renderer 收到 `kind: 'existing'` output 后只显示 content-free “Check existing operation”选择；用户显式选择
前不把当前 draft 关联旧 operation，也不能换第三个 id继续 create。这样既能找回丢失 id，又不把“相同
payload”武断等同于“相同用户意图”。

### 最小 journal

`SCH-003A` 使用 domain-specific `session_create_operations`，不建立全仓 generic operation framework。
最小字段：

```text
operation_id        primary key
session_id          unique
input_fingerprint
state               pending | succeeded | failed | unknown
stage               accepted | record_created | runtime_ready | input_not_required |
                    input_accepted | completed
error_code          nullable, stable/content-free
dismissed_at        nullable
created_at
updated_at
```

不持久化 create message/files payload 的副本。当前进程中的 single-flight entry 持有原始 input 和 Promise；
journal 只保存 identity、stage 和结果证据。实现要为 `(input_fingerprint, state)` duplicate lookup 与
`(created_at, operation_id)` history cursor 建窄索引，避免 operation row 增长后每次 create/recovery 全表扫描。

### Stage 与 terminal 规则

| 证据 | journal 结果 |
| --- | --- |
| operation 已登记，attempt 正在当前进程执行 | `pending` |
| session record/runtime ready/initial input accepted 或明确 not required 全部完成 | `succeeded` |
| attempt 已 reject，且 runtime/provider/record compensation 全部完成 | `failed` |
| cleanup 任一步失败、process 在 incomplete stage 重启、无法证明 initial input 是否 accepted | `unknown` |
| process 重启后 journal `succeeded` 且 session record 可读 | 重建 result，仍为 `succeeded` |
| process 重启后 journal incomplete | 保守转 `unknown`；不自动重放 payload |

当前 `cleanupFailedSessionInitialization()` 会吞掉 cleanup error 后删除 record。实施时必须让 operation owner
拿到每个 compensation 结果；否则它没有资格写 `failed`。这不要求把 raw error 暴露 renderer，只记录稳定
error code 和内部日志。

### Initial input acceptance 复用现有 durable queue

当前 production `deepchat/acp` 都解析到同一个 `agentRuntimeAgent`，它实现 `queuePendingInput()`：先在 SQLite
pending-input store 创建 record，再在后台调用/排空 `processMessage()`。因此 `SCH-003A` 直接 await 现有
queue Promise；它 resolve 是“输入已 durable accepted”的证据，不是 generation completed。

规则：

1. 无首条输入时写 `input_not_required`；
2. 有输入时 await `queuePendingInput()` 返回 record 后写 `input_accepted`，不等待后台 generation；
3. 删除 create path 当前 unreachable 的 `else processMessage()`；不新增 separate acceptance slice 或
   speculative accepted-start API；
4. static guard 固定 production create implementation 全部具有 queue capability。未来若注册无 queue 的
   owner，必须先单独写 owner spec 和 durable acceptance contract，不能恢复 fire-and-forget fallback；
5. title generation 不属于 input acceptance，也不阻塞 operation terminal state。

### Route compatibility

保留 `sessions.create` 名称，但不发布一个“backend 已改、renderer 仍旧”的中间版本：

- `SCH-003A` 是 non-mergeable backend development slice；`SCH-003B` 显式依赖 `SCH-003A + SES-003`；二者
  可以分 commit、分 develop/verify，但必须在同一个 atomic production PR/cutover 中合入；
- route schema 在 cutover 中新增 operation envelope；新路径允许 `session: null` + `pending/unknown`；
- 同一个 PR 把全部 production caller 改为传 `operationId`，静态 guard 要求缺失 caller 为 `0`；
- route schema 直接要求 UUID/length-valid `operationId`；missing/malformed 都是 generic validation rejection，
  在任何副作用前结束，renderer 不按错误类型分支；
- 不提供“无 id 就一直等”的 adapter，也不伪造可独立合入的 003A compatibility；
- 新增 `sessions.getCreateOperation`、cursor-paginated `sessions.listCreateOperations` 和 dismiss route；不新增
  第二条 create command。

内部 Electron main/renderer 同版本交付，因此这里选择 atomic cutover，比维持两套长期 create 语义更稳定。
若 static inventory 仍发现无 id 的 production caller，整个 `SCH-003` 不得 merge。

### Electron IPC output contract

当前 bridge 直接调用 `ipcRenderer.invoke()`；main 的 `ipcMain.handle()` 也直接让 exception 穿过 Electron，
没有自定义 error envelope。Electron 对 rejected handler 只保证 renderer 得到 error message，不能依赖 custom
Error class/prototype、`code`、`operationId` 或 `state`。因此 renderer 需要分支的 domain outcome 必须是正常
route output，不是 throw。

`sessions.create` output 由 `sessions.routes.ts` 的 Zod discriminated union 唯一定义，最小形状如下；字段名可在
实现中保持同义，但三类语义不能合并：

```ts
type SessionCreateOutput =
  | {
      kind: 'operation'
      operation: CreateOperationEnvelope
      session: SessionWithState | null
    }
  | {
      kind: 'existing'
      code: 'CREATE_OPERATION_EXISTS'
      operation: ContentFreeCreateOperationSummary
    }
  | {
      kind: 'conflict'
      code: 'CREATE_OPERATION_CONFLICT'
      operation: ContentFreeCreateOperationSummary
    }
```

规则：

- `operation` 表示新 operation 或同 id/same fingerprint 的既有 operation；state 可以是
  `pending/succeeded/failed/unknown`，renderer 从 envelope 读取，不从 Error 读取；
- `existing` 表示新 id 命中 same fingerprint unresolved row；summary 必须带 old `operationId`、`sessionId`、
  `state`、`stage`、`dismissedAt`，因此 renderer 能显式 Check；
- `conflict` 表示 requested id 已属于不同 fingerprint；同样返回原 row 的 content-free identity/state，零
  副作用且可 Check；
- internal service 可以抛 typed errors，route adapter 只能用 error class/stable internal code 做 exhaustive
  mapping；禁止按 `error.message` substring 分类；
- malformed/missing operation id 只走 generic schema validation rejection；正常 bridge caller 会先在 preload
  `contract.input.parse()` 失败，其他入口也必须在 main schema guard 失败。renderer 不按错误类型分支，因此不必
  增加 output variant；若未来 UI 需要区分，也必须增加 variant；
- unexpected infrastructure/programming error 继续 reject，renderer 只能作为 generic failure 展示，不读取
  custom fields。

boundary test 不能只直接调用 `dispatchDeepchatRoute()`。必须使用 real Electron IPC，或等价 harness：main route
output 经过 structured serialization/clone，再由 preload `createBridge()` 和 renderer contract parse。测试覆盖
`operation/existing/conflict` 三种 variant，并有 negative control 证明 thrown custom Error 过 Electron-like
boundary 后只剩 message，renderer 逻辑仍不依赖丢失字段。

### Restart 后的 content-free recovery identity

renderer 内存中的 current intent token 会随进程消失，仅有 `getCreateOperation(operationId)` 不足以让新
renderer 找回 operation id。恢复采用 cursor pagination，不持久化 draft/payload：

```text
sessions.listCreateOperations({ cursor?, limit?: 1..50 = 20 })
  -> items: [{ operationId, sessionId, state, stage, createdAt, updatedAt, dismissedAt }]
  -> nextCursor: { createdAt, operationId } | null
  -> hasMore: boolean
```

规则：

- 返回所有仍保留的 operation identity；按 immutable `createdAt DESC, operationId ASC` 稳定排序，cursor 使用
  同一复合 key，state/updatedAt/dismiss 变化不会让 row 在翻页间移动，也不能漏掉同毫秒记录；UI recovery 默认
  关注 `pending/unknown`，但 dismissed/history 仍可翻页查回；
- route 不返回 prompt、files、title、agent/provider/model、fingerprint、error detail 或任何 input payload；
- app restart 把 persisted incomplete `pending` 保守转为 `unknown`，不重放 payload；
- 无论列表只有一条还是多条，UI 都只显示“待确认的创建记录”，必须由用户显式选择“查看结果”；不得把它
  绑定到当前 draft，不得自动 navigate/activate；
- succeeded session 仍由正常 session list 展示；history row 可用于诊断/去重，直到 session deletion cleanup；
- dismiss 只写 content-free `dismissed_at`，含义是 UI 折叠。默认 recovery panel 可折叠它，但 history route、
  fingerprint duplicate query 和 retry guard 都必须继续看见；它不删除 session/identity，不把 unknown 改 failed；
- failed/unknown row 不用猜测 TTL 删除。cursor pagination 防止一次加载无界；只有测量证明 DB 增长后才设计
  maintenance。

选择 recovery item 后，UI 只用 operation id 调 `getCreateOperation`。如果状态后来 succeeded，仍按 stale
intent 处理：刷新 session list，不抢当前页面。当前 draft 永远由现有 draft owner 保存，不能写进 journal，
也不能附着到 restart 前的 operation。

### Binding、event 与 renderer 收敛

create backend 不拥有窗口意图，不能调用 `bindWindow()`。当前 create port 的 production caller inventory
只有 renderer 的 `sessions.create` route；remote-control session 使用独立 remote binding owner，其他 grep
命中是 tests 或无关同名函数。因此 `SCH-003A` 从 create repository/presenter port 移除 `webContentsId`，不为
假想 caller 保留自动 binding。

operation owner 在 terminal success 后只发一次 non-activation `sessions.updated(reason: 'created')` list
notification，不带 `activeSessionId/webContentsId`。该 event 是 post-commit notification，不是 journal stage；
renderer restart/history reconciliation 不依赖 event replay。窗口 binding 只由显式 `sessions.activate` 拥有：

- token 仍是 current intent：upsert session，await `sessions.activate(sessionId)`，确认成功后 navigate 并完成
  onboarding；
- 用户已切换/发起另一次 create：只刷新 session list，绝不 activate/navigate；
- `pending`：显示“正在确认创建结果”，不显示失败；
- `unknown`：保留输入草稿，允许刷新/查询；不自动创建第二个 session。

create 开始前的 binding（已有 session id 或 null）在 record/runtime/queue/pending/late success 全程不变。
`sessions.activate` 每个 current intent 只调用一次，并只发布一次 `reason: 'activated'` event；create event 不得
伪装 activation。测试必须分别断言 previous binding retained、stale late success 零 activate、current success
bind exactly once/event exactly once。

create 保留现有 `5_000ms` 作为第一次 observation deadline，但到点返回 `pending`，不再返回 operation
failure。current intent 之后每 `2_000ms` 查询一次，最多自动查询 `15` 次；仍未 terminal 就停止自动 timer，
保留手工“再次检查”。这些是 code-owned UX constants，不从 IPC 接收，正确性不依赖它们；页面离开或 intent
变化必须立即清理 timer。

UI 状态示意：

```text
Normal (< observation deadline)
+---------------- New Thread ----------------+
| [prompt draft............................] |
|                              [Send]        |
+--------------------------------------------+
                    |
                    v
+------------------- Chat -------------------+
| session created and activated              |
+--------------------------------------------+

Slow / pending
+---------------- New Thread ----------------+
| Creating session...                        |
| Confirming the result; draft is preserved. |
+--------------------------------------------+
                    |
             reconcile by operationId
              /                     \
             v                       v
      succeeded/current       succeeded/stale intent
      activate + navigate     refresh list only

Unknown
+---------------- New Thread ----------------+
| Creation result is not confirmed.          |
| [Check again] [Refresh session list]        |
| Draft remains available; no auto retry.     |
+--------------------------------------------+

Restart recovery history (content-free)
+---------------- New Thread ----------------+
| Unconfirmed session creations (2)          |
| 10:42  unknown                 [Check]      |
| 10:39  unknown                 [Check]      |
|                  [Dismiss] [Show history]   |
+--------------------------------------------+
| History: dismissed records remain checkable|
| Current draft stays separate.              |
+--------------------------------------------+
```

实际 copy 使用 i18n key；ASCII 只定义布局和行为，不锁定最终文案。

## Acceptance Criteria

### SCH-001 文档

- 本目录有 `spec.md`、`plan.md`、`tasks.md`，无 `[NEEDS CLARIFICATION]`。
- 三种策略的 timeout/retry/settlement/reconciliation contract 全部明确。
- current consumers、故意的 cancel settlement 和历史意图都有代码/commit 证据。
- `SCH-002` 可独立交付；`SCH-003A/B` 可以分段开发验证但明确 atomic merge，文档没有伪造 backend-only
  compatibility。

### SCH-002 implementation

- task factory 在 operation 启动前交给 runner；`SCH-002A` 没有零 consumer 的 cancellable API。
- `retryIdempotent` 的最大并发 attempt 永远为 1。
- overall deadline 在 running attempt/backoff 到达后都不会再启动 retry。
- late rejection 被 drain，无 unhandled rejection。
- sync provider catalog 不再经过 fake timeout。
- provider connection probe 的 route 5 秒 wrapper 被明确保留为 known exception；model 60 秒 observation 与
  no-model unbounded truth 有 tests，`PRV-CAN-001` 未完成前不假称 owner cancellation。
- session/chat safe consumers 按 inventory 迁移；legacy allowlist 包含 `sessions.create` 与精确的
  `providers.testConnection`，不得扩大。
- production legacy retry caller 为零，`retry()` surface/adapter/input 已删除；settled-only retry 只经
  `retryIdempotent()` 暴露。
- `AgentRuntimePresenter` exactly-once cancel settlement tests 不变绿转红。

### SCH-003 implementation

- deferred create 超过 observation deadline 返回 `pending`，不是 `TimeoutError`。
- 同 `operationId` 的重复 create 不会创建第二条 session/runtime/input。
- 新 id + 相同 fingerprint 的 pending/unknown（含 dismissed）在副作用前返回 existing operation，不能重复
  create。
- operation/existing/conflict 是 sessions route Zod output variants；renderer 所需 id/state/code 经 structured
  IPC boundary 后仍存在，不依赖 custom Error fields/message。
- late DB/runtime/input completion 可用 operation id 查询并收敛；create backend 全程不改变 window binding。
- cleanup 失败或 incomplete restart 返回 `unknown`，不伪造 `failed`。
- initial input stage 只在当前 production durable queue resolve 后前进，不等待整轮 generation；无 speculative
  fallback API。
- renderer pending 不丢草稿；stale intent 零 activate；current intent 显式 activate exactly once。
- restart history cursor-paginated/content-free/稳定排序，dismissed identity 可查回，用户显式选择且绝不绑定
  当前 draft。
- missing、empty、malformed、超长 operation id 都在副作用前 finite reject；`SCH-003A/B` atomic merge。
- journal 不记录 raw prompt/file/payload，日志不输出 fingerprint。

## 约束

- 技术标识、type/function/commit 使用英文；用户文案通过 i18n。
- 不增加第三方 retry/operation dependency；Node timer、AbortController、SQLite 已足够。
- 不用 feature flag 维持两套长期语义；create 使用 atomic cutover，无 id compatibility 只做 finite pre-effect
  rejection。
- 不在 SCH 中重写 Agent runtime generation queue、Cron scheduler 或 startup coordinator。
- 同步 better-sqlite3 不能被 Promise deadline 抢占；性能问题要靠 query/worker/owner 设计解决，不能靠
  `Promise.race` 宣称解决。
- 所有新 error/status 使用 typed contract，不按 message substring 分类。

## Non-goals

- 不在 `SCH-001` 改生产代码。
- 不把所有 repository method 改成 AbortSignal-aware。
- 不解决 generation settlement owner；create 只复用现有 durable pending-input acceptance。
- 不改变 `cancelGeneration()` 的 request-only semantics。
- 不给 Cron/Startup/Knowledge scheduler 建共同基类。
- 不做 cross-device/distributed operation journal。
- 不在 journal 复制用户 prompt/file payload。
- 不自动恢复 incomplete create payload；重启后证据不足时明确 `unknown`。
- 不用任意 timeout 数值替代 owner contract；provider route 5s 是显式登记、等待 owner task 的遗留观察
  deadline，不得描述为真实取消或稳定终态。

## 已拒绝方案

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 把 `Promise<T>` 改成 `(signal) => Promise<T>` 后一律称可取消 | 拒绝 | task 收到 signal 不等于 owner 会停止/settle |
| timeout 后固定 sleep 一小段再 retry | 拒绝 | 无法证明上一 attempt 已结束，时间常数不是 correctness proof |
| 幂等 operation 可以 overlap retry | 拒绝 | requirement 明确禁止；并发读也可能放大负载/cost |
| 所有 mutation timeout 都改成很长 | 拒绝 | 只降低触发概率，unknown-outcome 仍存在 |
| timeout 后调用 cleanup 然后立刻报 failed | 拒绝 | cleanup 也可能失败；必须观察 compensation 结果 |
| 让 generic runner 保存所有 domain operations | 拒绝 | operation state/reconciliation 是 domain truth，会形成新 God object |
| 引入 `p-retry`/queue framework | 拒绝 | 现有问题是 contract，不是缺少 backoff library |
| cancel 时同步写 terminal state | 拒绝 | 违背 `3ea97717` exactly-once settlement 修复，会恢复 stale/double settlement |
| 新建第二个 `sessions.beginCreate` API 家族 | 拒绝 | 可在现有 typed route 上 additive migration，无需永久双轨 |
| journal 保存完整 create payload 以自动重放 | 拒绝 | 重复敏感数据且扩大恢复状态机；样板先选择 conservative unknown |
| 进程重启后看到 partial record 就自动宣称成功 | 拒绝 | 无法证明 initial input 已 accepted，也无法证明 cleanup/remote state |
| SCH-003A backend 先独立 merge，旧 caller 无 id 就无限等 | 拒绝 | intermediate version 既不能表达 pending，也没有 finite failure；A/B 必须 atomic cutover |
| restart journal 保存 draft/payload 方便自动恢复 | 拒绝 | 扩大敏感数据副本和错误关联；使用 content-free cursor history |
| 先实现无人使用的 `runCancellable()` | 拒绝 | 没有 owner settlement proof，unused abstraction 不能证明 cancellation |
| create backend 为 late result 自动 bind window | 拒绝 | main 不知道 renderer intent 是否仍 current；stale success 会抢 active session |
| dismiss 删除/排除 operation identity | 拒绝 | 会绕过 retry-before-reconcile 和 fingerprint duplicate guard |
| 为当前不存在的 no-queue agent 新增 accepted-start API | 拒绝 | deepchat/acp 都使用已有 durable queue；零 consumer abstraction 只扩大状态机 |
| renderer 从 custom Error 的 code/operationId/state 分支 | 拒绝 | Electron invoke rejection 只可靠保留 message；domain outcome 必须是 Zod route output |

## Open Questions

无。实现参数、兼容顺序和 restart disposition 已在本 SDD 中确定。
