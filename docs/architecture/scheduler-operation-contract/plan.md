# Scheduler Operation Contract Implementation Plan

## 实施原则

本计划不做 big-bang Scheduler rewrite。按“先修 timing primitive，再迁安全 consumer，最后给 create
mutation 建 operation identity”推进。每个 sub-slice 独立 branch/PR、独立 develop/verify，前一片通过后
后一片才开始。

```text
SCH-001 docs
   |
   v
SCH-002A OperationRunner core
   |
   v
SCH-002B safe consumer migration
   |
   v
SCH-003A session create operation backend
   |
   v
SCH-003B renderer reconciliation + legacy cleanup
```

## 依赖与冲突安排

| 依赖/并行工作 | 安排 |
| --- | --- |
| `SES-002` 修改 `SessionService` / session resolution | `SCH-002A` 可并行；`SCH-002B` 的 session slice 必须基于已合入 `SES-002`，不能双边各自改同一语义 |
| `SES-003` 修改 route/session renderer | `SCH-003B` 在其后 rebase，复用四态字段；不复制 compatibility adapter |
| `CHAT-001/002` 决定 enqueue/generation owner | SCH 只移除 false mutation deadline、保留 cancel request semantics；generation handle 的增删由 `CHAT-*` 决定 |
| `PRM-*` / fatal work | 无 contract 依赖；如共同修改 route root，只按 merge 顺序 rebase，不合并目标 |

推荐 merge 顺序：`SES-002` → `SCH-002A` → `SCH-002B` → `SES-003` → `SCH-003A` →
`SCH-003B`。若 `SES-003` 尚未开始，`SCH-003A` 可先做 backend，但 renderer slice 仍需在最终 session route
schema 上验证。

## Slice SCH-002A：OperationRunner core

### 目标

只改 timing primitive 和 focused tests，不动 domain behavior。建立可证明的 runner contract，并保留一个
最小 compatibility adapter 让 consumer migration 能分 PR 完成。

### 影响文件

- `src/main/routes/scheduler.ts`：重命名/收窄为 `operationRunner.ts`，实现新 API。
- `src/main/routes/index.ts`：composition root 改用 `createNodeOperationRunner()`。
- `test/main/routes/scheduler.test.ts`：迁移为 capability contract tests。
- architecture guard/baseline（仅当 rename 触发 tracked path）。

### 实现步骤

1. 定义 typed errors：
   - `ObservationDeadlineError`：只说明 observer deadline；
   - `TimeoutError`：仅供 cooperative cancellable attempt abort 后 settle；
   - `AbortError`：external abort 且 cancellable attempt settle；
   - 普通 owner error 保留 `cause`，不靠 message 分类。
2. `observeIdempotent()`：
   - listener/timer 先于 task factory；
   - late resolve/reject 都有 drain handler；
   - deadline/abort 后不会执行任何 callback/retry。
3. `runCancellable()`：
   - runner 创建内部 controller；
   - external signal/deadline 只发一次 abort；
   - await task settlement 后再映射 timeout/abort；
   - task 在 abort 后 fulfilled 时也不得把 value 返回 caller。
4. `retryIdempotent()`：
   - 单 while loop，attempt 必须 settle 后才 backoff；
   - `shouldRetry` 默认由 caller 显式传入；
   - overall deadline/abort 关闭 loop；running attempt late settle 后不得启动下一轮；
   - backoff 使用 runner `sleep()` 并响应 loop closure。
5. 暂保留 legacy `timeout()` adapter，但加清晰 deprecated 注释；不改其语义，不让新代码使用。
6. 不引入 `p-retry`，不新增 queue/registry。

### Focused test matrix

| Case | 断言 |
| --- | --- |
| task factory sync throw | timer/listener cleanup；原 error 返回 |
| signal pre-aborted | task factory 不调用 |
| idempotent observation deadline | caller 得 `ObservationDeadlineError`；late resolve drained |
| late reject after observation deadline | 无 unhandled rejection；无 retry |
| cancellable deadline | task 收到 aborted signal；task settle 前 runner 不 settle |
| cancellable task resolves after abort | caller 仍得 `TimeoutError`，不返回 stale value |
| external abort | settle 后 `AbortError`；deadline timer 清理 |
| immediate transient reject then success | 顺序两次，结果 success |
| first attempt deferred | second attempt 调用次数为 0，直到 first reject |
| deadline while attempt deferred | caller 结束；first late reject 后 second 仍为 0 |
| deadline during backoff | 下一 attempt 永不启动 |
| retry classifier false | 只调用一次，原 error 返回 |
| max attempts/backoff | 尝试次数和 delay 序列准确，`maxConcurrentAttempts=1` |

