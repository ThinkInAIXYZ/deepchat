# Plan: 权限流程稳定性（多工具/批量）(v2)

## 范围与原则

- **批次语义**：一次 assistant message 产出的 tool call 视为同一批次；permission 与恢复执行必须绑定该批次（messageId）。
- **强暂停**：出现 permission-required 后，停止执行后续工具与继续对话，直到用户完成该批次内全部权限决策。
- **顺序与幂等**：恢复后按原始 tool call 顺序执行；同一批次的恢复链路最多触发一次（互斥 + 幂等）。
- **最小改动**：优先复用 message blocks 作为“执行事实”，session runtime 只做 UI 计数与互斥锁。

## 现状问题与根因（结合日志）

- **批准后仍反复 tool_use / 不继续执行**：恢复执行后的 tool end/result 仅在内存或等待 `StreamUpdateScheduler` 异步落库（600ms），但继续生成会从 DB 重新构建上下文（`prepareConversationContext()`），读到旧 message content，模型看不到 tool 结果而再次 tool_use。
- **重复启动 loop / 顺序更乱**：恢复链路中存在释放 resume lock 的窗口，导致同一 `messageId` 可能被重复恢复（重复 start loop / start stream）。
- **预检查不统一/载荷丢失**：agent 工具的 pre-check 被跳过或 permission_request payload 不保真（如 paths/commandInfo），导致执行期才触发 permission-required，破坏批次顺序与可控暂停。
- **pendingPermissions 状态残留**：空数组/指针未清理会干扰“是否还有 pending”的判断与前端展示。

## 目标行为（v2）

### 状态机（概念）

```
generating
  └─(permission-required)→ waiting_permission
        └─(all permissions resolved)→ generating (resume tools)
              └─(tools done + persisted)→ generating (continue model)
                    └─(end)→ idle
```

关键约束：
- `waiting_permission` 期间不允许启动新的 LLM stream，也不允许执行任何后续 tool call。
- `resume tools` 阶段必须 single-flight（同一 messageId 只能有一个恢复链路在跑）。
- `continue model` 前必须保证 tool 结果对 DB 读路径可见。

### 批次定义与事实来源

- **批次 ID**：`assistantMessageId(eventId/messageId)`。
- **批次事实**：message content 中的 tool_call / permission blocks（顺序与状态）。
- **session runtime**：仅用于：
  - `pendingPermissions[]`（UI/状态栏/下一条 pending 提示）
  - `permissionResumeLock`（互斥恢复）

## 关键实现策略

### 1) 恢复链路 single-flight（临界区互斥）

- `permissionResumeLock` 的作用域：覆盖 **执行工具 -> 同步落库 -> 启动继续生成** 的整个临界区。
- 恢复过程中不在“每个 tool”之间释放 lock；仅在以下情况释放：
  - 执行期再次触发 requiresPermission：立刻停止，释放 lock，回到 `waiting_permission`
  - 全部工具执行完成并已同步落库，且已触发继续生成
- 防重：对同一 `messageId` 的重复 `handlePermissionResponse` 只能有一次进入恢复临界区。

### 2) 工具结果可见性（同步落库）

- 在继续生成前，必须把 `state.message.content` 同步写入 DB：
  - 使用 `messageManager.editMessageSilently(messageId, JSON.stringify(state.message.content))`
- 不依赖 `StreamUpdateScheduler` 的定时 DB flush（600ms）作为一致性保障。
- 写入必须发生在 `startStreamCompletion(conversationId, messageId)` 之前。

### 3) 统一 pre-check + payload 保真（MCP + agent）

- `ToolPresenter.preCheckToolPermission` 对 agent 工具不再直接跳过。
- `AgentToolManager` 增加 `preCheckToolPermission(toolName, args, conversationId)`：
  - 只判断权限需求，不执行工具
  - write 类工具输出 `paths`；execute_command 输出 `commandInfo/commandSignature`
- `ToolCallProcessor.batchPreCheckPermissions`：
  - 支持 `permissionType: 'read'|'write'|'all'|'command'`
  - 保留并合并 tool 层提供的 `permissionRequest` payload，禁止丢字段

### 4) execute_command background 权限一致性

- `execute_command` 的 `background: true` 也必须先走 command permission check，禁止绕过。

## 工作项拆解（按优先级）

1) **PermissionHandler：恢复临界区 + 同步落库**
- 文件：`src/main/presenter/agentPresenter/permission/permissionHandler.ts`
- 调整 `resumeToolExecutionAfterPermissions(...)`：lock 不在每个 tool 之间释放，避免重入窗口
- 调整 `continueAfterToolsExecuted(...)`：`startStreamCompletion` 前 `editMessageSilently`

2) **SessionManager：pendingPermissions 清理**
- 文件：`src/main/presenter/agentPresenter/session/sessionManager.ts`
- `removePendingPermission(...)`：filter 后 length=0 时把 `pendingPermission/pendingPermissions` 置空

3) **统一 pre-check + payload 保真**
- 文件：`src/main/presenter/toolPresenter/index.ts`（agent 工具 pre-check 不再跳过）
- 文件：`src/main/presenter/agentPresenter/acp/agentToolManager.ts`（新增 `preCheckToolPermission`）
- 文件：`src/main/presenter/agentPresenter/loop/toolCallProcessor.ts`（batch pre-check 合并 payload + command union）

4) **background 命令权限**
- 文件：`src/main/presenter/agentPresenter/acp/agentBashHandler.ts`
- 将 command permission check 提前到 background 分支之前

5) **测试（必须覆盖“批准后继续执行”回归）**
- `test/main/presenter/sessionPresenter/permissionHandler.test.ts`
  - 断言：恢复后会执行工具、并在继续生成前写 DB（mock `editMessageSilently`/顺序）
  - 断言：同 messageId 重复触发只会进入一次恢复链路
- `test/main/presenter/toolPresenter/toolPresenter.test.ts`
  - 断言：agent 工具 pre-check 会被调用并返回 payload
- 新增：`test/main/presenter/agentPresenter/toolCallProcessor.batchPrecheck.test.ts`
  - 断言：permission_request payload 不丢失（paths/commandInfo）

## 手动验收脚本（v2）

- 单工具：`execute_command`（非白名单/危险命令）-> 批准 -> 只执行一次 -> 继续生成（不再二次 permission-required）
- 多工具 batch：两个 tool 都需要权限 -> 逐个批准 -> 批次恢复按顺序执行 -> 继续生成
- 部分拒绝：拒绝其中一个 -> 该 tool 产生一致 error tool result，其它照常执行并继续生成
- background：`execute_command` + `background: true` -> 也必须弹权限
