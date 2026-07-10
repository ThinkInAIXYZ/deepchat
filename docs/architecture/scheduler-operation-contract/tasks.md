# Scheduler Operation Contract Tasks

## SCH-001：Decision / SDD

- [x] 从最新 `docs/audit-remediation-plan` 基线建立独立 worktree/branch。
- [x] 审计 `src/main/routes/scheduler.ts` 的 timeout/retry/abort 实现。
- [x] 枚举 `SessionService`、`ChatService`、`ProviderService` 的全部 production consumer。
- [x] 追踪 session create 的 DB/runtime/binding/event/initial input side effects。
- [x] 追踪 provider model sync getter 和 provider check 的真实 timeout owner。
- [x] 追踪 Chat route controller 与 Agent runtime generation controller 的 owner 差异。
- [x] 核验 commit `8ef5c858` 的原始 Scheduler 目标与接口冲突。
- [x] 核验 commit `3ea97717` 的 request-only cancel / exactly-once settlement 意图。
- [x] 定义 cancellation capability × replay safety 两轴与三种 execution policy。
- [x] 定义 deadline、retry、settlement、unknown outcome、reconciliation contract。
- [x] 设计 `SCH-002A/B`、`SCH-003A/B` 的独立交付顺序、测试和回滚。
- [x] 定义 pending/unknown renderer 行为与 ASCII UI。
- [x] 文档无 `[NEEDS CLARIFICATION]`。

## SCH-002A：OperationRunner core

- [ ] 建独立 branch/worktree，基于已合入 SCH-001。
- [ ] 把 route `Scheduler` 重命名/收窄为 `OperationRunner`。
- [ ] 实现 `observeIdempotent()`，task 使用 factory，late result 安全 drain。
- [ ] 实现 `runCancellable()`，signal 传给 owner，abort 后等待 attempt settle。
- [ ] 实现 `retryIdempotent()`，overall deadline 和 explicit `shouldRetry`。
- [ ] 保留临时 legacy `timeout()` adapter，仅供 consumer migration。
- [ ] 增加 pre-abort、late resolve/reject、listener/timer cleanup tests。
- [ ] 增加 deferred attempt，断言 retry `maxConcurrentAttempts === 1`。
- [ ] 增加 deadline-in-attempt/backoff，断言之后不启动 attempt。
- [ ] 独立 verify agent 审查 typed error、abort/settlement 和资源 cleanup。
- [ ] 运行 focused tests、typecheck:node、format:check、lint:architecture、lint。
- [ ] PR 记录 automation/manual gap/rollback，merge 后在 base 跑 full regression。

## SCH-002B：Safe consumer migration

- [ ] 确认/合入 `SES-002` 后再修改 `SessionService` availability path。
- [ ] restore 改用 settled-only typed transient retry；overall deadline 后禁止新 attempt。
- [ ] session read/list/page/getActive 迁到 idempotent observation，不做 per-row retry。
- [ ] activate/deactivate 删除无效 timeout wrapper。
- [ ] provider model getter 删除 `Promise.resolve` + timeout 包装。
- [ ] provider connection test 删除 route 5 秒 false timeout，不增加 automatic retry。
- [ ] Chat preflight reads 迁到 idempotent observation，abort 后不进入下一 mutation。
- [ ] Chat send/steer/respond 删除 non-cancellable mutation 外层 deadline。
- [ ] stop 保留 both-cleanups-attempted，且不把 cancel request 说成 terminal settlement。
- [ ] 加 static allowlist：legacy timeout 只允许 `SessionService.createSession` 一处。
- [ ] 保持 AgentRuntime exactly-once cancel/stale-run tests 全绿。
- [ ] 独立 verify agent 对每个 consumer 重做 capability 分类，不接受按名称推断。
- [ ] 跑 focused/full tests、typecheck、format、i18n、lint。
- [ ] 手工验证 provider slow check、stop during preflight、normal send/restore。
- [ ] merge 后更新统一审计实施 ledger。

