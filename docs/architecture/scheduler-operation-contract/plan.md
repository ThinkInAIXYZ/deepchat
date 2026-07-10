# Scheduler Operation Contract Implementation Plan

## 先说结论

不能把所有 `Promise.race` 一次删掉，也不能先发布只有 backend 认识 operation id 的半成品。安全顺序是：

1. 先做只服务真实 consumer 的 timing primitive；
2. 再迁移已经能证明安全的 session/chat/catalog 路径；
3. provider probe 暂时保留 5 秒遗留观察 deadline，并交给 provider owner 补真实 cancellation；
4. 先给 initial input 建立“已接收、不是整轮生成完成”的边界；
5. session create backend 与 renderer 一起原子切换，任何 production caller 都不能落入无 id 的中间态；
6. 最后清掉 legacy timeout，并用 restart、stale intent、cleanup uncertainty 测试收口。

这不是按代码文件排顺序，而是按“先获得什么证据，下一步才有资格做什么”排顺序。

## 交付图

```text
SCH-001 decision docs
        |
        v
SCH-002A OperationRunner core --------+
        |                              |
        v                              v
SES-002 -> SCH-002B safe migration   PRV-CAN-001 provider owner cancellation
                  |                    |
                  +---------+----------+
                            |
                            v
                    legacy timeout = create only

SCH-003P initial-input acceptance
        |
        +-------------------- SES-003
        |                       |
        v                       v
SCH-003A backend commit -> SCH-003B renderer/integration commit
             \____________ atomic production PR ____________/
                              |
                              v
                    legacy timeout consumer = 0
```

`SCH-003A` 与 `SCH-003B` 是为了 review 清楚而拆的 development slices，不是两个可分别发布的版本。
`SCH-003B depends on SCH-003A + SES-003`；最终只能以一个 atomic production PR merge。

## 依赖、冲突与 merge 顺序

| 依赖/并行工作 | 处理方式 | 不满足时怎么办 |
| --- | --- | --- |
| `SES-002` session 四态与 binding 语义 | `SCH-002B` rebase 到它之后；restore/getActive 只消费 typed result | 不复制一套 null/error-string adapter，session migration 暂停 |
| `SES-003` route/renderer compatibility | `SCH-003B` 显式依赖并复用它的 schema/client 结构 | 003A 可写成未合入 commit，但 003 atomic PR 不 merge |
| initial-input acceptance | `SCH-003P` 必须在 journal stage 前完成 | 无 accepted handle 就不能写 `input_accepted/completed`，003 cutover 阻塞 |
| provider cancellation | `PRV-CAN-001` 与 003 可并行，owner 能力完成后再删 route 5 秒 wrapper | SCH 不假称 owner timeout，保留精确 legacy exception |
| `CHAT-001/002` generation owner | SCH 只处理 route observation 与 acceptance，不发明 generation settlement | cancel request semantics 保持不变 |

推荐 production merge 顺序：

```text
SES-002
  -> SCH-002A
  -> SCH-002B
  -> PRV-CAN-001 (can be parallel with the next prerequisites)
  -> SCH-003P
  -> SES-003
  -> SCH-003A + SCH-003B atomic PR
```

如果 `PRV-CAN-001` 较慢，003 atomic PR 可以先完成；但 A-04 仍保持 open，architecture guard 中只剩
`providers.testConnection` 一项遗留 consumer，直到 provider owner slice 合入。

## 全局实施规则

### 数值先验证

在任何 task/timer 启动前验证：

- milliseconds：有限整数，`0..2_147_483_647`；
- `maxAttempts`：有限正整数；当前 session contract 固定为 `2`；
- `backoff`：有限非负，计算后的 delay 仍须是合法 milliseconds；
- discovery `limit`：Zod 限制整数 `1..20`，默认 `10`；
- `NaN`、`Infinity`、负数、小数毫秒和溢出全部 typed reject，task 调用次数必须为 `0`。

这些值不从未验证的 IPC input 直接进入 runner。`2 attempts/25ms` 是 SES contract，不允许 caller 自由调参。

### DTO 只有一个 owner

session operation 的 input/output/status schema 只写在
`src/shared/contracts/routes/sessions.routes.ts`，TypeScript 类型由 Zod/schema 或 route inference 得到。
`src/shared/types/agent-interface.d.ts` 不增加 operation DTO；它不拥有 sessions route contract。

### 每个 slice 的验证责任

