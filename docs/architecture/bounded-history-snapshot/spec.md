# Bounded History Snapshot

Status: implemented; maintained bounded snapshot contract

Task: `HIS-004`

Findings: `P-01`

Evidence:

- `docs/architecture/history-read-model-baseline/results/{raw.json,report.md}`
- `docs/architecture/runtime-history-projection/spec.md`

## 问题与代码真相

HIS-002 已把 `AgentSessionPresenter.sendMessage()` 的 `hadMessages` 判断改为 existence query，HIS-003A
消除了空 structured bucket 的 N+1，HIS-003B 又把 runtime full-history read 改成不读取 trace 的
projection。当前 direct quick 基线仍是 provider 首次启动前 `7` 次 runtime trace-free full-history read，合计
`35` 条 SQL，即每次 read 固定执行 `1` 次 message header 和 `4` 次 structured bulk query。

这 `7` 次不是同一 owner 中的简单重复：

1. `AgentSessionPresenter.sendMessage()` 调用 `agent.getSessionState()`，runtime 为计算 pending status 读取一次
   history；这是 session orchestration 的外层状态快照。
2. `AgentRuntimePresenter.queuePendingInput()` 再解析 session state，并分别通过 question/pending/queue guard
   重读 history。
3. claimed input 进入 `processMessage()` 后，初始 pending guard 与
   `DeepChatTapeService.ensureSessionTapeReady()` 又分别重读 history。

路线图原文要求“一次 send orchestration 最多一个完整 snapshot”。按当前 owner 边界强行做到 `1`，必须让
`AgentSessionPresenter` 把 runtime-only history 或 revision/token 传入 `AgentRuntimePresenter`，或者建立跨 await
可失效的共享 cache。两种做法都会扩大 public/port contract，并为 cache invalidation 增加新的状态真源。当前
证据只证明重复读昂贵，没有证明这套跨 owner 机制值得存在。

因此本 SDD 将验收边界收敛为 **两个 owner-local snapshot**：

```text
AgentSessionPresenter.sendMessage
  └─ getSessionState ───────────── snapshot A (outer session state)
       └─ queuePendingInput
            ├─ async generation-settings hydration
            ├─ getRuntimeMessages ─ snapshot B (runtime turn)
            ├─ synchronous guards + queue claim
            └─ processMessage
                 ├─ initial pending guard uses B
                 └─ Tape lazy backfill uses B
```

目标从 `7 reads / 35 SQL` 降为精确 `2 reads / 10 SQL`。其中第二次读取发生在 runtime 自己的 async
generation-settings hydration **之后**、同步 queue claim **之前**，避免把 hydration 等待期间已经发生的
history mutation 隐藏在旧快照中。

## Snapshot Contract

### Owner 与生命周期

| Snapshot | 创建位置 | 可用范围 | 失效边界 |
| --- | --- | --- | --- |
| A | `AgentSessionPresenter.sendMessage()` 调用现有 `getSessionState()` | 外层 provider/model/status 决策 | 不传给 runtime queue，不跨 owner 复用 |
| B | `AgentRuntimePresenter.queuePendingInput()` 完成 async settings hydration 后 | 本次同步 guard、queue claim、随后启动的同一 `processMessage()` 初始 guard与 Tape lazy backfill | claim 失败、turn 结束、clear/cancel 中止或任何新的 drain 调用 |

- snapshot B 是当前 `ChatMessageRecord[]` 的一次局部值传递，不是 cache entry，不写入字段、map、database 或
  runtime flag。
- question follow-up 与 pending interaction 必须从同一个 snapshot B 派生，不能为了不同 predicate 再读
  history。
- `processMessage()` 只通过 private/internal context 接收 snapshot；不得修改 public
  `IAgentImplementation`、typed route、IPC 或 renderer contract。
- `DeepChatTapeService.ensureSessionTapeReady()` 可以接受调用方已有的 history records，但必须排序副本或使用
  非原地排序，不能改变调用方 snapshot 的元素顺序。

### 新鲜度与并发约束

1. `queuePendingInput()` 先完成现有 async generation-settings hydration，再创建 snapshot B。测试在 hydration
   未完成期间插入的 message 必须能被 snapshot B 看到。
2. snapshot B 创建后，question/pending 判断、queue claim 与 `processMessage()` 进入 generating 状态之间不得
   新增 await。`processMessage()` 在第一次 await 前设置 generating 状态，继续维持当前同步 claim 边界。
3. snapshot 中存在 pending tool interaction 时必须拒绝或阻止 turn；优化不得把“少读一次”变成跳过 guard。
4. retry 在 generating 或 active pending input 时继续失败；edit/delete 继续服从 active pending input guard。
   本任务不放宽任何 mutation contract。
5. `clearMessages()` 在 pre-stream 阶段会请求 abort 并删除 history。后续在 Tape/compaction 使用 snapshot 前必须
   先观察 abort；被 clear/cancel 的 turn 不得用旧 snapshot 回填 Tape 或继续 provider request。