## SCH-003A：Session create operation backend

- [ ] 建独立 architecture/backend branch，基于 SCH-002B。
- [ ] 定义 additive create operation DTO 和 typed error/status schema。
- [ ] 增加 optional input `operationId` 与 `sessions.getCreateOperation` route。
- [ ] 实现 domain-specific `session_create_operations` additive table。
- [ ] journal 只存 identity/fingerprint/stage/content-free error code，不存 raw payload。
- [ ] operation 开始前登记 identity 并预分配 session id。
- [ ] 实现同 id/same fingerprint single-flight，同 id/different fingerprint conflict。
- [ ] 在 record/runtime/initial-input acceptance/completion 后更新 durable stage。
- [ ] observation deadline 返回 pending，不 abort/不 throw TimeoutError。
- [ ] compensation 结果可观察：全成功才 failed；任一不确定则 unknown。
- [ ] process restart：succeeded 可重建；incomplete 保守 unknown；不 replay payload。
- [ ] session delete 清理关联 succeeded operation row；不新增 speculative TTL worker。
- [ ] 覆盖 fast/deferred/duplicate/conflict/cleanup-failure/restart/data-hygiene tests。
- [ ] 独立 verify agent 审查 DB truth、stage 原子边界和 no-duplicate side effects。
- [ ] 运行 focused tests、typecheck:node、format:check、lint。

## SCH-003B：Renderer reconciliation / cleanup

- [ ] 基于已合入 `SES-003` route/renderer compatibility 结果 rebase。
- [ ] SessionClient 为每个新 create intent 生成并复用 operation id。
- [ ] session store 维护 current intent token，不复制 draft payload。
- [ ] pending 时局部 reconciliation；页面离开 cleanup observer，不 cancel main operation。
- [ ] succeeded/current intent 激活导航；succeeded/stale intent 只刷新列表。
- [ ] failed/unknown 均保留 draft；unknown/check error 不自动 retry。
- [ ] 增加 pending/unknown/failure i18n keys。
- [ ] 按 spec ASCII 行为实现 UI state；不暴露内部 error/fingerprint。
- [ ] 添加 API/store/component tests：current/stale/page-leave/restart/duplicate event。
- [ ] 删除 legacy `timeout()` adapter、allowlist 和 create 5 秒 constant。
- [ ] architecture guard 证明 legacy production consumer count = 0。
- [ ] 独立 verify agent 审查 navigation race、draft lifecycle、poll cleanup、compatibility。
- [ ] 跑 renderer/main focused tests、typecheck、format、i18n、lint、full tests。
- [ ] 完成 DeepChat/ACP/slow/stale/unknown/restart/data-hygiene manual smoke。
- [ ] PR 详细记录未自动覆盖的平台/路径、手工步骤、影响和回滚。
- [ ] merge 后更新统一审计实施 ledger，满足全部 closure gates 后关闭 A-04。

## 每个 PR 的 blocking gate

- [ ] develop 与 verify 不是同一 agent。
- [ ] blocking finding 修复后重新完整 verify，不只口头确认。
- [ ] 没有新增 `[NEEDS CLARIFICATION]`。
- [ ] 没有新增第三方 retry/operation dependency。
- [ ] 没有把 signal delivery 误写成 physical cancellation proof。
- [ ] 没有把 observation deadline 误写成 operation failure。
- [ ] 没有 retry overlap 或 same-operation duplicate attempt。
- [ ] 没有改变 request-only `cancelGeneration()` 的 exactly-once settlement owner。
- [ ] journal 除 fingerprint 外不含 raw prompt/file/payload；log 不含 fingerprint/raw payload。
- [ ] full suite 新增失败数为 0；历史 baseline failure 单独列出。
- [ ] PR body 有 scope、影响、收益、自动验证、manual gap、rollback。
