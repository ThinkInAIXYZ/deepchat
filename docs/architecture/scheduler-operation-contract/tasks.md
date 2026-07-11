# Scheduler Operation Contract Tasks

## SCH-001：Decision / SDD

- [x] 审计 route Scheduler timeout/retry/abort 的真实能力。
- [x] 枚举 Session/Chat/Provider production consumers 与 side effects。
- [x] 核验 Scheduler 历史目标、cancelGeneration request-only/exactly-once settlement 意图。
- [x] 定义 observation、retry、cancellation、settlement、unknown/reconciliation contract。
- [x] 关闭 verifier 对 getActive/restart/legacy/initial-input/provider truth 的 blocking findings。
- [x] 明确 operation DTO 只由 sessions route Zod/schema inference 拥有。
- [x] 明确 `SCH-003A/B` 为 atomic production cutover，`SCH-003B depends on SCH-003A + SES-003`。
- [x] inventory 证明 deepchat/acp 共用 durable queue；删除 speculative acceptance slice。
- [x] 固定 unbound create、cursor history、dismiss retry guard 与 UUID validation contract。
- [x] 固定 Electron-safe operation/existing/conflict output；renderer 不依赖 custom Error fields。
- [x] 文档无 `[NEEDS CLARIFICATION]`。

## SCH-002A：OperationRunner core

- [x] 建独立 branch/worktree，基于已合入 SCH-001。
- [x] 把 route `Scheduler` 重命名/收窄为 `OperationRunner`。
- [x] 实现 `observeIdempotent()`，task 使用 factory，late result 安全 drain。
- [x] 实现 `retryIdempotent()`，overall deadline、explicit classifier、最大并发 attempt = 1。
- [x] 实现 abortable `sleep()`。
- [x] 验证 milliseconds finite integer `0..2_147_483_647`、maxAttempts positive integer、backoff
  finite/nonnegative；invalid input 不启动 task/timer。
- [x] 不实现/导出/测试零 production consumer 的 `runCancellable()`。
- [x] 保留临时 legacy `timeout()` adapter，仅供 allowlisted migration。
- [x] 增加 pre-abort、sync throw、late resolve/reject、listener/timer cleanup tests。
- [x] 增加 deferred attempt/deadline-in-attempt/backoff tests，断言无 overlap/no next attempt。
- [x] 独立 verify agent 审查 observation/retry/resource cleanup 与 unused abstraction guard。
- [x] 跑 focused tests、typecheck:node、format:check、lint:architecture、lint。

## SCH-002B：Safe consumer migration

- [x] 等 `SES-002` 合入并 rebase，不复制 availability adapter。
- [x] `restore` 保留 typed transient settled-only `2 attempts/25ms`。
- [x] `getActive` 同样保留 typed transient settled-only `2 attempts/25ms`。
- [x] restore/getActive 的 attempt、backoff、deadline、late settle 期间均保留 binding。
- [x] 只有 SES-002 权威 `missing` 允许 getActive unbind；unavailable/transient/deadline 不清 binding。
- [x] session list/page 使用 idempotent observation，不做 per-row retry。
- [x] activate/deactivate 删除无效 timeout wrapper。
- [x] provider model getters 删除 `Promise.resolve` + timeout wrapper。
- [x] `providers.testConnection` 暂不改：精确 legacy allowlist、无 automatic retry、tests 固定 model 60s
  observation/no-model no-uniform-bound truth。
- [x] Chat preflight reads 迁 idempotent observation，abort 后不进入下一 mutation。
- [x] verifier repair：stop fence 覆盖同 session 全部并发 steer preflight；旧 cleanup 不删新 fence。
- [x] Chat send/steer/respond 删除 non-cancellable mutation 外层 deadline。
- [x] stop 保留 both-cleanups-attempted，不把 cancel request 说成 terminal settlement。
- [x] static allowlist 精确为 `sessions.create` + `providers.testConnection` 两项。
- [x] verifier repair：禁止 production namespace import 绕过 OperationRunner provenance guard，并补 alias 负测。
- [x] production legacy retry caller 归零后删除 `retry()` interface/factory adapter/input。
- [x] 保持 AgentRuntime exactly-once cancel/stale-run tests 全绿。
- [x] 独立 verify agent 对每个 consumer 重做 capability 分类。
- [x] 跑 focused/full tests、typecheck、format、i18n、lint。

