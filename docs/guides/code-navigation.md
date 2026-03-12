# Code Navigation

## Renderer Entry

- `src/renderer/src/pages/NewThreadPage.vue`
  新会话创建、ACP draft session、初始参数收集。
- `src/renderer/src/pages/ChatPage.vue`
  当前聊天页，消息展示、工具交互恢复、trace 打开、fork/retry/delete。
- `src/renderer/src/stores/ui/session.ts`
  session list / active session / sendMessage / rename / delete / export。
- `src/renderer/src/stores/ui/message.ts`
  消息拉取、streaming state、renderer event handlers。
- `src/renderer/src/components/chat-input/composables/useSessionMode.ts`
  当前聊天模式选择。

## Main Entry

- `src/main/presenter/index.ts`
  presenter 装配入口。这里只保留新链路 presenter。
- `src/main/presenter/newAgentPresenter/index.ts`
  renderer 对应的 session facade。
- `src/main/presenter/deepchatAgentPresenter/index.ts`
  deepchat agent 主实现。
- `src/main/presenter/agentRuntime/`
  被 deepchat/tool/llm provider 共享的现行 runtime 模块。

## Data Entry

- `src/main/presenter/sqlitePresenter/index.ts`
  当前 DB 初始化、迁移、legacy import 入口。
- `src/main/presenter/sqlitePresenter/tables/newSessions.ts`
  session 基础信息与 `active_skills` 持久化。
- `src/main/presenter/sqlitePresenter/tables/deepchatSessions.ts`
  deepchat runtime/session settings。
- `src/main/presenter/sqlitePresenter/tables/deepchatMessages.ts`
  主消息表。

## Tooling And ACP

- `src/main/presenter/toolPresenter/index.ts`
  统一工具入口。
- `src/main/presenter/mcpPresenter/toolManager.ts`
  MCP tool 路由与权限桥接。
- `src/main/presenter/agentRuntime/acp/agentToolManager.ts`
  ACP/file/process/chat-settings/runtime 工具集合。

## Skills

- `src/main/presenter/skillPresenter/index.ts`
  skill metadata、active skill state、session 绑定。
- `src/main/presenter/skillPresenter/skillExecutionService.ts`
  skill script runtime。
- `src/renderer/src/components/chat-input/composables/useSkillsData.ts`
  renderer session skill state。

## Legacy Archive

不再从 `src` 内查找这些旧入口：
- `agentPresenter`
- `sessionPresenter`

历史代码在：
- `archive/agent-session-legacy-2026-03-12/src/main/presenter/`

排障时先看：
- [../archives/agent-session-cleanup-2026-03-12.md](../archives/agent-session-cleanup-2026-03-12.md)