6. 没有收到 snapshot 的 direct `processMessage()`、retry 路径和其他既有 caller 必须新读一次 runtime
   history，不能复用隐式的 last snapshot。
7. 一个 turn 完成后触发的 `drainPendingQueueIfPossible(..., 'completed')` 必须为下一个 turn 重新创建 snapshot；
   不能跨 turn、跨 drain 或跨 pending item 复用。

## 兼容与行为不变项

- public rich history、paged history、single-message read、trace UI 和 replay trace payload不变。
- runtime snapshot 继续使用 HIS-003B 的 trace-free projection，`traceCount=0` contract不变。
- `hasMessages()` existence query、title generation、draft conversion、provider/model resolution 和 ACP workdir
  synchronization不变。
- pending/question 的判定规则、queue/steer 顺序、claimed record settlement、Tape fact/provenance/manifest shape
  不变。
- 不做 database schema 或 data migration；回滚只需回退局部 snapshot 传递，存量数据不受影响。

## 明确拒绝的设计

- 不追求跨 `AgentSessionPresenter` / `AgentRuntimePresenter` 的单快照，不传 history、revision token 或 cache key
  穿越 owner boundary。
- 不增加 global/session snapshot map、TTL、revision counter、dirty bit 或 invalidation protocol。
- 不增加 runtime flag、EventBus/typed event、observer、metrics platform 或 production benchmark hook。
- 不增加 public route、IPC、shared interface、`IAgentImplementation` method 或可选兼容 fallback。
- 不增加 repository/service abstraction，不创建第二套 message domain model。
- 不顺手做 Tape watermark、incremental backfill、AgentRuntime split 或其他 HIS/TAP 优化。

## 验收标准

### 行为正确性

- 用 deferred settings hydration 制造窗口：hydration 等待期间写入的 pending/question message 被随后创建的
  snapshot 看见，turn按现有规则阻断。
- snapshot 内存在 pending interaction 时 guard 仍阻止发送。
- queue claim 后的 `processMessage()` 初始 guard和 Tape lazy backfill都使用同一 snapshot，不产生额外
  `getRuntimeMessages()`。
- direct `processMessage()` 未传 snapshot 时执行一次新 history read；retry 删除旧消息后也读取删除后的
  history。
- pre-stream `clearMessages()` / cancel 使 abort 在 Tape使用 snapshot 前生效，不用旧数据回填或启动 provider。
- Tape 对 records 的排序不改变传入 snapshot 数组。
- completed drain 为下一项读取新 snapshot，不复用上一 turn 的数组。

### 性能与边界

- HIS-001 direct quick 在首次 provider call 前精确为 `2` 次 runtime trace-free full-history read、`10` 条
  history SQL；rich read count仍为 `0`。
- exact-count guard 同时证明不存在 global trace query，且 snapshot B 只创建一次。
- 正式 `docs/architecture/history-read-model-baseline/results/raw.json` 与 `report.md` 在验证前后 hash一致；quick
  结果不得覆盖正式基线。
- 不增加 production measurement、runtime 开关、event bus 或持久化状态。

### 验证范围

- 只运行 pending/queue/process/Tape/measurement 相关的 targeted Vitest、`typecheck:node`（必要时
  `typecheck`）、architecture/static guard、format、i18n、lint、`git diff --check` 与 real SQLite quick。
- 不运行 E2E、full test suite 或全量 build；本任务以代码准确性和真实 SQLite query count为主。
- 独立 reviewer 必须给出 `PASS / 0 BLOCKER`；没有 `[NEEDS CLARIFICATION]`。

## Open Questions

无。跨 owner 单快照被明确拒绝；如果未来数据证明 `2 → 1` 的额外收益足以承担跨 owner invalidation contract，
必须另立 architecture SDD，不得扩张本任务。

## 实施结果

- Architecture contract 由 `35ec191c` 固定，局部 snapshot 实现于 `6d694459`。
- queue path 在 generation-settings hydration 完成后读取一次 runtime history，同一
  readonly records 被 question/pending/queue guard、`processMessage()` initial guard 和 Tape lazy
  backfill 复用；claim 到 generating 之间没有新增 await。
- direct/retry caller 没有 snapshot 时仍 fresh read；completed drain 为下一个 turn 新建snapshot；
  pre-stream clear/cancel 在 Tape/provider 前观察 abort；Tape 对输入副本排序，不修改调用方数组。
- Electron ABI143 focused AgentRuntime/Tape `241/241` 通过；real SQLite direct quick 精确为
  `2 total / 0 rich / 2 runtime reads`、`0 rich / 2 runtime headers`、`10 SQL`，query plan 不含
  trace table 或 `MATERIALIZE`。
- `typecheck:node`、format check、i18n、lint、architecture/agent-cleanup/process-launcher guards 和
  diff check 通过；正式 HIS-001 raw/report hash 前后一致；独立审查
  `PASS / 0 BLOCKER`。未运行 full/E2E/build。

精确 `2 / 10` 只使用 10-message/0-trace real SQLite quick 复验；HIS-001 的 12-scenario
formal baseline 是历史证据，本任务有意不重跑、不覆盖。
