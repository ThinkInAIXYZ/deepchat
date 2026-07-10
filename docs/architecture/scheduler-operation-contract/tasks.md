# Scheduler Operation Contract Tasks

## SCH-001：Decision / SDD

- [x] 审计 route Scheduler timeout/retry/abort 的真实能力。
- [x] 枚举 Session/Chat/Provider production consumers 与 side effects。
- [x] 核验 Scheduler 历史目标、cancelGeneration request-only/exactly-once settlement 意图。
- [x] 定义 observation、retry、cancellation、settlement、unknown/reconciliation contract。
- [x] 关闭 verifier 对 getActive/restart/legacy/initial-input/provider truth 的 blocking findings。
- [x] 明确 operation DTO 只由 sessions route Zod/schema inference 拥有。
- [x] 明确 `SCH-003A/B` 为 atomic production cutover，`SCH-003B depends on SCH-003A + SES-003`。
- [x] 文档无 `[NEEDS CLARIFICATION]`。

## SCH-002A：OperationRunner core

- [ ] 建独立 branch/worktree，基于已合入 SCH-001。
- [ ] 把 route `Scheduler` 重命名/收窄为 `OperationRunner`。
- [ ] 实现 `observeIdempotent()`，task 使用 factory，late result 安全 drain。
- [ ] 实现 `retryIdempotent()`，overall deadline、explicit classifier、最大并发 attempt = 1。
- [ ] 实现 abortable `sleep()`。
- [ ] 验证 milliseconds finite integer `0..2_147_483_647`、maxAttempts positive integer、backoff
  finite/nonnegative；invalid input 不启动 task/timer。
- [ ] 不实现/导出/测试零 production consumer 的 `runCancellable()`。
- [ ] 保留临时 legacy `timeout()` adapter，仅供 allowlisted migration。
- [ ] 增加 pre-abort、sync throw、late resolve/reject、listener/timer cleanup tests。
- [ ] 增加 deferred attempt/deadline-in-attempt/backoff tests，断言无 overlap/no next attempt。
- [ ] 独立 verify agent 审查 observation/retry/resource cleanup 与 unused abstraction guard。
- [ ] 跑 focused tests、typecheck:node、format:check、lint:architecture、lint。

## SCH-002B：Safe consumer migration

- [ ] 等 `SES-002` 合入并 rebase，不复制 availability adapter。
- [ ] `restore` 保留 typed transient settled-only `2 attempts/25ms`。
- [ ] `getActive` 同样保留 typed transient settled-only `2 attempts/25ms`。
- [ ] restore/getActive 的 attempt、backoff、deadline、late settle 期间均保留 binding。
- [ ] 只有 SES-002 权威 `missing` 允许 getActive unbind；unavailable/transient/deadline 不清 binding。
- [ ] session list/page 使用 idempotent observation，不做 per-row retry。
- [ ] activate/deactivate 删除无效 timeout wrapper。
- [ ] provider model getters 删除 `Promise.resolve` + timeout wrapper。
- [ ] `providers.testConnection` 暂不改：精确 legacy allowlist、无 automatic retry、tests 固定 model 60s
  observation/no-model no-uniform-bound truth。
- [ ] Chat preflight reads 迁 idempotent observation，abort 后不进入下一 mutation。
- [ ] Chat send/steer/respond 删除 non-cancellable mutation 外层 deadline。
- [ ] stop 保留 both-cleanups-attempted，不把 cancel request 说成 terminal settlement。
- [ ] static allowlist 精确为 `sessions.create` + `providers.testConnection` 两项。
- [ ] 保持 AgentRuntime exactly-once cancel/stale-run tests 全绿。
- [ ] 独立 verify agent 对每个 consumer 重做 capability 分类。
- [ ] 跑 focused/full tests、typecheck、format、i18n、lint。

## PRV-CAN-001：Provider owner cancellation（dependent slice）

- [ ] 逐 provider inventory `check()`：local/network/SDK/model、signal/timeout 能力。
- [ ] `ProviderExecutionPort.testConnection` 与 presenter check 接收 owner cancellation input。
- [ ] model 60s race 改为发送 cancel 并等待 physical settlement。
- [ ] no-model provider check 全部获得 finite owner deadline/cancellation，或 typed unsupported。
- [ ] 不 automatic retry provider probe。
- [ ] 若出现首个真实 cancellable consumer，同 PR 设计最窄 runner API 与 settlement tests。
- [ ] 删除 provider route 5s legacy wrapper 后更新 allowlist。
- [ ] 独立 provider owner verifier 逐 adapter 检查 signal propagation/settlement。

## SCH-003P：Initial-input acceptance seam

- [ ] 静态枚举所有 production agent create path 是否支持 queue/accepted-start。
- [ ] 定义 `not_required | accepted` 的 content-free acceptance result。
- [ ] DeepChat path await durable `queuePendingInput()` record，不等待后台 generation。
- [ ] fallback path 增加 owner accepted-start handle，不 await whole `processMessage()`。
- [ ] 禁止用 Promise 创建成功或 fire-and-forget 冒充 accepted。
- [ ] queue/start reject 时不返回 accepted；无 seam 的 production path 阻止 003 cutover。
- [ ] title generation 不阻塞 acceptance；不改 generation terminal/cancel owner。
- [ ] 覆盖 no-input、queue deferred/reject、fallback accepted-before-generation、unsupported、dedupe tests。
- [ ] 独立 verifier 审查 accepted boundary 与 generation settlement 分离。

