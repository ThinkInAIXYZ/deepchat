# AgentPresenter 全量替换（MVP）实施计划

## 1. 当前基线（Updated 2026-02-28）

1. 新旧双栈并存：`agentSessionPresenter/agentRuntimePresenter` 与旧 `sessionPresenter/useChatStore` 同时存在。
2. 新 loop 已可运行，**streaming 和 message persistence 已完成**，但**权限流程完全缺失**。
3. 产品方向已确定：MVP 先替换核心能力，再完成 chat 模式彻底移除。
4. **关键发现**：`agentRuntimePresenter/dispatch.ts` 的 `executeTools()` 直接调用工具，**无任何权限检查**。

## 2. 核心架构决策

1. 会话真源：`new_sessions + deepchat_sessions`。
2. 消息真源：`deepchat_messages`。
3. 主执行链路：`agentSessionPresenter -> agentRuntimePresenter`。
4. 新 UI 页面不再依赖 `useChatStore` 与旧 `sessionPresenter` 主流程。
5. variants 本轮下线，fork 保留为唯一分叉能力。

## 3. 权限与数据模型决策

### 3.1 Session 权限模式

- `new_sessions` 增加 `permission_mode`：`default | full`，默认 `default`。
- `permission_mode` 为 session 级别配置，不是全局配置。

### 3.2 Full access 规则

- 启用前置条件：`session.projectDir` 必须非空。
- 若 `projectDir` 为空，UI 禁用 `Full access` 并提示先绑定 workspace。
- `Full access` 仅自动通过 `projectDir` 内请求，越界请求统一拒绝。

### 3.3 Default 规则

- 走显式权限确认流程。
- 白名单粒度：`sessionId + toolName + pathPattern`。
- 判定顺序：先 `projectDir` 边界校验，再执行白名单匹配。

## 4. 关键能力设计

### 4.1 Workspace 绑定

1. 工具执行上下文绑定 `session.projectDir`。
2. 工具链路统一传递 `conversationId = sessionId`。
3. 权限消息、审批、执行回执必须在同一 `sessionId` 闭环。

### 4.2 编辑历史 user 消息

1. API：`editUserMessage(sessionId, messageId, newContent)`。
2. 行为：编辑后截断目标消息后的全部消息。
3. 随后自动 regenerate，生成新的 assistant 消息。

### 4.3 Retry/Regenerate（无 variants）

1. API：`retryAssistantMessage(sessionId, messageId)`。
2. 行为：不创建 variants；仅追加 assistant 消息。
3. 使用消息边界标记避免旧分支内容污染上下文。

### 4.4 Fork

1. API：`forkSessionFromMessage(sessionId, messageId)`。
2. 切点定义：从“当前 assistant 消息（含它）”截取。
3. 新 session 继承必要上下文后可继续对话。

## 5. 分阶段迁移

### Phase 0：稳定主链路

1. 清理新 UI 对 `useChatStore` 的依赖点。
2. active session 查询与事件分发统一到 `agentSessionPresenter`。
3. 建立最小回归测试基线。

### Phase 1：权限 + Workspace（MVP 核心）

1. 打通 `ChatStatusBar` 权限模式选择到 session 持久化。
2. 实现 `Default` 权限审批与白名单命中。
3. 实现 `Full access` 自动放行 + `projectDir` 越界拒绝。

### Phase 2：消息操作（MVP 核心）

1. 实现历史 user 消息编辑（截断+再生成）。
2. 实现 retry/regenerate 追加 assistant（无 variants）。
3. 实现 fork（含当前 assistant）。

### Phase 3：设置收敛

1. conversation settings UI 与逻辑下线。
2. agent 默认配置在 session 中落地。
3. 清理 legacy settings 读取/写入路径。

### Phase 4：chat 模式清理

1. 类型层移除 `chat`。
2. UI 与 presenter 中移除 chat 分支。
3. 完成兼容迁移后删除残留代码。

## 6. IPC 与类型面

1. `IAgentSessionPresenter` 扩展：
   - `setSessionPermissionMode`
   - `editUserMessage`
   - `retryAssistantMessage`
   - `forkSessionFromMessage`
2. shared types 补充：
   - `PermissionMode`
   - `PermissionWhitelistRule`（含 `toolName` 与 `pathPattern`）
3. preload 暴露新增方法，保持 typed IPC。

## 7. 测试策略

1. Main 单测：权限边界、白名单匹配、编辑/重试/fork 行为。
2. 集成测试：从 UI 发起到 tool 执行完整链路。
3. 迁移回归：旧 session 与旧 chat 数据可正常打开并升级。

## 8. 风险与缓解

1. 权限误放行风险：main 进程集中校验，默认 deny。
2. 上下文污染风险：编辑/重试后强制消息边界重算。
3. 双栈耦合风险：每阶段明确“唯一真源”，禁止双写。

## 9. 质量门槛

1. `pnpm run format`
2. `pnpm run lint`
3. `pnpm run typecheck`
4. 关键单测与集成测试通过后进入下一阶段

---

## 10. Implementation Notes (2026-02-28)

**Critical Discovery**: Permission flow is completely missing from new architecture.

**Current State**:
- ✅ Streaming infrastructure: COMPLETE
- ✅ Message persistence: COMPLETE  
- ✅ Session management: COMPLETE
- ❌ Permission flow: NOT STARTED (CRITICAL)
- ❌ Message operations (edit/retry/fork): NOT STARTED
- ❌ Session configuration: PARTIAL (missing advanced options)

**Immediate Next Steps**:
1. Create `PermissionChecker` class in `agentRuntimePresenter/`
2. Modify `executeTools()` in `dispatch.ts` to check permissions before tool calls
3. Add `handlePermissionResponse()` IPC method to `agentSessionPresenter`
4. Update `ChatStatusBar.vue` to show permission mode dropdown
5. Add `permission_mode` column to `new_sessions` table
6. Create `permission_whitelists` table for session-scoped whitelists

See `gap-analysis.md` for complete details.