### 自动验证

```bash
pnpm exec vitest run test/main/routes/operationRunner.test.ts
pnpm run typecheck:node
pnpm run format:check
pnpm run lint:architecture
pnpm run lint
```

### 影响与收益

- 收益：以后看到 `TimeoutError` 可以知道 cooperative attempt 已 settle；retry overlap 有 unit proof。
- 影响：core API rename 会触及 fake runner type，但不改变 production route behavior。
- 风险：假 timer/abort listener 泄漏；用 listener count、late rejection 和 fake timer test 阻断。
- 回滚：单独 revert SCH-002A；legacy adapter 仍支持旧 consumer。

## Slice SCH-002B：安全 consumer 迁移

### 目标

把能独立判断的 read/sync/probe/chat wrapper 从 legacy timeout 迁出，只留下 `sessions.create` 一个
allowlisted legacy consumer，交给 SCH-003。

### 影响文件

- `src/main/routes/sessions/sessionService.ts`
- `src/main/routes/chat/chatService.ts`
- `src/main/routes/providers/providerService.ts`
- `src/main/routes/hotPathPorts.ts`（只在 task factory/signal type 真需要时改）
- 对应 route service tests、dispatcher integration tests
- `scripts/architecture-guard.mjs` 或 focused static test：冻结 legacy `timeout(` consumer allowlist

### Session migration

1. 基于 `SES-002` 的 typed availability result 工作，不回退到 null/error-string 分类。
2. `restoreSession()` 使用 `retryIdempotent`：
   - overall deadline 5 秒；
   - immediate typed `transient_error` rejection 可在 25ms 后 retry；
   - attempt 未 settle、missing、unavailable、validation error、deadline 均不 retry；
   - attempt late settle 后只 drain，不写 binding。
3. `listMessagesPage/listSessions/getActive` 使用 `observeIdempotent`；list 不做 per-row retry。
4. `activate/deactivate` 删除 timeout wrapper，直接调用现有 owner；不增加 retry。
5. `createSession` 暂时保留 legacy adapter，static allowlist 精确到这一处。

### Provider migration

1. `listModels()` 直接调用同步 catalog getter；保留原 output shape。
2. `testConnection()` 删除 route-level 5 秒 `Promise.race`，等待 provider owner 的真实 check/model timeout。
3. 不自动 retry provider probe；连续点击治理若有真实问题另立 owner task，不在 Scheduler 猜 cooldown。
4. test 覆盖 deferred provider check：5 秒时 route 不产生 false `TimeoutError`；最终 owner result 原样返回。

### Chat migration

1. session/agent/message lookup 使用 `observeIdempotent`；route controller abort 后不得继续进入下一 mutation。
2. `sendMessage/steerActiveTurn/respondToolInteraction` 不再套 observation deadline；等待 domain owner 返回
   acceptance/result。
3. send 的 30 分钟 constant 和“generation timeout”假语义删除；不在本片决定 active controller 最终名称。
4. `stopStream` 保留两项 cleanup 都尝试的 `Promise.allSettled`，但不再用 5 秒 race 宣称 cleanup 已结束。
5. `cancelGeneration()` 仍只表示 request accepted；现有 AgentRuntime exactly-once settlement tests 必须通过。

### Legacy allowlist

SCH-002B 结束后必须满足：

```text
legacy OperationRunner.timeout consumer count = 1
allowed path = SessionService.createSession only
```

guard 只冻结生产 consumer，不阻止 test fixture import compatibility adapter。SCH-003B 删除最后 consumer
和 adapter。

### Focused test matrix

| Consumer | Failure/late case |
| --- | --- |
| restore immediate transient | attempt 1 settle reject，25ms 后 attempt 2；最大并发 1 |
| restore deferred past deadline | caller deadline；late settle；attempt 2 永不启动 |
| restore missing/unavailable | 不 retry，不清错误 binding |
| list/getActive deadline | late read 不更新 route result；binding 遵守 `SES-*` |
| activate/deactivate | effect/event exactly once；无 runner 调用 |
| listModels | 两个 sync getter exactly once；无 timer/runner |
| provider check >5s | 不在 5 秒返回 false failure；最终 result 返回 |
| chat stop during preflight | mutation 不启动；cancel request/permission cleanup 各一次 |
| chat send acceptance | 无 30min runner；pending input 不重复 |
| stop cleanup one side rejects | 两边都执行；request result contract 不变 |
| runtime cancellation | single `user_stop` hook；stale run 不覆盖 newer run |

