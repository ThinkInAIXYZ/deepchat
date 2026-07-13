# Permission 与可恢复交互

> 状态：目标合同，不是 current API reference。DeepChat ordered batch 已由 ASLR-056 接入，external
> notification observer 已由 ASLR-057 隔离；ASLR-070..073 已接入 direct ACP permission continuation。
> 两者共享 decision UI，不共享 continuation 实现；下文类型是合同伪代码。

## 1. 模块目的

本模块把“等待用户决定”建模为明确 gate/interaction，而不是散落 callback。DeepChat tool permission、
question tool 和 ACP protocol permission 可以共享 renderer decision/output contract，但必须由各自 backend
保存、恢复和终止 continuation。

## 2. BEFORE

当前 DeepChat permission、tool dispatch、pause/resume、question 等逻辑主要分散在 runtime/dispatch 和
session-keyed maps。ACP permission 经过 `AcpProvider` 翻译后也在统一 runtime 周边汇合，但实际响应的是
ACP protocol continuation。

外部 `HooksNotificationsService` 同样叫 hook，却是 `queueMicrotask` fire-and-forget。它不能被混入
permission lifecycle，也不能让 shell command 阻塞 agent。

## 3. 两种 interaction owner

```text
DeepChat:
  ToolBatchDispatcher -> ordered PendingInteraction[]
                      -> instance interaction state
                      -> fresh resume run after the final response

ACP:
  ACP protocol request -> AcpPermissionBridge -> AcpProtocolContinuation
                                              -> ACP instance state

Both -> InteractionOutputPort -> current renderer routes/events
```

共同部分只有 request/decision display model、输出 port 和安全的 id correlation。

## 4. DeepChat interaction outcome

```ts
type ToolBatchOutcome =
  | { type: 'completed'; results: ToolExecutionResult[] }
  | {
      type: 'paused'
      interactions: PendingInteraction[]
      executionState: PersistedToolBatchState
    }
```

pre-check policy 可以 allow/deny/pause，但不是唯一来源。question 在调用 tool 前产生 interaction；某些
tool 调用后通过 `rawData.requiresPermission` 产生 interaction；skill draft 在 tool 成功后产生 confirmation。
dispatcher 保留已经发生的 execution state，避免 resume 重做 side effect。

ASLR-056 的 production seam 位于 `agent/deepchat/loop/ports.ts`。retained dispatcher 仍负责现有
permission policy、question interception、tool execution 与 block projection，但它现在只返回
`completed` 或 `paused` discriminated outcome。`paused` outcome 的 interaction 带内部 origin/order；
`PersistedToolBatchState` 记录 call order、已经调用、已经提交 result 与仍 pending 的 call ids，并由
`DeepChatAgentInstance` 持有到最后一项解决。order 沿用现有 persisted action append 顺序；skill-draft
confirmation 仍在 output fitting 成功后 late append。renderer route 和 block schema 未增加字段，
process restart 后也不承诺恢复未持久化的内部 origin。

## 5. Interaction state

```ts
interface PendingInteraction {
  sessionId: AppSessionId
  messageId: string
  origin:
    | 'pre-check-permission'
    | 'question'
    | 'post-call-permission'
    | 'skill-draft-confirmation'
  toolCallId?: string
  order: number
  originRunId?: GenerationId
  createdAt: number
  payload: InteractionPrompt
}
```

实例持有同一 batch 的有序数组。现有 renderer route 继续用 `sessionId/messageId/toolCallId` 响应，不要求
新增 `interactionId/runId/epoch` wire fields；内部可以用 origin run 做 stale guard，但匹配必须兼容当前
route。每次只解决第一项，剩余项继续 pending。raw continuation/function 不持久化，重启恢复能力不超过
当前实现。

## 6. ACP permission

ACP bridge 保存 protocol request id 与 live connection continuation 的关系：

- renderer decision 映射回 ACP allow/deny/cancel response；
- timeout、process exit、connection error、session close 会终止 continuation；
- 相同 request 的重复 decision 幂等或返回明确 stale error；
- ACP permission 不生成 DeepChat tool result，也不进入 DeepChat Tape tool lifecycle；
- ACP turn/transcript 的 pending/terminal 映射保持当前事件顺序。

## 7. 生命周期顺序

DeepChat：