## SCH-003A：Session create backend development slice（不可独立 merge）

- [ ] 建 backend review branch/commit，基于 SCH-002B + SCH-003P。
- [ ] operation schema/DTO 只写在 `sessions.routes.ts` 并通过 schema/route inference取类型。
- [ ] 加 guard：`agent-interface.d.ts` 不得复制 session operation DTO。
- [ ] route schema/handler支持 operation envelope；missing id 在任何副作用前 typed finite reject。
- [ ] 增加 `sessions.getCreateOperation`。
- [ ] 增加 bounded `sessions.listIncompleteCreateOperations`：limit int `1..20`、default `10`、稳定排序。
- [ ] 增加 dismiss route：只写 `dismissedAt`，保留 dedupe identity，不删 session。
- [ ] 实现 domain-specific `session_create_operations` additive table。
- [ ] journal 只存 identity/fingerprint/stage/content-free error/timestamps，不存 raw payload。
- [ ] operation 开始前登记 identity并预分配 session id。
- [ ] 同 id/same fingerprint single-flight；same id/different fingerprint conflict。
- [ ] durable stage 覆盖 record/runtime/input_not_required|input_accepted/completed。
- [ ] initial input 只调用 SCH-003P seam，不等待 generation terminal。
- [ ] observation deadline 返回 pending，不 abort/不 throw false TimeoutError。
- [ ] create 首次 observation 固定 `5_000ms`；renderer reconciliation 固定 `2_000ms × 15`，到界后只留
  manual Check，离页/intent 变化清 timer。
- [ ] compensation 全部 settle success 才 failed；任一不确定为 unknown。
- [ ] restart succeeded 可重建；incomplete pending -> unknown；不 replay payload。
- [ ] discovery 只返回 operationId/sessionId/state/stage/updatedAt，不返回内容/配置/fingerprint。
- [ ] succeeded 随 session delete；failed/unknown 可 dismiss，不加 speculative TTL worker。
- [ ] 覆盖 fast/deferred/duplicate/conflict/cleanup/restart/discovery/dismiss/data-hygiene tests。
- [ ] 独立 backend verifier 审查 DB truth/stage/acceptance/no-duplicate/privacy。
- [ ] 明确此 commit 不创建独立 production PR、不单独 merge。

## SCH-003B：Renderer/integration atomic cutover

- [ ] 显式基于 `SCH-003A + SES-003 + SCH-003P` 集成。
- [ ] SessionClient 每个新 intent 生成 operation id；transport retry 复用，用户 explicit retry 换新 id。
- [ ] production missing-operation-id caller static count = 0。
- [ ] store 维护 current intent token，draft 保持在原 owner，不复制到 operation state/journal。
- [ ] pending 时局部 bounded reconciliation；离页 cleanup observer，不 cancel main operation。
- [ ] succeeded/current 激活导航；succeeded/stale 只刷新列表。
- [ ] failed/unknown/query error 均不自动 create retry，draft 保留。
- [ ] startup bounded discovery；无论一条/多条都需 explicit selection。
- [ ] restart recovery 不绑定当前 draft、不自动 activate/navigate、不显示内容。
- [ ] dismiss 只隐藏 record，不删除 session/identity。
- [ ] 增加 pending/unknown/discovery/dismiss/error i18n keys。
- [ ] 添加 current/stale/page-leave/restart-one-many/privacy/dismiss/duplicate-event tests。
- [ ] 删除 create 5s legacy timeout；provider 未完成时 adapter 只剩精确 provider一项。
- [ ] 003A + 003B 只创建一个 atomic production PR，不发布 backend-only version。
- [ ] 独立 integration verifier 审查 navigation、draft、poll cleanup、restart、legacy finite semantics。
- [ ] 跑 renderer/main focused tests、typecheck、format、i18n、lint、full tests。
- [ ] 完成 DeepChat/ACP/slow/stale/unknown/restart/data-hygiene manual smoke。

## 每个 PR 的 blocking gate

- [ ] develop 与 final verify 不是同一 agent。
- [ ] blocking finding 修复后重新完整 verify。
- [ ] 没有新增 `[NEEDS CLARIFICATION]` 或第三方 retry/operation dependency。
- [ ] 没有把 signal delivery/observation deadline 误写成 physical cancellation/operation failure。
- [ ] 没有 retry overlap 或 same-operation duplicate attempt。
- [ ] restore/getActive 的 `2 attempts/25ms` 与 binding retention 没有退化。
- [ ] provider truth 没有被概括成不存在的 owner timeout。
- [ ] 没有改变 request-only `cancelGeneration()` 的 exactly-once settlement owner。
- [ ] initial input accepted 不等待 whole generation，也不提前伪造。
- [ ] restart recovery content-free、bounded、explicit selection，不关联当前 draft。
- [ ] session operation DTO 没有逃出 sessions route schema owner。
- [ ] missing operation id finite pre-effect reject；003A/B 未被拆成独立 production merge。
- [ ] journal 除 DB-only fingerprint 外不含 raw prompt/file/payload；log 不含 fingerprint/raw payload。
- [ ] full suite 新增失败数为 0；PR body 有 scope、影响、收益、manual gap、rollback。