### 自动验证

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

full suite 与 repository baseline 对比；不得把历史失败计入本片回归。

### 影响与收益

| 维度 | 影响 | 收益 |
| --- | --- | --- |
| 正确性 | restore timeout 不再自动起第二个 overlapping read | 消除同一 retry loop 的并发 attempt |
| UX | provider check 可能等待 owner 的真实 timeout，而不是 5 秒假失败 | 不再“界面失败但 provider 仍扣费/运行” |
| 性能 | 删除 sync getter 的 timer/race；差异很小 | 更少无意义 Promise/timer，主要收益是语义清晰 |
| Chat | 删除 mutation 外层 deadline；pathological owner hang 不再被假 timeout 遮住 | 不会把仍在运行的 mutation说成失败；真实 hang 会暴露给 owner |
| 兼容 | session create 暂留旧 adapter | PR 可独立合入，create 行为由下一片处理 |

### 回滚

- 可整体 revert SCH-002B，SCH-002A runner core 仍可保留。
- 不做 schema migration；回滚无数据转换。
- 若某 consumer manual smoke 发现 owner 无内部 timeout，单独回滚该 consumer，不恢复 automatic retry。

## Slice SCH-003A：Session create operation backend

### 目标

让慢 create 返回可查询的 `pending`，让 late success/cleanup uncertainty 有 operation truth；本片只做
main/shared contract 和 backend，不改最终 UI。

### 影响文件

- `src/shared/contracts/routes/sessions.routes.ts`
- `src/shared/types/agent-interface.d.ts`（只放 shared operation DTO，避免 main type 泄漏）
- `src/main/routes/sessions/sessionService.ts`
- `src/main/routes/index.ts`
- `src/main/presenter/agentSessionPresenter/index.ts`
- `src/main/presenter/agentSessionPresenter/sessionManager.ts`
- `src/main/presenter/sqlitePresenter/schemaCatalog.ts`
- 新 domain-specific table，例如
  `src/main/presenter/sqlitePresenter/tables/sessionCreateOperations.ts`
- focused table/service/dispatcher tests

### 数据与 owner

```text
renderer operationId
  -> SessionService (single-flight + observation deadline)
      -> SessionCreateOperationsTable (durable identity/stage)
      -> AgentSessionPresenter (actual mutation/compensation)
      -> NewSessionManager/new_sessions (authoritative session record)
```

- `SessionService` 只拥有 operation orchestration，不直接执行 presenter internals。
- `AgentSessionPresenter` 继续拥有 create/cleanup steps，但要返回可观察的 compensation outcome。
- journal 只保存 content-free identity/stage/error code；session data 仍由现有 tables 拥有。

### 实现步骤

1. Additive route input/output schema：optional `operationId` + operation envelope。
2. 增加只读 `sessions.getCreateOperation`，输入 operation id，输出相同 envelope。
3. operation 开始前：
   - validate input；
   - canonicalize + SHA-256 fingerprint；
   - 预分配 session id；
   - insert journal `accepted/pending`；
   - 建 per-operation single-flight Promise。
4. 按 stage 执行 create，并在每个 durable boundary 更新 journal：record、runtime、initial input acceptance、
   completion。
5. 观察 deadline 到达：route 返回 `pending`，不 abort operation，不 throw timeout。
6. duplicate same id/same fingerprint：返回/等待 existing state；different fingerprint：typed conflict。
7. owner error：收集 ACP clear、runtime destroy、record delete 等 compensation result：
   - 全部 settle 成功 → `failed`；
   - 任一 reject/无法证明 → `unknown`。
8. process startup/reconcile：
   - persisted succeeded + readable session → reconstruct succeeded；
   - incomplete stage → unknown；
   - 不持久化 payload，不自动 replay。
9. terminal operation row 跟随 session deletion清理；failed/unknown row 保留供 diagnostics/reconcile，本片不
   增加后台 TTL worker。

### 为什么不加 TTL worker

每次 create 最多一行，规模与 session 数同阶；先在 session delete 时清成功行。failed/unknown 预计低频，
没有测量证明需要后台清理器。若 DB fixture 以后证明增长显著，再按数据加 bounded maintenance，而不是本片
预建 timer。

### Focused test matrix

