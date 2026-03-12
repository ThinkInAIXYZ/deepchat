# DeepChat Architecture

## Current Stack

聊天主链路已经收敛为三层：

1. Renderer
   `src/renderer/src/pages/NewThreadPage.vue`
   `src/renderer/src/pages/ChatPage.vue`
   `src/renderer/src/stores/ui/session.ts`
   `src/renderer/src/stores/ui/message.ts`
   `src/renderer/src/stores/ui/pageRouter.ts`

2. Main session facade
   `src/main/presenter/newAgentPresenter/index.ts`
   负责 session CRUD、tab/webContents 绑定、active session、session export、legacy import 触发与运行时清理。

3. Agent runtime
   `src/main/presenter/deepchatAgentPresenter/index.ts`
   `src/main/presenter/agentRuntime/**`
   负责 deepchat message loop、tool execution、ACP runtime、system env prompt、tool output offload 等。

## Data Model

当前 live 表：
- `new_sessions`
- `new_projects`
- `deepchat_sessions`
- `deepchat_messages`
- `deepchat_message_traces`
- `deepchat_message_search_results`
- `acp_sessions`
- `legacy_import_status`

约束：
- 新备份只打包上面这些现行表。
- `chat.db` 和旧格式 `agent.db` 只作为导入来源。
- 旧 `conversations/messages/message_attachments` 不再是运行时真源。

## Presenter Boundaries

保留的 live presenter：
- `newAgentPresenter`
- `deepchatAgentPresenter`
- `toolPresenter`
- `mcpPresenter`
- `llmProviderPresenter`
- `skillPresenter`
- `sqlitePresenter`

退役的 presenter：
- `agentPresenter`
- `sessionPresenter`

它们的源码和测试已经移到：
- `archive/agent-session-legacy-2026-03-12/`

## Renderer Semantics

当前 UI 主流程统一使用 `session` 语义：
- `useSessionMode()`
- `sessionId`
- `activeSession`

仍允许保留 `conversationId` 的地方：
- 历史导入字段
- MCP/search 兼容 payload
- 底层消息协议中仍复用的标识位

## Runtime Cleanup

`newAgentPresenter` 现在承担原先分散在旧链路里的 cleanup：
- tab/window close 时清理 bound session
- 取消生成中的任务
- 清理 ACP session
- 清理 permission caches

## References

- [architecture/agent-system.md](./architecture/agent-system.md)
- [FLOWS.md](./FLOWS.md)
- [archives/agent-session-cleanup-2026-03-12.md](./archives/agent-session-cleanup-2026-03-12.md)
