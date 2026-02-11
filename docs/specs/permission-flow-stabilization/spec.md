# 权限流程稳定性（多工具/批量）(v2)

## 背景与问题（更新）

当前 permission 流在多工具/批量场景下出现“批准后仍不继续执行、反复 tool_use、顺序混乱、重复启动 loop”等问题。结合日志与现有代码结构，根因主要来自两类：

1) **可见性/持久化竞态（DB flush race）**
- permission 批准后会走“恢复执行工具 -> 继续生成”路径；
- 但工具执行产生的 message content 更新通常通过 `StreamUpdateScheduler` 异步落库（默认 600ms 周期）；
- `StreamGenerationHandler.prepareConversationContext()` 会从 DB 重新 `getMessage/getMessageHistory` 组上下文；
- 若在落库前继续生成，模型看不到刚执行的 tool end/result，于是再次 `tool_use`，形成“批准了仍重复要权限/不执行”的表象。

2) **恢复链路并发/重入窗口（resume re-entry）**
- 恢复执行中存在释放 resume lock 的窗口，可能导致同一 `messageId` 的恢复链路被重复触发；
- 结果是重复 start loop / 重复继续生成 / 工具执行与 UI 状态交错。

此外还有“预检查不统一/载荷不完整”问题会加剧混乱：
- agent 工具 pre-check 被跳过或 permission_request payload 丢失（paths/commandInfo 等），导致执行期才触发 permission-required，破坏 batch 语义与顺序可控性。

本规格目标：把 permission 从“提示事件”升级为**严格的执行门闩（gating latch）**，同时约束：
- 何时暂停、何时恢复、恢复只能一次；
- 恢复后工具结果必须对后续续跑模型“可见”（至少 DB 可见）；
- 批次内多权限串行处理后再统一执行。

## 目标

- 强暂停语义：出现 permission-required 后必须暂停后续工具执行与对话继续，直到用户完成决策。
- 批次一致性：一次模型输出的多个 tool call 作为一个 batch；permission 决策绑定到该 batch（消息级）。
- 恢复幂等：同一 `assistant messageId` 的恢复动作最多触发一次，避免重复 resume / 重复 loop。
- 顺序与可部分拒绝：恢复后按原 tool 顺序执行；允许的执行，拒绝的回填一致错误结果并继续生成。
- **工具结果可见性保证**：恢复执行工具后，在继续生成前，必须保证 tool 结果已写入 message content 且对“构建上下文的读路径”可见（至少 DB 可见）。
- 不改变业务语义：不改变工具本身行为，仅修复 permission gating / resume / 持久化一致性。

## 非目标

- 不做大规模 UI 重构（可后续增强批次分组、一键允许等）。
- 不新增权限类型（仍为 `read|write|all|command`）。
- 不改变 MCP autoApprove 策略模型。
- 不做跨会话/跨设备权限同步。

## 术语与批次定义

- `Batch`: 同一条 assistant message（`messageId`）中由模型一次输出的 tool_calls 集合。
- `Permission Block`: message content 中的 `action_type: tool_call_permission` block。
- `Pending Permission`: session runtime 中的 `pendingPermissions[]` 项。

批次键：`(conversationId, messageId)`。

## 状态机（必须满足的约束）

### Pause（进入 waiting_permission）

当任意 tool call 需要权限时：
- 在 message content 中创建对应 permission block（status=pending）
- session 状态进入 `waiting_permission`
- **停止执行该 batch 中任何 tool**（除非本规格显式允许“边批边跑”，本版本不允许）

### Decide（用户逐个批准/拒绝）

每次用户响应：
- 仅更新对应 permission block 状态为 granted/denied
- 更新 `pendingPermissions`（移除已决策项）
- 如果仍存在 pending permission：只发 `PERMISSION_UPDATED` 刷新 UI，不得触发恢复执行

### Resume（恢复执行，仅一次）

当且仅当该 `messageId` 下所有 permission block 都已决策（无 pending）：
- 获取并持有 resume lock（messageId 级互斥）
- 按原 tool 顺序执行：
  - granted: callTool -> tool_call running/end
  - denied: 生成一致的 error tool result（例如 "User denied the request."）
- **关键：在继续生成前，必须保证 message content 已落库可见**
- 然后继续生成（startStreamCompletion / 或等价续跑）

### Idempotency（幂等）

- 同一个 `messageId` 的恢复链路在任意时刻只能有一个在跑；
- 重复点击批准/快速点击不会导致重复恢复；
- 如果恢复过程中再次出现新的 permission-required（执行期触发），应回到 Pause，且不会丢 batch 上下文。

## 数据一致性与“可见性”要求（新增）

### 为什么必须强制落库

`prepareConversationContext()` 从 DB 读 message/history。若恢复执行更新只停留在内存（或等待 scheduler 600ms 异步落库），下一次生成构建上下文会读到旧内容，导致模型重复 tool_use。

### 规范要求

在 `continueAfterToolsExecuted()` 触发继续生成前：
- 必须执行一次“同步落库”动作，确保当前 message content（含 tool end/result、permission block status）对 DB 读路径可见。

实现策略（v1）：
- 直接调用 `messageManager.editMessageSilently(messageId, JSON.stringify(contentSnapshot))` 强制落库；
- 不依赖 `StreamUpdateScheduler` 的定时 flush 来保证一致性。

## 统一预检查（Pre-check）要求（补全）

- 所有工具（MCP + agent）都必须在 batch pre-check 阶段尽可能产出 permission-required，避免执行期才触发导致顺序/批次语义被破坏。
- `permission_request` 必须携带足够 payload 让 PermissionHandler 能正确 approve：
  - command: `command`, `commandSignature`, `commandInfo`, `rememberable`
  - filesystem write: `paths`
- 禁止 payload 丢失或被覆盖（合并策略：保留 tool 层提供的字段）。

## 验收标准（更新）

- 批次内任意 tool 需要 permission：未决策前不执行任何 tool。
- 同一 message 多个 permission：逐个决策不触发恢复，直到全部决策完成。
- 批次恢复只发生一次，不出现同一 messageId 的重复 start loop。
- 批次恢复后：
  - 允许的工具产生 running/end 且结果回填；
  - 拒绝的工具产生一致错误结果；
  - **继续生成时模型能看到上述结果**，不会再次 tool_use 同一工具来要权限。
- “批准后仍重复要 permission”的问题不再出现（同一 tool_call_id 不会再次 permission-required）。

## 设计决策（v1）

- 恢复时机：只要 batch 内仍存在 pending permission，就不恢复执行；全部决策后统一恢复。
- lock 粒度：messageId 级互斥，覆盖“恢复执行工具 + 同步落库 + 继续生成”的整个临界区。
- 持久化策略：恢复路径强制同步落库，不依赖 scheduler 定时 flush。