- develop 与 final verify 使用不同 agent；
- blocking finding 回原 branch 修复，再从头 verify；
- focused test 证明本 slice 的 contract，full suite 证明没有外围回归；
- PR body 记录 before/after truth、影响、收益、manual gap、回滚；
- 不用“调用了 abort”“等了更久”“测试 happy path 通过”替代 physical settlement 证据。

## Slice SCH-002A：OperationRunner core

### 目的

把当前 `Scheduler` 收窄成真实能力：observation deadline、abortable sleep、settled-only retry。当前没有真实
signal owner consumer，所以本片不实现 `runCancellable()`。

### 影响文件

- `src/main/routes/scheduler.ts`：迁移/重命名为 `operationRunner.ts`；
- `src/main/routes/index.ts`：composition root；
- `test/main/routes/operationRunner.test.ts`；
- 必要的 architecture guard/baseline。

### 实施步骤

1. 定义 `ObservationDeadlineError`，名字明确表示 caller 停止观察，不表示 operation 失败。
2. 实现 `observeIdempotent()`：先装 listener/timer，再调用 task factory；late resolve/reject 全部 drain。
3. 实现 `retryIdempotent()`：
   - 只有已 settle rejection 且 `shouldRetry` 为 true 才 backoff；
   - running attempt 或 backoff 中 overall deadline 到达后，不再启动新 attempt；
   - `maxConcurrentAttempts` 永远为 1；
   - classifier 不按 error message substring。
4. 实现 abortable `sleep()`，并按全局规则验证所有数值。
5. 暂留 deprecated legacy `timeout(task: Promise)` adapter，供 consumer 分片迁移；新代码禁止使用。
6. 不导出、不测试 `runCancellable()`。future owner-specific slice 必须同时提交真实 signal propagation 与
   settlement proof，不能先放一个 unused port method。

### Focused tests

| Case | 必须证明 |
| --- | --- |
| task factory sync throw | 原 error 返回，timer/listener cleanup |
| pre-aborted signal | task factory 不调用 |
| observation deadline | 返回 `ObservationDeadlineError`，late result 不写 caller state |
| late rejection | 无 unhandled rejection，不触发 retry |
| first attempt deferred | first settle 前 second count = 0 |
| deferred 超过 overall deadline | caller 结束观察；late settle 后 second 仍为 0 |
| deadline during backoff | 下一 attempt 永不启动 |
| classifier false | 原 error 返回，只调用一次 |
| immediate transient then success | 串行两次，结果 success，最大并发 1 |
| invalid number matrix | task/timer 都不启动，typed validation error |

### 影响、收益、风险

| 维度 | 影响 | 收益/控制 |
| --- | --- | --- |
| API | rename 会触及 composition/fake types | 名字不再暗示 queue/Cron owner |
| 行为 | production consumer 暂由 legacy adapter 保持 | core PR 可独立验证，不混入 domain 变化 |
| 性能 | 少量 timer/listener 管理 | 主要收益是消除 overlap，不宣称吞吐提升 |
| 风险 | late Promise、fake timer cleanup 容易漏 | deferred/late rejection/listener tests 阻断 |

### 验证与回滚

```bash
pnpm exec vitest run test/main/routes/operationRunner.test.ts
pnpm run typecheck:node
pnpm run format:check
pnpm run lint:architecture
pnpm run lint
```

本片可单独 revert；legacy adapter 仍保留旧 production 行为。

## Slice SCH-002B：安全 consumer 迁移

### 目的

只迁已有证据支持的 read/sync/chat wrapper。provider probe 不在本片冒险移除 route 5 秒 wrapper。

### Session：restore 与 getActive 必须同样保守

`SCH-002B` 必须基于 `SES-002` typed availability contract：

- `restoreSession` 与 `getActiveSession` 都保留最多 `2 attempts`、间隔 `25ms`；
- 只有前一 attempt 已 settle 为 typed `transient_error` 才启动第二次；
- `missing`、`unavailable`、validation error、observation deadline 均不 retry；
- attempt、backoff、deadline、late settlement 期间都不清 binding；
- `getActive` 只有 SES-002 权威 `missing` terminal result 才能 unbind；
- `listMessagesPage/listSessions` 使用 idempotent observation，不做 per-row retry；
- `activate/deactivate` 已同步完成副作用，直接调用，删除无效 timeout，不 retry。

### Provider：只删已证明无效的 sync wrapper

