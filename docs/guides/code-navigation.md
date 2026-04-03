# 代码导航指南

本文档只列当前仍然有效的入口。legacy `AgentPresenter` 导航信息已经归档。

## 先从哪里开始

如果你要追主聊天链路，按这个顺序跳：

1. `src/main/presenter/index.ts`
2. `src/main/presenter/newAgentPresenter/index.ts`
3. `src/main/presenter/deepchatAgentPresenter/index.ts`
4. `src/main/presenter/deepchatAgentPresenter/process.ts`
5. `src/main/presenter/deepchatAgentPresenter/dispatch.ts`

## 按功能找代码

### 会话创建与激活

| 功能 | 位置 | 备注 |
| --- | --- | --- |
| 创建会话 | `src/main/presenter/newAgentPresenter/index.ts` | `createSession()` |
| ACP draft 会话 | `src/main/presenter/newAgentPresenter/index.ts` | `ensureAcpDraftSession()` |
| session 记录管理 | `src/main/presenter/newAgentPresenter/sessionManager.ts` | `create/get/delete/bindWindow` |
| agent 注册 | `src/main/presenter/newAgentPresenter/agentRegistry.ts` | `register/resolve` |

### 消息发送与流式处理

| 功能 | 位置 | 备注 |
| --- | --- | --- |
| 发送消息入口 | `src/main/presenter/newAgentPresenter/index.ts` | `sendMessage()` |
| agent runtime 入口 | `src/main/presenter/deepchatAgentPresenter/index.ts` | `processMessage()` |
| 主循环 | `src/main/presenter/deepchatAgentPresenter/process.ts` | stream + tool loop |
| 工具调度 | `src/main/presenter/deepchatAgentPresenter/dispatch.ts` | tool call / paused interaction |
| 上下文构建 | `src/main/presenter/deepchatAgentPresenter/contextBuilder.ts` | history fitting / resume context |
| 流式 echo | `src/main/presenter/deepchatAgentPresenter/echo.ts` | renderer 增量回显 |

### 消息与状态持久化

| 功能 | 位置 | 备注 |
| --- | --- | --- |
| runtime session state | `src/main/presenter/deepchatAgentPresenter/sessionStore.ts` | provider/model/permission/status |
| message persistence | `src/main/presenter/deepchatAgentPresenter/messageStore.ts` | assistant/user message write |
| pending input | `src/main/presenter/deepchatAgentPresenter/pendingInputStore.ts` | 启动后恢复 |
| compaction | `src/main/presenter/deepchatAgentPresenter/compactionService.ts` | 长上下文摘要 |

### 工具系统

| 功能 | 位置 | 备注 |
| --- | --- | --- |
| 统一工具入口 | `src/main/presenter/toolPresenter/index.ts` | `getAllToolDefinitions()` / `callTool()` |
| 名称映射 | `src/main/presenter/toolPresenter/toolMapper.ts` | source routing |
| agent tools 装配 | `src/main/presenter/toolPresenter/agentTools/agentToolManager.ts` | 本地工具注册 |
| 文件系统工具 | `src/main/presenter/toolPresenter/agentTools/agentFileSystemHandler.ts` | read/write/edit/process |
| bash 工具 | `src/main/presenter/toolPresenter/agentTools/agentBashHandler.ts` | shell/background exec |
| settings 工具 | `src/main/presenter/toolPresenter/agentTools/chatSettingsTools.ts` | 会话设置读写 |
| MCP 工具 | `src/main/presenter/mcpPresenter/toolManager.ts` | 外部工具调用 |

### Provider / ACP

| 功能 | 位置 | 备注 |
| --- | --- | --- |
| provider facade | `src/main/presenter/llmProviderPresenter/index.ts` | provider instance + stream state |
| ACP provider | `src/main/presenter/llmProviderPresenter/providers/acpProvider.ts` | ACP runtime provider |
| ACP process/session | `src/main/presenter/llmProviderPresenter/acp/` | process manager / persistence / config |

### 兼容与历史数据

| 功能 | 位置 | 备注 |
| --- | --- | --- |
| legacy import | `src/main/presenter/newAgentPresenter/legacyImportService.ts` | 旧数据导入新表 |
| legacy 会话兼容 | `src/main/presenter/sessionPresenter/index.ts` | main 内部 compatibility layer |
| 用户消息格式化 | `src/main/presenter/sessionPresenter/messageFormatter.ts` | exporter 复用 |

## 搜索建议

优先用 `rg`：

```bash
rg "createSession\\(" src/main
rg "processMessage\\(" src/main/presenter/deepchatAgentPresenter
rg "callTool\\(" src/main/presenter/toolPresenter
rg --files src/main/presenter | rg "newAgentPresenter|deepchatAgentPresenter|agentTools|acp"
```

## 看到这些词时怎么理解

| 词 | 当前含义 |
| --- | --- |
| `newAgentPresenter` | renderer 唯一聊天会话入口 |
| `deepchatAgentPresenter` | 当前聊天 runtime |
| `SessionPresenter` | legacy conversation 兼容层，不是主链路 |
| `agentPresenter` | 已退休；只会出现在 archive 或历史 spec 里 |

## 不要再从这里找主链路

以下内容都已经退休，不应该再作为活跃实现入口：

- `AgentPresenter`
- `startStreamCompletion`
- `agentLoopHandler`
- `streamGenerationHandler`

如果确实需要历史对照，请去：

- `docs/archives/legacy-agentpresenter-architecture.md`
- `docs/archives/legacy-agentpresenter-flows.md`
- `docs/archives/thread-presenter-migration-plan.md`
