# AgentPresenter 全量替换（MVP）任务清单

**Updated**: 2026-02-28 - Added implementation notes and priority markers

## T0 规格冻结

- [x] 移除并确认无 `[NEEDS CLARIFICATION]`。
- [x] 锁定 MVP 范围：权限、workspace、编辑、retry/regenerate、fork。
- [x] 明确本轮不做 variants。

**Status**: COMPLETE - See `gap-analysis.md` for full specification

## T1 Session 权限模型 🔴 P0 CRITICAL

- [ ] 为 `new_sessions` 增加 `permission_mode` 字段（默认 `default`）。
  - **SQL**: `ALTER TABLE new_sessions ADD COLUMN permission_mode TEXT DEFAULT 'default'`
  - **File**: `src/main/presenter/sqlitePresenter/tables/newSessionsTable.ts`
- [ ] session manager 增加读写 `permission_mode` 能力。
  - **File**: `src/main/presenter/newAgentPresenter/sessionManager.ts`
  - Add `permissionMode` to `create()` method
  - Add getter/setter methods
- [ ] 补齐迁移与回填策略测试。
  - Existing sessions default to 'default' mode

**Priority**: P0 - MVP Blocker
**Estimated**: 2-3 hours
**Status**: NOT STARTED

## T2 ChatStatusBar 权限接入 🔴 P0 CRITICAL

- [ ] `ChatStatusBar` 接入 `Default/Full access` 选择与展示。
  - **Current**: Line 91 shows read-only button "Default permissions"
  - **Required**: Convert to DropdownMenu with Default/Full options
  - **File**: `src/renderer/src/components/chat/ChatStatusBar.vue`
- [ ] session `projectDir` 为空时禁用 `Full access`。
  - Check `sessionStore.activeSession.projectDir`
  - Disable dropdown option when empty
- [ ] `Full access` 禁用态提示“先绑定 workspace"。
  - Add tooltip on disabled option
- [ ] 选择结果写回 session 并可恢复。
  - Call `newAgentPresenter.updateSessionPermissionMode()` (NEW IPC)
  - Load on session activation

**Priority**: P0 - MVP Blocker
**Estimated**: 4-6 hours
**Status**: NOT STARTED
**Dependencies**: T1 (session permission_mode field)

## T3 Default 权限流程 🔴 P0 CRITICAL

- [ ] 新链路接入权限请求消息块与审批动作。
  - **File**: `src/main/presenter/deepchatAgentPresenter/dispatch.ts`
  - Modify `executeTools()` to check permissions BEFORE calling tools
  - Create permission request block: `{ type: 'action', action_type: 'tool_call_permission', ... }`
  - Emit `STREAM_EVENTS.RESPONSE` with permission block
  - PAUSE stream processing (set session status to 'paused')
- [ ] 实现 session 级白名单存储与查询。
  - **CREATE**: `src/main/presenter/deepchatAgentPresenter/permissionChecker.ts`
  - Create `permission_whitelists` table: `{ sessionId, toolName, pathPattern, permissionType, createdAt }`
  - Query: `SELECT * FROM permission_whitelists WHERE sessionId = ? AND toolName = ?`
- [ ] 白名单匹配规则为 `toolName + pathPattern`。
  - Match exact tool name
  - Match path pattern (glob or regex)
  - Check `remember: true` from previous approvals
- [ ] 补齐白名单命中与未命中测试。
  - Unit tests for PermissionChecker
  - Integration tests for full permission flow

**Priority**: P0 - MVP Blocker
**Estimated**: 2-3 days
**Status**: NOT STARTED
**Dependencies**: T1
**Key Files**:
- CREATE: `src/main/presenter/deepchatAgentPresenter/permissionChecker.ts`
- MODIFY: `src/main/presenter/deepchatAgentPresenter/dispatch.ts`
- MODIFY: `src/main/presenter/newAgentPresenter/index.ts`

## T4 Full access 边界控制 🔴 P0 CRITICAL

- [ ] 实现自动通过逻辑（仅对 `projectDir` 内操作）。
  - **File**: `src/main/presenter/deepchatAgentPresenter/permissionChecker.ts`
  - Check `session.permission_mode === 'full'`
  - If full access: auto-approve tools within projectDir
- [ ] 实现路径归一化与越界检测。
  - Normalize paths (resolve `..`, `.`, symlinks)
  - Check if resolved path starts with `session.projectDir`
  - Reject if outside boundary
- [ ] 越界请求返回拒绝事件与可见反馈。
  - Add error block to message
  - Emit `STREAM_EVENTS.ERROR` with "Operation outside project directory" message
- [ ] 补齐越界绕过测试（相对路径、软链接、`..`）。
  - Test cases: `../secret.txt`, `./../../etc/passwd`, symlink escapes

**Priority**: P0 - MVP Blocker
**Estimated**: 1-2 days
**Status**: NOT STARTED
**Dependencies**: T1, T3

## T5 Workspace 与会话绑定 ✅ P0 COMPLETE

- [x] 工具执行上下文绑定 `session.projectDir`。
  - **Status**: COMPLETE - `newAgentPresenter.createSession()` passes projectDir
- [x] 统一传递 `conversationId = sessionId`。
  - **Status**: COMPLETE - `deepchatAgentPresenter.processStream()` uses sessionId throughout
- [x] 权限与消息归属链路统一按 `sessionId` 路由。
  - **Status**: COMPLETE - All new architecture uses sessionId

**Priority**: P0 - COMPLETE
**Status**: ✅ DONE
**Notes**: Infrastructure is solid, just needs permission integration (T3, T4)