- `listModels()` 两个 getter 在 `Promise.resolve` 前同步执行，改为直接调用；
- `testConnection()` 暂时保持现状并进入精确 allowlist，绝不 automatic retry；
- 文档和 test 固定真实语义：
  - 有 `modelId`：provider completion 与 60 秒 `null` race；60 秒只是 observation，request 可能继续；
  - 无 `modelId`：直接 `provider.check()`，presenter 没有统一 deadline/cancellation；
  - 外层 route 5 秒同样只停止等待。
- 不能写“等待 provider 自有 timeout”，因为代码没有统一保证。

### Chat

- session/agent/message preflight read 用 `observeIdempotent`，route stop 后不再进入下一 mutation；
- `sendMessage/steerActiveTurn/respondToolInteraction` 删除 non-cancellable mutation 外层 deadline，等待现有 owner
  acceptance/result；
- 删除把 30 分钟常量描述为 generation timeout 的语义；
- `stopStream` 保持 both-cleanups-attempted；`cancelGeneration()` 仍只表示 request accepted；
- AgentRuntime exactly-once terminal settlement tests 必须保持通过。

### Legacy allowlist

本片结束时不是“一项”，而是以下两项：

```text
SessionService.createSession
ProviderService.testConnection
```

guard 精确到 method/path，任何新增 consumer 都 blocking。create 由 003 atomic cutover 删除；provider 由
`PRV-CAN-001` 删除。

### Focused tests

| Consumer | 必须证明 |
| --- | --- |
| restore transient | settle reject -> 25ms -> attempt 2，最大并发 1 |
| getActive transient | 同上；两次 attempt 全程 binding retained |
| restore/getActive deferred | deadline 后无 second attempt，binding retained |
| restore/getActive missing | 仅 SES-002 权威 missing 走对应 missing/unbind 行为 |
| unavailable/validation | 不 retry，不清 binding |
| list/page | late result drained，不做 per-row retry |
| activate/deactivate | effect/event exactly once，无 runner |
| listModels | getter exactly once，无 timer/runner |
| provider model/no-model | 固定当前两类 timeout truth，不声称 cancellation、不 retry |
| chat stop during preflight | mutation 不启动；cleanup request 各一次 |
| runtime cancellation | single terminal hook，stale run 不覆盖 newer run |

### 影响、收益、风险

| 维度 | 影响 | 收益/控制 |
| --- | --- | --- |
| Session | transient read 仍可能做第二次 | 不 overlap；短暂读故障恢复策略保留 |
| Binding | transient/deadline 不再被误作 missing | 避免 active session 被错误解绑 |
| Provider catalog | 删除无意义 Promise/timer | 路径更直接，性能收益小但确定 |
| Provider probe | 暂留 false observation deadline | 不把无界 no-model probe 直接暴露成永久 hang；风险被显式登记 |
| Chat | 真 owner hang 不再被假 deadline 遮住 | 不再向 UI 报“失败”但 mutation 继续 |

### 验证与回滚

```bash
pnpm exec vitest run \
  test/main/routes/operationRunner.test.ts \
  test/main/routes/sessionService.test.ts \
  test/main/routes/providerService.test.ts \
  test/main/routes/chatService.test.ts \
  test/main/routes/dispatcher.test.ts \
  test/main/presenter/agentRuntimePresenter/agentRuntimePresenter.test.ts
pnpm run typecheck
pnpm run format:check
pnpm run i18n
pnpm run lint
pnpm test
```

可按 session/chat/catalog consumer 小 commit revert；provider probe 本片本来不改行为。

## Dependent slice PRV-CAN-001：Provider owner cancellation

### 为什么另立 slice

route 无法单方面取消 provider SDK request。只有 provider owner 能决定哪些 SDK 接受 signal、哪些 adapter 需要
显式 teardown、什么状态才算 settle。把这件事塞进 generic runner 会再次制造假 cancellation。

### 工作内容

1. 逐 provider 枚举 `check()`：local-only、network、SDK/model completion；记录各自 signal/timeout 能力。
2. 让 `ProviderExecutionPort.testConnection` 和 `LLMProviderPresenter.check` 接收 owner-owned cancellation input。
3. 有 `modelId` 的 60 秒 observation race 改为真实 owner deadline：发送 cancel，并等 physical attempt settle。
4. 无 `modelId` 的 provider-specific check 要么传播 signal 并有 finite deadline，要么明确返回
   unsupported，不能无界。
5. 所有 adapter 完成后才删除 route 5 秒 legacy wrapper；仍不 automatic retry，因为 probe 可能消耗 quota。
6. 如果此时出现真实 `runCancellable` consumer，再在这个 slice 提出最窄 API；settlement tests 与 consumer 同 PR。