SCH-002B development 验证记录：

- route/runner/guard/provider presenter focused：`107 passed`；session binding 与 AgentRuntime focused：
  `276 passed`。
- `typecheck`、`format`、`i18n`、`lint` 全部通过。
- single-worker full：`472` files，`4726 passed / 5 failed / 140 skipped`；在未修改的基线
  `fe126bf3` 上重跑失败文件得到完全相同的 `5` 个失败，新增失败数为 `0`。基线失败属于
  long-steer rebudget、debug mock plan block 与 Spotlight Pinia setup，不在 SCH-002B scope。
- final independent focused：`9` files，`438 passed`；额外 adversarial `46 passed`，闭合并发 steer
  preflight stop fence、stale cleanup/new fence 和 operation-runner namespace/type/alias guard 绕过。
- verifier repair focused：Chat stop/steer fence 与 architecture adversarial guard 共 `46 passed`；namespace
  factory/type/destructure、factory/property alias、local type alias、routes 外与 renamed owner 均有负测。
  repair 后 `typecheck`、`format`、`i18n`、`lint` 全部通过；combined full 留给 final verifier/merge gate。

## PRV-CAN-001：Provider owner cancellation（dependent slice）

- [x] 逐 provider inventory `check()`：local/network/SDK/model、signal/timeout 能力。
- [x] `ProviderExecutionPort.testConnection` 与 presenter check 接收 owner cancellation input。
- [x] model 60s race 改为发送 cancel 并等待 physical settlement。
- [x] no-model provider check 全部获得 finite owner deadline/cancellation，或 typed unsupported。
- [x] 不 automatic retry provider probe。
- [x] 若出现首个真实 cancellable consumer，同 PR 设计最窄 runner API 与 settlement tests。
- [x] 删除 provider route 5s legacy wrapper 后更新 allowlist。
- [x] 独立 provider owner verifier 逐 adapter 检查 signal propagation/settlement。

PRV-CAN-001 development 验证记录：

- production inventory fixture：`DEFAULT_PROVIDERS = 60`，其中有效 AiSdk 为
  `30 fetch-models / 17 generate-text / 8 key-status`；其余为 Ollama、ACP、Voice.ai、
  GitHub Copilot 与无 resolver 的 Fireworks。
- combined provider/route/runner focused：`19` files，`306 passed`；补充 abort-registration race 后
  OpenAI Codex auth、runner、key-status focused：`74 passed`。
- `typecheck`、`format:check`、`i18n`、`lint` 全部通过。
- single-worker full：`473` files，`4772 passed / 6 failed / 140 skipped`。其中新增的
  `markstreamTailwindSource` failure 是 worktree 本地 `node_modules/markstream-vue` 未 materialize；补齐同一已安装
  dependency 的 worktree link 后 isolated rerun 通过。其余 `5` 项与合入前 baseline 精确一致：long-steer
  rebudget 1 项、debug mock plan block 1 项、Spotlight Pinia setup 3 项；本 slice 新增失败数为 `0`。
- independent final verify：changed focused `18` files、`325 passed`；补充 Anthropic/Kimi/Mistral
  focused `15 passed`；额外 `runCancellable` adversarial fixture 通过。
- verifier 在依赖完整的工作树重跑 single-worker full：`473` files，
  `4773 passed / 5 failed / 140 skipped`；`markstreamTailwindSource` 实际通过，剩余 `5` 项在
  `07d40527` baseline 上独立重跑完全一致，本 slice 新增失败数为 `0`。
- verifier 复核 `format:check`、`i18n`、`lint`、`typecheck`、`git diff --check` 全部通过；确认
  production `runCancellable` consumer 只有 ProviderService，legacy timeout consumer 只剩 SessionService，
  无 retry、新依赖或 SCH-003 越界。