## T6 编辑历史 user 消息 🟡 P1 HIGH

- [ ] 实现 `editUserMessage(sessionId, messageId, newContent)`。
  - **File**: `src/main/presenter/newAgentPresenter/index.ts`
  - **IPC**: Add `editUserMessage(sessionId, messageId, newContent)` method
  - Validate: only user messages can be edited
- [ ] 执行"编辑点后消息截断"。
  - **File**: `src/main/presenter/deepchatAgentPresenter/messageStore.ts`
  - Add `deleteMessagesAfter(messageId)` method
  - Delete all messages with `orderSeq > editedMessage.orderSeq`
- [ ] 自动触发 regenerate 并同步状态。
  - Call `processMessage(sessionId, newContent)` after edit
  - Set session status to 'generating'
- [ ] 补齐编辑后上下文正确性测试。
  - Test: edit message, verify subsequent messages deleted
  - Test: regenerate produces new assistant response
  - Test: message boundaries correct

**Priority**: P1 - High (Core functionality)
**Estimated**: 1-2 days
**Status**: NOT STARTED
**Dependencies**: T5 (session binding)
**Frontend**: Add edit action to user message context menu in MessageList

## T7 Retry/Regenerate（无 variants） 🟡 P1 HIGH

- [ ] 移除或短路 variants 路径。
  - **Note**: New architecture doesn't have variants - already clean
  - Old: `agentPresenter.retryMessage()` created variants
  - New: Must create NEW assistant message (not replace)
- [ ] 实现 retry/regenerate 追加 assistant 消息。
  - **File**: `src/main/presenter/newAgentPresenter/index.ts`
  - **IPC**: Add `retryMessage(sessionId, messageId)` method
  - Find the assistant message by messageId
  - Create new assistant message with same context
  - Call `processStream()` to generate new response
- [ ] 使用消息边界控制上下文收敛。
  - Mark message boundary to avoid context pollution
  - Ensure only messages up to retry point are used
- [ ] 补齐多次 retry 的上下文一致性测试。
  - Test: retry 3 times → 3 assistant messages created
  - Test: context uses correct message history
  - Test: each retry independent

**Priority**: P1 - High (Core functionality)
**Estimated**: 1-2 days
**Status**: NOT STARTED
**Dependencies**: T5 (session binding)
**Frontend**: Add retry action to assistant message context menu

## T8 Fork 🟡 P1 HIGH

- [ ] 实现 `forkSessionFromMessage(sessionId, messageId)`。
  - **File**: `src/main/presenter/newAgentPresenter/index.ts`
  - **IPC**: Add `forkSessionFromMessage(sessionId, messageId)` method
  - Get all messages up to and including messageId
  - Create new session with copied messages
  - Copy session config (provider, model, permissionMode, etc.)
- [ ] 切点包含当前 assistant 消息本身。
  - Include the assistant message at fork point
  - New session can continue from that point
- [ ] fork 后新 session 可继续发送与生成。
  - Initialize new session with deepchatAgentPresenter
  - Enable sending messages and generating responses
- [ ] 补齐 fork 前后消息隔离测试。
  - Test: fork creates independent session
  - Test: messages in forked session don't affect original
  - Test: can continue conversation in forked session

**Priority**: P1 - High (Core functionality)
**Estimated**: 1-2 days
**Status**: NOT STARTED
**Dependencies**: T1 (session model), T5 (session binding)
**Frontend**: Add fork action to assistant message context menu

## T9 设置收敛 🟢 P2 MEDIUM

- [ ] 下线 conversation settings 入口与依赖逻辑。
  - **Status**: PARTIAL - old settings still exist in parallel
  - Remove conversation settings UI from ChatPage
  - Migrate to session-level config
- [ ] 将 agent 默认配置下沉到 session 存储。
  - **File**: `src/main/presenter/newAgentPresenter/index.ts`
  - Extend `CreateSessionInput` to include:
    - `temperature?: number`
    - `contextLength?: number`
    - `maxTokens?: number`
    - `systemPrompt?: string`
  - Store in session record or separate config table
- [ ] 清理 legacy settings 读取/写入路径。
  - Remove references to old CONVERSATION_SETTINGS
  - Migrate to new session config

**Priority**: P2 - Medium (Can use defaults for MVP)
**Estimated**: 3-5 days
**Status**: PARTIALLY COMPLETE - defaults work, advanced config missing
**Dependencies**: T1 (session model extension)

## T10 移除 chat 模式 🟢 P2 MEDIUM

- [ ] 类型层移除 `chat`。
  - Remove `chatMode` from types
  - Remove legacy chat-specific code paths
- [ ] presenter/UI 中移除 chat 分支。
  - Clean up agentPresenter/sessionPresenter
  - Remove chat mode conditionals
- [ ] 旧 chat 数据兼容迁移验证通过。
  - **Strategy**: Dual-read during transition
  - When old session opened, migrate on-demand to new tables
  - Or maintain read-only compatibility layer

**Priority**: P2 - Medium (Can coexist for now)
**Estimated**: 1 week
**Status**: NOT STARTED
**Dependencies**: T6, T7, T8 (message operations)
**Risk**: Breaking old session compatibility - must test thoroughly

## T11 质量门槛

- [ ] `pnpm run format`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] 关键单测与集成测试通过

**Required Tests**:
1. Permission flow integration test
2. Whitelist matching test
3. Full access boundary test
4. Edit message test
5. Retry/regenerate test
6. Fork session test

**Status**: PENDING - depends on T1-T10 completion