### 收益与 gate

- UI timeout 后不再有 provider request 在后台继续；
- model/no-model 都有 owner-level finite contract；
- architecture guard 从两项 legacy consumer 降为 create 一项，或在 003 已合入时降为零。

## Slice SCH-003P：Initial-input acceptance seam

### 目的

让 create journal 能诚实区分“首条输入已被 owner 接收”与“整轮 generation 已结束”。

### 代码真相

- DeepChat `queuePendingInput()` 会创建 SQLite pending-input record，然后后台启动/排空 generation；await 它只等
  queue acceptance，不等 generation，正好是需要的 seam。
- fallback `processMessage()` 是完整 processing Promise。直接 await 会让 create 等整轮；fire-and-forget 又没有
  accepted proof。

### 实施步骤

1. 在 agent/session owner 定义窄返回：`not_required` 或 content-free `acceptedHandle`。
2. 无首条输入返回 `not_required`。
3. DeepChat path await `queuePendingInput()` 的 durable record，再返回 accepted；generation 保持后台运行。
4. fallback owner 提供 start/accepted API：只有 owner 已接管后 resolve，不能把 Promise 创建当 acceptance。
5. 静态 inventory 证明每个 production agent path 都命中 queue 或 accepted-start；否则 003 merge gate
   失败。
6. 不改 generation terminal settlement、不改 cancelGeneration、不把 title generation 放进 acceptance。

### Focused tests

| Case | 必须证明 |
| --- | --- |
| no initial input | `not_required`，不启动 message |
| DeepChat queue success | record durable 后 resolve，generation 可仍 deferred |
| queue reject | acceptance reject，不能写 accepted stage |
| fallback start | accepted handle 在 owner 接管后、generation settle 前 resolve |
| fallback unsupported | typed failure，003 cutover gate失败，不伪造 accepted |
| duplicate create intent | 同 operation 不重复 enqueue |

### 影响与收益

- create 不会为了“准确”而等待整轮 LLM generation；
- journal completed 能代表 session/runtime/input 已被接收，而不是仅仅调用了一个 Promise；
- fallback 的旧 fire-and-forget 模糊语义被隔离在 owner，不扩散到 operation framework。

## Atomic delivery SCH-003A + SCH-003B

### 为什么必须原子交付

旧 output 不能表达 `pending`，旧 caller 又没有 operation id。若先 merge backend：

- 无限 compatibility wait 会把 hang 暴露给用户；
- 继续旧 5 秒 timeout 会保留 unknown-outcome；
- 提前返回 null 会破坏旧 renderer。

三种都不稳定。所以 003A 只作为 backend review commit；003B 集成 renderer 和全部 caller，二者通过后才创建
一个 production PR。无 operation id 的 compatibility 是“副作用前立即 typed reject”，不是等待策略。

## Development slice SCH-003A：Session create operation backend

### 影响文件

- `src/shared/contracts/routes/sessions.routes.ts`：唯一 DTO/schema owner；
- `src/main/routes/sessions/sessionService.ts`、`src/main/routes/index.ts`；
- `src/main/presenter/agentSessionPresenter/*`；
- `src/main/presenter/sqlitePresenter/schemaCatalog.ts` 与 domain-specific table；
- focused table/service/dispatcher/presenter tests。

明确不改 `src/shared/types/agent-interface.d.ts` 来承载 operation DTO。

### 数据与 route

只新增 domain-specific `session_create_operations`。最小数据为 operation/session id、fingerprint、state、stage、
stable error code、dismissed/created/updated timestamps；不保存 prompt、files、title、agent/provider/model 或 payload
副本。

新增/修改 route：

- `sessions.create`：需要 operation id，返回 operation envelope；
- `sessions.getCreateOperation`：按已知 id reconcile；
- `sessions.listIncompleteCreateOperations`：`limit 1..20, default 10`，只返回 content-free identity；
- dismiss route：只写 `dismissedAt`，不删 session、不清 dedupe identity。

虽然 schema 可为 staged rollout 暂时 parse optional id，handler 必须在副作用前对 missing id 返回
`OperationIdRequiredError`。production caller guard 必须为零，后续可把 schema 收紧为 required。

### Backend 实施步骤

1. schema validation 后 canonicalize input、计算 DB-only fingerprint、预分配 session id。
2. 副作用前登记 operation；same id/same fingerprint single-flight；different fingerprint typed conflict。
3. 按 durable boundary 更新 `record_created`、`runtime_ready`、
   `input_not_required/input_accepted`、`completed`。
