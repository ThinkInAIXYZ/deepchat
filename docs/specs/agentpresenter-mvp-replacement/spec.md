# AgentPresenter 全量替换（MVP）规格

## 概述

以 `deepchatAgentPresenter` 新 loop 为唯一核心，分阶段替换旧 chat 体系。MVP 先完成权限、workspace 绑定、消息编辑、retry/regenerate、fork 五个核心能力，再推进设置收敛与 chat 模式清理。

## 背景与目标

1. 当前新旧链路并存，存在行为不一致与维护成本。
2. 权限模型需要与新 UI 对齐，并提供明确边界。
3. conversation settings 需要收敛到 agent 默认配置 + session 落地。
4. 最终目标是彻底移除 chat 模式，仅保留 agent 路径。

## 用户故事

### US-1：权限模式选择

作为用户，我希望在状态栏选择 `Default` 或 `Full access`，并且配置在当前 session 生效。

### US-2：Full access 边界

作为用户，我希望 `Full access` 仍受限制，只允许在当前 session 的 `projectDir` 内执行敏感操作。

### US-3：编辑历史 user 消息

作为用户，我编辑历史 user 消息后，系统应截断后续消息并基于新内容重新生成。

### US-4：Retry/Regenerate（无 variants）

作为用户，我执行 retry/regenerate 时，系统应追加新的 assistant 消息，不走 variants 分支。

### US-5：Fork

作为用户，我希望从“当前 assistant 消息（含它）”切 fork，创建可继续对话的新 session。

### US-6：统一 agent 体验

作为用户，我希望不再感知 chat 模式，所有会话统一使用 agent 能力。

## 验收标准

### A. 权限模式

- [x] `ChatStatusBar` 可选择 `Default` 与 `Full access`。
- [x] 权限模式持久化在 session 维度。
- [x] 当 `session.projectDir` 为空时，`Full access` 不可选并提示先绑定 workspace。
- [x] `Default` 走权限确认流程，白名单按 `session` 维度隔离。
- [x] `Default` 白名单匹配粒度为 `toolName + pathPattern`。
- [x] `Full access` 自动通过请求，但任何越出 `projectDir` 的操作必须拒绝。

**Implementation Notes** (added 2026-02-28):
- Add `permission_mode TEXT DEFAULT 'default'` to `new_sessions` table
- ChatStatusBar currently shows read-only "Default permissions" button - must convert to dropdown
- NewThreadPage must pass `permissionMode` to `createSession()`
- Backend must enforce `projectDir` boundary in tool execution

### B. Workspace 绑定与上下文

- [x] 工具执行上下文绑定 `session.projectDir`。
- [x] 工具调用链路统一传递 `conversationId = sessionId`。
- [x] 权限判定与消息归属基于同一 `sessionId`。

**Implementation Notes** (added 2026-02-28):
- `newAgentPresenter.createSession()` already passes `projectDir` to session manager
- `deepchatAgentPresenter.processStream()` uses `sessionId` throughout
- CRITICAL GAP: `executeTools()` in dispatch.ts does NOT check permissions before calling tools
- Must add `PermissionChecker` class and integrate before tool execution

### C. 编辑历史 user 消息

- [ ] 仅允许编辑 user 消息。
- [ ] 编辑后删除该消息之后的所有消息。
- [ ] 自动触发 regenerate，生成新的 assistant 结果。

**Implementation Notes** (added 2026-02-28):
- NOT YET IMPLEMENTED in new architecture
- Requires new IPC: `editUserMessage(sessionId, messageId, newContent)`
- Must delete messages with `orderSeq > editedMessage.orderSeq`
- Must trigger `processMessage()` to regenerate
- Frontend: add edit action to user message context menu

### D. Retry/Regenerate（无 variants）

- [ ] 不提供 variants 路径。
- [ ] 每次 retry/regenerate 追加新的 assistant 消息。
- [ ] 上下文边界正确，避免被替代消息污染后续生成。

**Implementation Notes** (added 2026-02-28):
- NOT YET IMPLEMENTED in new architecture
- Requires new IPC: `retryMessage(sessionId, messageId)`
- Must create new assistant message (not replace)
- Must manage message boundaries correctly
- Old architecture: `agentPresenter.retryMessage()` exists but uses variants
- New implementation must skip variants path

### E. Fork

- [ ] 支持从 assistant 消息发起 fork。
- [ ] fork 切点包含当前 assistant 消息本身。
- [ ] fork 后新 session 消息序列可继续生成。

**Implementation Notes** (added 2026-02-28):
- NOT YET IMPLEMENTED in new architecture
- Requires new IPC: `forkSessionFromMessage(sessionId, messageId)`
- Must copy messages up to and including the fork point
- Must create new session with copied context
- Old architecture had fork in sessionPresenter

### F. 设置收敛

- [ ] conversation settings 入口下线。
- [ ] agent 默认配置生效。
- [ ] 运行时具体配置数据落到 session。

**Implementation Notes** (added 2026-02-28):
- PARTIALLY IMPLEMENTED: new architecture uses agent defaults
- MISSING: session-level configuration (temperature, contextLength, maxTokens)
- `newAgentPresenter.createSession()` only accepts providerId/modelId
- Must extend CreateSessionInput to include all config options
- Old architecture: CONVERSATION_SETTINGS had 12+ fields
- New architecture: must decide which settings to persist at session level

### G. 架构替换

- [x] 新 UI 主链路不依赖 `useChatStore` 与旧 `sessionPresenter`。
- [x] `newAgentPresenter + deepchatAgentPresenter` 成为唯一主执行链路。

**Implementation Notes** (added 2026-02-28):
- MOSTLY COMPLETE: New UI uses sessionStore/messageStore
- ChatStatusBar still imports `useChatStore` for config updates (line 11-12)
- Should migrate ChatStatusBar to use sessionStore config instead
- Core streaming/persistence fully migrated to new architecture

### H. chat 模式清理

- [ ] 类型、UI、主流程中不再暴露 `chat` 模式。
- [ ] 旧 chat 数据有明确兼容迁移策略（静默升级或等价兼容）。

**Implementation Notes** (added 2026-02-28):
- NOT YET STARTED
- Old tables (conversations, messages) still exist
- No migration path defined
- Must decide: migrate old data to new tables? Or maintain dual-read compatibility?
- Recommended: dual-read during transition, migrate on-demand when old session opened

## 非目标

1. 本轮不恢复 variants。
2. 本轮不扩展与替换目标无关的 MCP 新能力。
3. 本轮不做大规模视觉改版。

## 约束

1. MVP 优先，分阶段替换，避免一次性重构。
2. 任何自动放行都必须受 `projectDir` 边界约束。
3. 不引入新链路反向依赖旧 chat store。

## 开放问题

无。本轮关键决策已确认。
