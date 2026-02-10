# Tasks: 权限流程稳定性（多工具/批量）

## Phase 1: Session runtime 与类型

### Task 1.1: 支持多条 pending permissions + 恢复互斥锁
**Files:**
- `src/main/presenter/agentPresenter/session/sessionContext.ts`
- `src/main/presenter/agentPresenter/session/sessionManager.ts`

**Subtasks:**
- [ ] 新增 `runtime.pendingPermissions: Array<{ messageId; toolCallId; permissionType; payload }>`
- [ ] 新增 `runtime.permissionResumeLock: { messageId; startedAt } | undefined`
- [ ] 保留 `runtime.pendingPermission` 作为兼容字段（从 `pendingPermissions[0]` 派生或镜像）
- [ ] `startLoop()`/清理逻辑同步重置新增字段

**Acceptance:**
- 能稳定表达同一条消息内的多条 permission 请求，不再被覆盖

---

## Phase 2: permission-required 事件落盘与暂停

### Task 2.1: permission-required 不覆盖、只追加/更新
**File:** `src/main/presenter/agentPresenter/streaming/llmEventHandler.ts`

**Subtasks:**
- [ ] `permission-required` 时把请求写入 `runtime.pendingPermissions`（按 `messageId+toolCallId` 去重）
- [ ] session 状态稳定进入 `waiting_permission`（不在未决策时回到 generating/idle）

**Acceptance:**
- 同批次多 permission 时 UI/状态不会错乱、不会只显示最后一条

---

## Phase 3: PermissionHandler（决策与恢复）

### Task 3.1: 决策阶段只更新，不提前恢复
**File:** `src/main/presenter/agentPresenter/permission/permissionHandler.ts`

**Subtasks:**
- [ ] 拆分“更新 permission blocks 状态”与“尝试恢复执行”两个步骤
- [ ] 仅当该 message 内不存在 `tool_call_permission.status=pending` 时才允许进入恢复逻辑
- [ ] 落盘后同步更新 generatingMessages 内的快照（避免 renderer 看到旧块）
- [ ] `command/agent-filesystem/deepchat-settings` 按精确 scope 处理，不做 serverName 一刀切批量
- [ ] 仅在安全条件满足时才批量更新（同 serverName 且 permission 层级满足且无额外 scope）

**Acceptance:**
- 多 permission 场景下，用户确认第 1 条后不会触发 resume/工具执行

---

### Task 3.2: 恢复执行按 tool_call 顺序、且幂等
**File:** `src/main/presenter/agentPresenter/permission/permissionHandler.ts`

**Subtasks:**
- [ ] 引入 `permissionResumeLock`，同一 `conversationId+messageId` 只允许一次恢复链路
- [ ] 以 `tool_call.status=loading` blocks 作为“待执行队列”事实来源（保持原始顺序）
- [ ] 对被拒绝的 tool call：生成一致的 tool error 回填（不执行 tool）
- [ ] 对允许/无需 permission 的 tool call：串行执行并闭合 tool_call blocks
- [ ] 执行中若再次 `requiresPermission`：立刻暂停并回到 `waiting_permission`（不丢队列）
- [ ] 全部工具完成后，仅继续一次模型生成（避免重复 startLoop/重复 stream）

**Acceptance:**
- 恢复后执行顺序正确、只恢复一次、不会漏执行“未触发 permission 的 tool call”

---

## Phase 4: 权限层级（all > write > read）

### Task 4.1: MCP session 权限检查按层级判断
**File:** `src/main/presenter/mcpPresenter/toolManager.ts`

**Subtasks:**
- [ ] 实现统一的 permission 比较/包含关系
- [ ] `checkSessionPermission()` 按层级返回（不再 “任意权限=全部通过”）
- [ ] 持久化 `autoApprove` 逻辑保持一致（`all` 覆盖一切，`write` 覆盖 `read`）

**Acceptance:**
- 已授予 `write` 时，不应再次因为 `read` 弹窗；但也不会把 `read` 误当成 `write`

---

## Phase 5: Renderer（command permission 交互修正）

### Task 5.1: “允许一次 / 允许本次会话”区分生效
**File:** `src/renderer/src/components/message/MessageBlockPermissionRequest.vue`

**Subtasks:**
- [ ] `Allow once` → `remember=false`
- [ ] `Allow for session` → `remember=true`

**Acceptance:**
- command permission 可真正按“一次/会话”两种粒度授权

---

## Phase 6: Tests 与质量门禁

### Task 6.1: 主链路单元测试覆盖多 permission/幂等/顺序
**Files:**
- `test/main/presenter/sessionPresenter/permissionHandler.test.ts`
- `test/main/presenter/mcpPresenter/toolManager.permission.test.ts`（建议新增）

**Subtasks:**
- [ ] 多 permission：确认第 1 条不恢复、全部 resolved 才恢复
- [ ] 恢复幂等：重复触发响应只执行一次恢复链路
- [ ] 顺序：恢复后的执行顺序与 tool_call blocks 一致
- [ ] 层级：`all > write > read` 覆盖关系正确
- [ ] 校验并修正历史测试中与现实现不一致的断言（例如“permission block removal”类用例）

---

### Task 6.2: 回归自测清单
**Subtasks:**
- [ ] 同一轮 2+ 个 MCP tool：其中 1 个需要 permission
- [ ] 同一轮 2+ 个 MCP tool：2 个都需要 permission（同 server / 不同 permissionType）
- [ ] 混合 allow/deny：允许 1 个、拒绝 1 个，能继续回答
- [ ] command permission：Allow once/Allow for session 都生效

---

### Task 6.3: 质量门禁
**Commands:**
```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm test
```