4. initial-input stage 只调用 `SCH-003P` seam；绝不 await whole generation。
5. 保留 `5_000ms` 作为 create 首次 observation deadline；到点返回 `pending`，不 abort、不写 failed。
6. owner failure 收集所有 compensation outcome：全部 settle success 才 `failed`，任一不确定为 `unknown`。
7. restart：succeeded + readable session 可重建；incomplete pending 转 unknown；不 replay payload。
8. discovery 只返回未 dismiss 的 pending/unknown，按 `updatedAt DESC, operationId ASC`，同时给 `truncated`。
9. succeeded row 随 session delete；failed/unknown 用 dismiss 隐藏但保留 dedupe evidence，不加 speculative TTL worker。

### Backend tests

| Case | 必须证明 |
| --- | --- |
| fast/no-input create | succeeded，stage completed |
| input queue deferred | 未 accepted 前不 completed；不等待 generation terminal |
| deferred record/runtime | deadline 返回 pending，late success 可 query |
| duplicate pending/succeeded | create/runtime/input count = 1 |
| same id/different input | conflict，旧 state 不变 |
| cleanup all success | failed，record 不残留 |
| one cleanup unknown | unknown，不自动 retry |
| restart incomplete | pending -> unknown，不 replay payload |
| missing operation id | typed finite error；所有 mutation count = 0 |
| invalid limit | Zod reject；DB query count = 0 |
| discovery | max 20、稳定排序、content-free、truncated 正确 |
| dismiss | current list 隐藏；identity 保留；session 不删除 |
| schema ownership | agent-interface 无 operation DTO duplicate |

### 003A 边界

- 独立 backend verifier 可以审核 DB truth、single-flight、compensation 和 data hygiene；
- commit 不得单独 merge/base deploy；
- rollback 以整个 003 atomic PR 为单位，不能承诺旧 renderer 能消费 003A output。

## Integration slice SCH-003B：Renderer、restart recovery 与 cutover

### 显式依赖

`SCH-003B depends on SCH-003A + SES-003 + SCH-003P`。它在集成 branch 上包含 003A backend commit，完成后
只提交一个 atomic production PR。

### Renderer 实施步骤

1. `SessionClient.create()` 每个新 intent 用 `crypto.randomUUID()` 生成 id；transport retry 复用，同一次用户
   explicit retry 才生成新 id。
2. store 保存 current intent token；draft 继续由原 draft owner 管理，不复制到 operation state/journal。
3. pending 只在 current create page 生命周期内 polling：每 `2_000ms` 一次，最多自动查询 `15` 次；之后停
   timer 并保留手工 Check。页面离开停止观察，不取消 main operation。
4. succeeded/current 才 upsert + activate/navigate + onboarding；succeeded/stale 只刷新 list。
5. failed/unknown 保留 draft，不自动 create retry；query transient error 也不换 operation id。
6. app startup 调 bounded discovery：
   - 只显示 operation 时间/状态，不展示内容；
   - 一条或多条都要求用户显式点 `Check`；
   - 不把 recovery item 关联当前 draft，不自动 activate/navigate；
   - dismiss 只隐藏 record。
7. i18n 增加 pending/unknown/discovery/dismiss/error copy，不暴露 internal error/fingerprint。
8. 同一 atomic PR 更新所有 production caller；guard 证明 missing operation id caller = 0。
9. 删除 create legacy timeout。若 `PRV-CAN-001` 已完成则删除整个 adapter；否则 adapter 只剩精确 provider
   项。

### UI 行为

```text
Current slow intent
+---------------- New Thread ----------------+
| Creating session...                        |
| Draft remains here while result is checked.|
+--------------------------------------------+

Restart recovery
+---------------- New Thread ----------------+
| Unconfirmed creations                      |
| 10:42  unknown                 [Check]      |
| 10:39  unknown                 [Check]      |
|                              [Dismiss]      |
+--------------------------------------------+
| Current draft is separate.                 |
+--------------------------------------------+
```

即使只有一条 restart record，也不能自动把当前 draft 接上去。这是 privacy 和 correctness 约束，不是 UI
偏好。

### Renderer/integration tests