```text
prepared tool batch
  -> for each call in current order/concurrency policy
       pre-check permission may allow/deny/pause
       question is intercepted without tool execution
       otherwise execute exactly once
       inspect post-call requiresPermission
       inspect post-success skill-draft confirmation
  -> collect all ordered interactions + execution state
  -> persist pending actions/current message projection -> settle current run
  -> user decision
  -> match current first interaction by session/message/toolCall under current route contract
  -> execute deferred tool / deny / answer / confirm according to that interaction origin
  -> persist its result/resolution and remove the first interaction
  -> if ordered interactions remain: keep paused and return without a new run
     else: rebuild context and create one fresh resume run
```

## 8. Hook notification 分界

下列 observer 继续 non-blocking：user prompt submitted、tool completed、turn settled 等外部 hook
notification。规则：

- 使用 committed snapshot，不暴露 mutable continuation；
- 通过 `queueMicrotask`/现有队列触发；
- 慢、失败、超时不阻塞 loop；
- 不能返回 allow/deny/pause；
- 不能更改 Tape 或当前 run terminal outcome。

需要控制 loop 的内部逻辑必须是 typed lifecycle port，不能借 external hook 实现。

ASLR-057 的 production seam 是 `DeepChatLoopNotificationObserver`。`processStream`/dispatcher 只投递
`PreToolUse`、`PostToolUse`、`PostToolUseFailure` 与 `PermissionRequest` 的 detached snapshot；observer
的 sync throw、Promise/thenable reject 或 never-settling wait 都不会被 loop await，也不能改变 terminal
outcome。auto-grant、auto-review、streaming permission continuation、skill activation 与 image cache 位于
单独的 control collaborators；interleaved-reasoning trace 位于 internal diagnostics。现有
`HooksNotificationsService` 仍是唯一 shell-command owner，route/config、agentId fallback、payload、顺序、
`queueMicrotask` 和 30 秒 command timeout 均未改变。

## 9. 取消、关闭与 stale decision

- cancel active run 时先标记 abort/closing，再终止/settle ordered interactions under current policy；
- session clear/delete/destroy 清理 persisted interactions，旧 renderer decision 必须被拒绝；
- close window 是否取消 interaction 按当前业务规则保持，不做新的全局假设；
- tool 已完成后到达的 decision 不得再次执行；
- process exit 后的 ACP decision 不得新建 connection 假装恢复；
- renderer event emit 失败不允许留下无法清理的 continuation。

## 10. 迁移步骤

1. 建立 pre-check、question、post-call permission、skill-draft、multiple interaction 与 ACP permission
   状态序列 fixtures。
2. 引入统一的 display DTO/output port，不改变 renderer route/event。
3. 把 DeepChat continuation 收敛到 instance ordered interaction state。（ASLR-044 已完成 state
   ownership；持久 blocks 仍是事实源，typed outcome 不在此 slice）
4. 让 tool dispatcher 返回 typed `ToolBatchOutcome`，携带 interactions 和已发生的 execution state。
5. 将 question tool 移到 ToolPresenter owner，但保留 dispatch interception；接入 post-call permission 和
   skill-draft origins。
6. 把 ACP continuation 收敛到 `AcpPermissionBridge`。
7. 删除 runtime 中 cross-backend permission maps 和 provider id 特判。
8. 明确标注 external hook notification 为 observer，并加 non-blocking test。

## 11. 验证

- DeepChat tool allow/deny/always policy/ask/pause/resume；
- question answer/cancel/window close/session close；
- post-call permission 不重复执行已发生 side effect；
- post-success skill draft confirmation 保留成功结果和 draft；
- 同批 multiple interactions 按序逐项解决；中间项处理后保持 paused，最后一项解决后才创建 fresh run；
- ACP allow/deny/cancel/timeout/process exit；
- duplicate、wrong session/message/tool call 和 stale decision；
- cancel during dialog 与 decision/cancel race；
- persistence/output failure 不遗留 continuation；
- external hook sleep/failure 不增加 loop critical-path latency；
- regular session 与 subagent 现有 interaction payload parity。

## 12. 明确不做

- 不把 ACP continuation 转成 DeepChat tool continuation；
- 不增加 generic human-in-the-loop workflow engine；
- 不改变 permission 默认策略或 UI payload；
- 不让 external hooks 获得 blocking veto；
- 不承诺当前不支持的跨进程重启 continuation 恢复。