| Case | 断言 |
| --- | --- |
| fast create | succeeded + session；stage completed |
| deferred before record | deadline 返回 pending；late success 可 query |
| deferred after record/runtime | pending；只有一个 session/runtime attempt |
| duplicate same id while pending | 共用 Promise；create count 1 |
| duplicate same id after success | reconstruct same session；不执行 create |
| same id/different input | conflict；旧 state 不变 |
| init failure + cleanup success | terminal failed；record 不残留 |
| init failure + one cleanup reject | unknown；不自动 retry |
| restart with succeeded journal | route reconstruct session |
| restart with incomplete journal | unknown；不 replay input |
| late resolve after renderer stops waiting | journal success/event exactly once |
| raw data hygiene | journal 除 fingerprint 外不含 prompt/file path/payload；log 不含 fingerprint/raw payload |

### 自动验证

```bash
pnpm exec vitest run \
  test/main/presenter/sqlitePresenter/sessionCreateOperations.test.ts \
  test/main/routes/sessionService.test.ts \
  test/main/routes/dispatcher.test.ts \
  test/main/presenter/agentSessionPresenter/agentSessionPresenter.test.ts \
  test/main/presenter/agentSessionPresenter/integration.test.ts
pnpm run typecheck:node
pnpm run format:check
pnpm run lint
```

### 影响与收益

- 正确性：create caller 和 main 对同一个 operation 有共同 identity，不再猜 late result。
- 数据：新增 additive table；不复制 raw payload；rollback 留空表不影响旧版本读取。
- UX：backend 已能表达 pending/unknown，但旧 client 在 SCH-003B 前仍走 compatibility wait。
- 风险：create stages 跨多个现有 owner；focused deferred/compensation tests 是 merge gate。
- 回滚：revert backend/runtime code；additive table 保留无害，不做 destructive down migration。

## Slice SCH-003B：Renderer reconciliation 与 legacy cleanup

### 目标

让新 client 真正使用 operation contract，pending/unknown 对用户可理解；然后删除最后 legacy timeout 和
compatibility allowlist。

### 影响文件

- `src/renderer/api/SessionClient.ts`
- `src/renderer/src/stores/ui/session.ts`
- `src/renderer/src/pages/NewThreadPage.vue`（只在状态展示需要时）
- `src/renderer/src/i18n/*/chat.json` 或归属 locale 文件
- renderer API/store/component tests
- `src/main/routes/operationRunner.ts`：删除 legacy `timeout()` adapter
- legacy static allowlist/architecture baseline

### 实现步骤

1. `SessionClient.create()` 生成/接收 operation id，并解析 operation envelope。
2. session store 建一个 current create intent token；draft data 保持在现有 draft owner，不复制到 operation
   store。
3. pending 时按 bounded polling/reconciliation：
   - 只在 create page/current intent 仍活跃时轮询；
   - 页面离开时停止观察，不取消 main operation；
   - 不因一次 query error 自动创建新 operation。
4. succeeded：
   - current intent → upsert、activate/navigate、onboarding；
   - stale intent → refresh list only。
5. failed：展示稳定 error mapping，保留 draft，用户显式重试生成新 operation id。
6. unknown：保留 draft，提供 check again/refresh list；禁止 automatic create retry。
7. i18n 增加 pending/unknown/failure keys；不显示内部 error/message/fingerprint。
8. 添加 manual smoke 后，删除 legacy `timeout()` adapter、allowlist 和旧 `SESSION_OPERATION_TIMEOUT_MS` create
   使用。

### Polling 说明

不新建常驻 polling service。只复用当前 create intent 生命周期中的局部 timer；route success/failure/页面离开
都会 cleanup。poll 间隔属于 UX 参数，implementation 先使用现有 settings page polling helper 同类的简单
fixed interval；不引入 exponential-backoff dependency。正确性不依赖轮询间隔，手动 check route 始终可用。

### Renderer test matrix

| Case | 断言 |
| --- | --- |
| fast success | 与现有 create/navigation/onboarding 行为一致 |
| pending then success/current | draft 不清空直到 success；只导航一次 |
| pending then success/stale | session list 更新，不抢当前 route/active session |
| pending then page leave | polling cleanup；main operation 不取消 |
| query transient error | 显示可重查状态；不创建新 id |
| terminal failed | draft 保留；explicit retry 使用新 id |
| unknown | 无 false failure/auto retry；check again 可用 |
| duplicate event + reconciliation | upsert/activate/onboarding idempotent |
| legacy no-id caller | compatibility path 仍返回 non-null session，直到 allowlist 删除 gate完成 |