| Case | 必须证明 |
| --- | --- |
| fast success | 原 create/navigation/onboarding 一致 |
| pending -> success/current | draft 到 success 前保留，只导航一次 |
| pending -> success/stale | 只刷新 list，不抢 route/active session |
| page leave | polling cleanup，main operation 不取消 |
| transient reconcile error | 同 id 可重查，不创建新 operation |
| failed/unknown | draft 保留，无 auto retry |
| restart one/many | 都需显式选择，不绑定当前 draft |
| discovery data | UI/API 不出现 prompt/file/title/provider/fingerprint |
| dismiss | 只隐藏 identity，不删 session |
| legacy missing id | typed finite error，mutation count 0 |
| duplicate event + reconcile | upsert/activate/onboarding idempotent |

### Manual smoke

1. DeepChat 正常 create：首条输入只入队一次、session 激活、generation 可继续。
2. ACP/fallback production path：accepted handle 在 generation completion 前返回；没有 seam 就阻止 merge。
3. 人为延迟 record/runtime/queue 超过 deadline：UI pending、不报失败、不丢 draft，late success 收敛。
4. pending 后切换已有 session：late success 不抢页面。
5. compensation 一项失败：unknown，无自动 duplicate create。
6. pending 时重启：content-free discovery 出现，必须手选；当前 draft 不关联。
7. 检查 log 和 journal：无 raw prompt/file/payload，log 无 fingerprint。

### 影响、收益、风险

| 维度 | 影响 | 收益/控制 |
| --- | --- | --- |
| 用户认知 | 新增 pending/unknown/recovery 状态 | 不再“先失败、后冒出 session” |
| Draft | cleanup 延后到 confirmed success | 慢请求/restart 不丢当前输入 |
| 导航 | late success 检查 intent token | 不抢当前页面 |
| 数据 | 每个 create intent 一条 content-free journal | dedupe/reconcile 有 durable truth |
| Privacy | recovery 不显示内容，journal 不复制 payload | restart 能找 id，但不扩大敏感数据副本 |
| Compatibility | backend/renderer 必须同 PR | 没有无限 wait 或旧 5 秒半成品窗口 |

### Atomic rollback

1. 以整个 003 PR 回滚 backend + renderer/client；不能只回滚 renderer 并声称 backend 兼容。
2. additive journal table 可保留，旧代码忽略；不做 destructive down migration。
3. 不删除已经创建的 session；operation row 不是 session source of truth。
4. 回滚前先停止新 create traffic（桌面版本即关闭/重启升级窗口），避免新旧 schema consumer 并存。

## 统一验证清单

### 自动 gate

```bash
pnpm run typecheck
pnpm run format
pnpm run format:check
pnpm run i18n
pnpm run lint
pnpm test
```

每个 slice 还要跑本节列出的 focused tests。full suite 与已记录 baseline 对比，新增失败必须为零。

### Review 必查

1. deadline 是否被误写成 operation failure？
2. 上一 attempt 未 settle 时是否可能启动 retry？
3. restore/getActive 是否都保留 `2 attempts/25ms`，且 transient/deadline 不清 binding？
4. 是否加入了没有真实 consumer 的 `runCancellable()`？
5. provider model 60 秒/no-model path 是否被误称为 owner timeout？
6. initial input accepted 是否误等整轮 generation，或在 fire-and-forget 时提前写 completed？
7. cleanup uncertainty 是否误写 failed？
8. restart recovery 是否复制/显示 payload，或自动绑定当前 draft？
9. 003A 是否被错误当成可独立 merge？003B 是否明确依赖 003A + SES-003？
10. missing operation id 是否在副作用前 finite reject？
11. DTO 是否只由 sessions route schema inference 拥有？
12. 所有 numeric input 是否 finite/nonnegative/bounded validation？

## 完成判定

`A-04` 只有同时满足以下条件才关闭：

1. legacy `Scheduler.timeout(task: Promise)` production consumer 为 `0`；
2. retry tests 证明 `maxConcurrentAttempts === 1`；
3. restore/getActive 的 typed transient `2 attempts/25ms` 与 binding retention 全部通过；
4. provider model/no-model 都有 owner-level finite cancellation/settlement，不能只剩 observation race；
5. session create slow path 返回 pending/unknown 并可 reconcile；
6. initial input accepted 不等待 generation terminal，也不提前伪造；
7. restart discovery content-free、bounded、explicit selection；
8. 003A/B atomic cutover 完成，missing id caller count = 0；
9. cancelGeneration exactly-once settlement 回归通过；
10. renderer stale/unknown/draft/manual smoke 与 full suite 无新增失败。

只完成 runner rename、只调大 timeout、只合 backend 或只做 UI，都不能关闭 finding。