- 剩余 manual gap：未使用真实 provider 账户/quota 做网络 smoke，未墙钟等待真实 60 秒 deadline，
  未在真实设置 UI 手动检查 typed unsupported 文案。

## SCH-003A：Session create backend development slice（不可独立 merge）

- [x] 建 backend review branch/commit，基于 SCH-002B。
- [x] operation schema/DTO 只写在 `sessions.routes.ts` 并通过 schema/route inference取类型。
- [x] `sessions.create` output 是 serializable Zod discriminated union：operation/existing/conflict。
- [x] renderer 分支需要的 operationId/sessionId/state/stage/code/dismissedAt 全在 output，不读取 Error fields。
- [x] 加 guard：`agent-interface.d.ts` 不得复制 session operation DTO。
- [x] operation id schema 使用 UUID + length 36；missing/empty/whitespace/non-UUID/overlength 在任何副作用前
  reject。
- [x] 增加 `sessions.getCreateOperation`。
- [x] 增加 cursor `sessions.listCreateOperations`：limit int `1..50`、default `20`、复合稳定排序、同毫秒不漏。
- [x] history 返回所有 identity 与 `dismissedAt`；dismiss 只供 UI 折叠，history/retry guard 仍可查回。
- [x] 实现 domain-specific `session_create_operations` additive table。
- [x] journal 只存 identity/fingerprint/stage/content-free error/timestamps，不存 raw payload。
- [x] operation 开始前登记 identity 并预分配 session id。
- [x] fingerprint 分离稳定 command 与 dynamic runtime defaults：default/ignored markers、blank project 等价、null
  独立；同 id 在设置变化后仍不 conflict。
- [x] production agent-type pre-journal lookup 固定为本地 SQLite truth；其余 dynamic config preparation 全部在
  journal 后执行。
- [x] 同 id/same fingerprint 返回 operation；same id/different fingerprint 返回 conflict + old checkable identity。
- [x] 新 id + same fingerprint pending/unknown（含 dismissed）返回 existing + old checkable identity且零副作用。
- [x] internal typed error 由 route adapter按 class/stable code 映射，禁止按 message 分类。
- [x] durable stage 覆盖 record/runtime/input_not_required|input_accepted/completed。
- [x] inventory/guard 固定 deepchat/acp 都 resolve 到有 durable queue 的 `agentRuntimeAgent`。
- [x] await 现有 `queuePendingInput()` record；删除 unreachable `processMessage` fallback；不新增 accepted-start API。
- [x] observation deadline 返回 pending，不 abort/不 throw false TimeoutError。
- [x] create 首次 observation 固定 `5_000ms`。
- [x] deadline 只读同步 content-free journal snapshot，不等待异步 reconcile。
- [x] create port/backend 移除 `webContentsId`/`bindWindow`；record/runtime/queue/late success 全程保留原 binding。
- [x] terminal success 只发一次 non-activation `created` list notification，不带 active fields，不作为 journal stage。
- [x] compensation 全部 settle success 才 failed；任一不确定为 unknown。
- [x] record create 即使 insert 后抛错也按预分配 id 做权威 cleanup，并等待所有 compensation settlement。
- [x] restart succeeded 可重建；所有 incomplete pending -> unknown；unknown 不按 stage + 残留 session row 自动
  提升；不 replay payload。
- [x] history 只返回 content-free identity/status/cursor，不返回内容/配置/fingerprint。
- [x] succeeded 随 session delete；failed/unknown 保留 reconcile/dedupe evidence，不加 speculative TTL worker。
- [x] 覆盖 validation/fingerprint/dismiss/cursor/unbound/created-event/queue/cleanup/restart/privacy tests。
- [ ] 独立 backend verifier 审查 DB truth/stage/acceptance/no-duplicate/binding/privacy。
- [x] 明确此 commit 不创建独立 production PR、不单独 merge。

SCH-003A development 验证记录：

