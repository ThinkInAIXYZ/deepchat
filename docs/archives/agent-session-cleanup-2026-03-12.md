# Agent/Session Cleanup 2026-03-12

## Goal

把聊天主链路从 UI 到 main 到 data 全面收口到：
- `newAgentPresenter`
- `deepchatAgentPresenter`
- `new_sessions`
- `deepchat_*`

并把旧 `agentPresenter/sessionPresenter` 体系移出 `src`，只保留 legacy import 兼容。

## Archive Location

- `archive/agent-session-legacy-2026-03-12/src`
- `archive/agent-session-legacy-2026-03-12/test`
- `archive/agent-session-legacy-2026-03-12/docs`

archive 内保留：
- 旧 main presenter 源码
- 旧测试
- 清理前的旧架构文档快照

## Main Changes

### Runtime consolidation

保留并迁出的共享 runtime：
- `src/main/presenter/agentRuntime/acp/**`
- `src/main/presenter/agentRuntime/loop/**`
- `src/main/presenter/agentRuntime/message/systemEnvPromptBuilder.ts`
- `src/main/presenter/agentRuntime/message/messageFormatter.ts`
- `src/main/presenter/agentRuntime/tools/questionTool.ts`
- `src/main/presenter/agentRuntime/sessionPaths.ts`

### Presenter removal

从 live container 移除：
- `Presenter.agentPresenter`
- `Presenter.sessionPresenter`
- `Presenter.sessionManager`

旧目录移出：
- `src/main/presenter/agentPresenter`
- `src/main/presenter/sessionPresenter`

### Runtime cleanup ownership

`newAgentPresenter` 接管：
- tab close cleanup
- window close cleanup
- session delete cleanup
- ACP session clear
- permission cache clear

### Skill persistence

`new_sessions` 新增：
- `active_skills TEXT NOT NULL DEFAULT '[]'`

`SkillPresenter` 改为直接读写 `new_sessions.active_skills`。

### Backup and import

新备份行为：
- `database/agent.db` 只包含现行新域表
- 不再打包旧 `conversations/messages/message_attachments`

导入判定：
- new-format `agent.db` -> `DataImporter`
- legacy-format `agent.db` -> `importLegacyChatDb()`
- `chat.db` -> `importLegacyChatDb()`

## UI Changes

保留的页面/主 store：
- `NewThreadPage.vue`
- `ChatPage.vue`
- `stores/ui/session.ts`
- `stores/ui/message.ts`
- `stores/ui/pageRouter.ts`

语义清理：
- `useChatMode` -> `useSessionMode`
- 当前主链路中的本地命名统一收口到 `sessionId`

保留功能：
- skills
- reference preview
- trace
- workspace
- ACP mode
- Nowledge Mem config

## Old-To-New Mapping

| Legacy | Current |
| --- | --- |
| `agentPresenter/index.ts` | `newAgentPresenter/index.ts` + `deepchatAgentPresenter/index.ts` |
| `agentPresenter/acp/**` | `agentRuntime/acp/**` |
| `agentPresenter/loop/toolCallProcessor.ts` | `agentRuntime/loop/toolCallProcessor.ts` |
| `agentPresenter/message/systemEnvPromptBuilder.ts` | `agentRuntime/message/systemEnvPromptBuilder.ts` |
| `agentPresenter/message/messageFormatter.ts` | `agentRuntime/message/messageFormatter.ts` |
| `agentPresenter/tools/questionTool.ts` | `agentRuntime/tools/questionTool.ts` |
| `sessionPresenter/sessionPaths.ts` | `agentRuntime/sessionPaths.ts` |
| `sessionPresenter` session CRUD/binding | `newAgentPresenter` |
| old conversation export | `newAgentPresenter.exportSession()` |

## Debugging Entry Points

当前问题先看：
- session create/activate/delete: `src/main/presenter/newAgentPresenter/index.ts`
- message processing: `src/main/presenter/deepchatAgentPresenter/index.ts`
- tool execution: `src/main/presenter/deepchatAgentPresenter/dispatch.ts`
- ACP/process/fs runtime: `src/main/presenter/agentRuntime/acp/`
- session DB state: `src/main/presenter/sqlitePresenter/tables/newSessions.ts`
- message DB state: `src/main/presenter/sqlitePresenter/tables/deepchatMessages.ts`
- backup/import: `src/main/presenter/syncPresenter/index.ts`

历史问题回溯再看：
- `archive/agent-session-legacy-2026-03-12/`

## Validation Checklist

- live `src` 不再包含 `agentPresenter/sessionPresenter`
- `typecheck` 不再触达旧 presenter 运行时
- 保留的 ACP/runtime 测试已经切到 `agentRuntime`
- archive 不参与 lint/format
