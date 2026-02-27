# AgentPresenter 全量替换（MVP）任务清单

## T0 规格冻结

- [ ] 移除并确认无 `[NEEDS CLARIFICATION]`。
- [ ] 锁定 MVP 范围：权限、workspace、编辑、retry/regenerate、fork。
- [ ] 明确本轮不做 variants。

## T1 Session 权限模型

- [ ] 为 `new_sessions` 增加 `permission_mode` 字段（默认 `default`）。
- [ ] session manager 增加读写 `permission_mode` 能力。
- [ ] 补齐迁移与回填策略测试。

## T2 ChatStatusBar 权限接入

- [ ] `ChatStatusBar` 接入 `Default/Full access` 选择与展示。
- [ ] session `projectDir` 为空时禁用 `Full access`。
- [ ] `Full access` 禁用态提示“先绑定 workspace”。
- [ ] 选择结果写回 session 并可恢复。

## T3 Default 权限流程

- [ ] 新链路接入权限请求消息块与审批动作。
- [ ] 实现 session 级白名单存储与查询。
- [ ] 白名单匹配规则为 `toolName + pathPattern`。
- [ ] 补齐白名单命中与未命中测试。

## T4 Full access 边界控制

- [ ] 实现自动通过逻辑（仅对 `projectDir` 内操作）。
- [ ] 实现路径归一化与越界检测。
- [ ] 越界请求返回拒绝事件与可见反馈。
- [ ] 补齐越界绕过测试（相对路径、软链接、`..`）。

## T5 Workspace 与会话绑定

- [ ] 工具执行上下文绑定 `session.projectDir`。
- [ ] 统一传递 `conversationId = sessionId`。
- [ ] 权限与消息归属链路统一按 `sessionId` 路由。

## T6 编辑历史 user 消息

- [ ] 实现 `editUserMessage(sessionId, messageId, newContent)`。
- [ ] 执行“编辑点后消息截断”。
- [ ] 自动触发 regenerate 并同步状态。
- [ ] 补齐编辑后上下文正确性测试。

## T7 Retry/Regenerate（无 variants）

- [ ] 移除或短路 variants 路径。
- [ ] 实现 retry/regenerate 追加 assistant 消息。
- [ ] 使用消息边界控制上下文收敛。
- [ ] 补齐多次 retry 的上下文一致性测试。

## T8 Fork

- [ ] 实现 `forkSessionFromMessage(sessionId, messageId)`。
- [ ] 切点包含当前 assistant 消息本身。
- [ ] fork 后新 session 可继续发送与生成。
- [ ] 补齐 fork 前后消息隔离测试。

## T9 设置收敛

- [ ] 下线 conversation settings 入口与依赖逻辑。
- [ ] 将 agent 默认配置下沉到 session 存储。
- [ ] 清理 legacy settings 读取/写入路径。

## T10 移除 chat 模式

- [ ] 类型层移除 `chat`。
- [ ] presenter/UI 中移除 chat 分支。
- [ ] 旧 chat 数据兼容迁移验证通过。

## T11 质量门槛

- [ ] `pnpm run format`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] 关键单测与集成测试通过