- 原始 main/renderer focused：contracts、SessionService、dispatcher、AgentSessionPresenter、schema metadata、architecture
  guard、真实 `createBridge` serialization 共 `256 passed`；operation/existing/conflict、UUID pre-effect、5 秒
  pending、single-flight、normalized fingerprint、dismissed dedupe、binding/event、compensation uncertainty、restart/
  unknown reconciliation、content-free history 均有覆盖。
- blocker fix focused：AgentSessionPresenter、SessionService、dispatcher、architecture guard 共 `218 passed`，覆盖
  stable command fingerprint、journal-before-dynamic-prepare、deadline snapshot、partial-record cleanup、conservative
  restart/unknown counterexample 与 production local agent-type lookup。
- Electron 40 ABI143 native SQLite focused：`6 passed`，覆盖 existing current-version DB active initialization、
  additive schema/索引、dismiss visibility、restart disposition、same-millisecond cursor 与 succeeded-only delete。
- `typecheck:node`、`format:check`、`i18n`、`lint`、`git diff --check` 通过。完整 web typecheck 在旧 renderer
  `result.session` 读取新 discriminated union 处保留唯一预期 003B 编译失败；这是 A/B atomic cutover gate，003A
  不用类型断言掩盖、不单独 merge。

## SCH-003B：Renderer/integration atomic cutover

- [ ] 显式基于 `SCH-003A + SES-003` 集成。
- [ ] SessionClient 每个新 intent 生成 operation id；transport retry 复用，用户 explicit retry 换新 id。
- [ ] production missing-operation-id caller static count = 0。
- [ ] store 维护 current intent token，draft 保持在原 owner，不复制到 operation state/journal。
- [ ] pending reconciliation 固定 `2_000ms × 15`；到界只留 manual Check，离页/intent 变化清 timer。
- [ ] succeeded/current 显式 activate exactly once 后导航；succeeded/stale 只刷新且 activate count = 0。
- [ ] failed/unknown/query error 均不自动 create retry；unknown 先 reconcile，相同 fingerprint unresolved 不重建。
- [ ] `kind: existing/conflict` 只读 structured output 并显式 Check，不自动绑定 draft/生成新 id。
- [ ] startup cursor history 可遍历 pending/unknown/dismissed；无论一条/多条都需 explicit selection。
- [ ] restart recovery 不绑定当前 draft、不自动 activate/navigate、不显示内容。
- [ ] dismiss 只折叠 open panel；history/retry guard 可见，不删除 session/identity。
- [ ] 增加 pending/unknown/history/dismiss/error i18n keys。
- [ ] 添加 current/stale activate 1/0、binding retained、cursor pages、dismiss guard、privacy、duplicate event tests。
- [ ] 增加 real IPC 或 structured serialization + `createBridge` boundary test，不接受仅 dispatcher 直调。
- [ ] boundary test 覆盖 operation/existing/conflict；negative control 证明 custom Error 过界只剩 message。
- [ ] current activate failure 不 navigate/onboarding、不改 previous binding，created session 仍可从 list 选择。
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
- [ ] initial input 只 await 当前 durable queue，不等待 whole generation、不保留 speculative fallback。
- [ ] restart history content-free、cursor-complete、dismissed recoverable、explicit selection，不关联当前 draft。
- [ ] session operation DTO 没有逃出 sessions route schema owner。
- [ ] Electron IPC renderer 分支不依赖 Error prototype/custom code/id/state/message substring。
- [ ] operation id missing/empty/malformed/overlength finite pre-effect reject；003A/B 未拆成独立 production merge。
- [ ] create backend 不 bind；current/stale activate exactly 1/0；previous/null binding retained。
- [ ] same fingerprint pending/unknown（含 dismissed）无法绕过 retry-before-reconcile guard。
- [ ] journal 除 DB-only fingerprint 外不含 raw prompt/file/payload；log 不含 fingerprint/raw payload。
- [ ] full suite 新增失败数为 0；PR body 有 scope、影响、收益、manual gap、rollback。