### Manual smoke（自动化不能完全替代）

1. 正常创建 DeepChat session，确认首条消息只出现一次、session 激活、onboarding 正常。
2. 正常创建 ACP session，确认 workdir/runtime 准备与首条输入正常。
3. 测试 fixture 人为延迟 create 超过 observation deadline：UI 显示 pending，不显示失败、不丢 draft；
   late success 后当前 intent 导航。
4. pending 后立刻导航到已有 session：late success 只刷新列表，不抢页面。
5. 人为让 cleanup 一项失败：显示 unknown，无自动 duplicate session。
6. pending 期间重启 app：incomplete journal 保守显示 unknown；已有成功 session 仍能从列表打开。
7. 检查 production log/diagnostics 不出现 raw prompt/file path/fingerprint；DB journal 除 fingerprint 外
   不复制 raw payload。

### 自动验证

```bash
pnpm exec vitest run \
  test/renderer/api/clients.test.ts \
  test/renderer/stores/sessionStore.test.ts \
  test/renderer/components/NewThreadPage.test.ts \
  test/main/routes/operationRunner.test.ts \
  test/main/routes/sessionService.test.ts \
  test/main/routes/dispatcher.test.ts
pnpm run typecheck
pnpm run format
pnpm run i18n
pnpm run lint
pnpm test
```

### 影响与收益

| 维度 | 影响 | 收益 |
| --- | --- | --- |
| 用户认知 | 多一个 pending/unknown 状态 | 不再看到“失败”后又冒出 session |
| 草稿 | draft cleanup 时机后移到 confirmed success | 慢创建/unknown 不丢输入 |
| 导航 | late success 要检查 intent token | 不抢用户当前页面/active session |
| 测试 | 增加 deferred、restart、stale intent matrix | 大改后稳定性有状态机证据，不靠 happy path |
| 数据 | journal 与 session 同阶增长 | operation 可查、duplicate 可抑制 |

### 回滚

- 先回滚 SCH-003B renderer/client，backend compatibility path 仍可服务旧 caller。
- 如需再回滚 SCH-003A，保留 additive journal table；旧版本忽略它。
- 不回滚/删除用户已经创建的 session；operation row 不是 session source of truth。

## 全链路验证与稳定性门槛

每个 slice 都必须由独立 verify agent 审查。blocking finding 回到原 develop branch 修复，再重新验证；同一
agent 不同时承担 develop 和 final verify。

### 自动 gate

- focused unit/integration tests 全绿；
- `pnpm run typecheck`；
- `pnpm run format` 后 `pnpm run format:check`；
- `pnpm run i18n`；
- `pnpm run lint`；
- full `pnpm test` 与已记录 baseline 对比；
- architecture guard 证明 legacy timeout consumer 按 1 → 0 收敛。

### Review 必查项

1. 有没有把 deadline error 当 operation failure？
2. 有没有在上一 attempt 未 settle 时启动 retry？
3. 有没有只因 task 接收 signal 就宣称 physically cancellable？
4. 有没有恢复 cancelGeneration 同步 terminal settlement？
5. create cleanup 不确定时有没有错误写 failed？
6. duplicate operation id 是否 single-flight？
7. renderer stale intent 是否可能抢导航？
8. journal/log 是否泄露 raw payload？
9. compatibility adapter 是否有精确 allowlist 和删除条件？
10. sync DB work 是否被错误描述为 Promise timeout 可中断？

### PR body 必须记录

- scope 与明确 non-goals；
- code-truth before/after；
- operation state/attempt timeline；
- focused/full test counts；
- manual smoke 完成项与未覆盖平台；
- compatibility/rollback；
- 对用户的可见影响；
- 如果 automation 缺失，给出具体手工步骤和风险，不写“应该没问题”。

## 完成判定

`A-04` 只有同时满足以下条件才关闭：

1. legacy `Scheduler.timeout(task: Promise)` 生产 consumer 为 0；
2. retry overlap tests 证明最大并发 attempt 为 1；
3. `sessions.create` slow path 返回 pending/unknown envelope 并可 reconcile；
4. cancelGeneration exactly-once settlement 回归通过；
5. renderer stale/unknown/draft tests 与 manual smoke 通过；
6. full suite 没有新增失败。

仅完成 `SCH-002A` core 或仅把 timeout 数值调大，都不能关闭 finding。
