# 代码导航指南

本文档只列当前仍然有效的入口。对于 main kernel refactor 覆盖的 migrated path，先看 typed boundary，再往 presenter/runtime 深入，不要一上来就从 legacy presenter 搜。

`phase5` 之后，如果你在 renderer 做新功能，默认心智模型应当是 single-track：
先看 `renderer/api`、shared contracts 和 typed events，再看 main route/runtime；
不要把 `usePresenter()`、`window.electron`、`window.api` 当作默认开发入口。

## 先从哪里开始

如果你要追当前 migrated chat path，按这个顺序跳：

1. `src/shared/contracts/routes.ts`
2. `src/shared/contracts/events.ts`
3. `src/preload/createBridge.ts`
4. `src/renderer/api/`
5. `src/main/routes/index.ts`
6. `src/main/routes/sessions/sessionService.ts`
7. `src/main/routes/chat/chatService.ts`
8. `src/main/routes/providers/providerService.ts`
9. `src/main/routes/hotPathPorts.ts`
10. `src/main/presenter/agentSessionPresenter/index.ts`
11. `src/main/presenter/agentRuntimePresenter/index.ts`

## 按边界找代码

### Renderer-main boundary

| 功能 | 位置 | 备注 |
| --- | --- | --- |
| route registry 总入口 | `src/shared/contracts/routes.ts` | 汇总 settings / sessions / chat / providers / system route |
| typed event 总入口 | `src/shared/contracts/events.ts` | 汇总 `settings.changed`、`sessions.updated`、`chat.stream.*` |
| preload bridge builder | `src/preload/createBridge.ts` | 统一 `invoke/on` 协议 |
| preload 暴露点 | `src/preload/index.ts` | 把 bridge 暴露到 `window.deepchat` |
| renderer clients | `src/renderer/api/` | migrated path 的 renderer 主入口 |

### Settings

| 功能 | 位置 | 备注 |
| --- | --- | --- |
| settings route dispatch | `src/main/routes/index.ts` | `settings.getSnapshot` / `settings.listSystemFonts` / `settings.update` |
| settings handler | `src/main/routes/settings/settingsHandler.ts` | schema parse + orchestration |
| settings adapter | `src/main/routes/settings/settingsAdapter.ts` | 对接 `configPresenter` |
| settings renderer store | `src/renderer/src/stores/uiSettingsStore.ts` | 通过 `SettingsClient` 读写和订阅 |

### Session / Chat orchestration

| 功能 | 位置 | 备注 |
| --- | --- | --- |
| session route dispatch | `src/main/routes/index.ts` | `sessions.create` / `restore` / `activate` / `deactivate` / `getActive` |
| session orchestration | `src/main/routes/sessions/sessionService.ts` | `Scheduler` + session/message repositories |
| chat route dispatch | `src/main/routes/index.ts` | `chat.sendMessage` / `stopStream` / `respondToolInteraction` |
| chat orchestration | `src/main/routes/chat/chatService.ts` | send / stop / permission response owner |
| scheduler | `src/main/routes/scheduler.ts` | timeout / retry / abort 统一入口 |
| presenter-backed ports | `src/main/routes/hotPathPorts.ts` | route services 依赖的最小 runtime port |

### Provider / Permission

| 功能 | 位置 | 备注 |
| --- | --- | --- |
| provider routes | `src/main/routes/index.ts` | `providers.listModels` / `providers.testConnection` |
| provider orchestration | `src/main/routes/providers/providerService.ts` | provider query / test boundary |
| provider runtime ports | `src/main/presenter/runtimePorts.ts` | provider catalog / execution port 定义 |
| provider renderer store | `src/renderer/src/stores/providerStore.ts` | 通过 `ProviderClient` 触发验证和模型查询 |
| permission interaction UI | `src/renderer/src/pages/ChatPage.vue` | 通过 `ChatClient.respondToolInteraction` 响应 |

### Runtime / persistence

| 功能 | 位置 | 备注 |
| --- | --- | --- |
| session runtime entry | `src/main/presenter/agentSessionPresenter/index.ts` | window/session 绑定、runtime delegation、legacy import |
| message runtime entry | `src/main/presenter/agentRuntimePresenter/index.ts` | `processMessage()`、暂停恢复、stream 生命周期 |
| 主循环 | `src/main/presenter/agentRuntimePresenter/process.ts` | stream + tool loop |
| 工具调度 | `src/main/presenter/agentRuntimePresenter/dispatch.ts` | tool call / paused interaction |
| 流式 echo | `src/main/presenter/agentRuntimePresenter/echo.ts` | typed `chat.stream.*` 事件与增量回显 |
| runtime store | `src/main/presenter/agentRuntimePresenter/sessionStore.ts` / `messageStore.ts` / `pendingInputStore.ts` | session/message/pending input persistence |

### Tool system / provider internals

| 功能 | 位置 | 备注 |
| --- | --- | --- |
| 工具主入口 | `src/main/presenter/toolPresenter/index.ts` | `getAllToolDefinitions()` / `callTool()` |
| agent tools | `src/main/presenter/toolPresenter/agentTools/` | 文件系统、命令、settings 等本地工具 |
| MCP tools | `src/main/presenter/mcpPresenter/toolManager.ts` | 外部工具调用 |
| provider facade | `src/main/presenter/llmProviderPresenter/index.ts` | provider instance + stream state |
| ACP runtime | `src/main/presenter/llmProviderPresenter/acp/` | process/session/persistence/config |

### 兼容与历史数据

| 功能 | 位置 | 备注 |
| --- | --- | --- |
| legacy import | `src/main/presenter/agentSessionPresenter/legacyImportService.ts` | 旧数据导入新表 |
| legacy 会话兼容 | `src/main/presenter/sessionPresenter/index.ts` | main 内部 compatibility/data layer |
| 用户消息格式化 | `src/main/presenter/sessionPresenter/messageFormatter.ts` | exporter 复用 |

## 搜索建议

优先用 `rg`：

```bash
rg "chatSendMessageRoute|chatStopStreamRoute|chatRespondToolInteractionRoute" src
rg "dispatchDeepchatRoute|registerMainKernelRoutes" src/main/routes
rg "createPresenterHotPathPorts|ProviderExecutionPort|SessionPermissionPort" src/main
rg "settingsChangedEvent|sessionsUpdatedEvent|chatStream" src/shared src/main src/renderer
```

## 看到这些词时怎么理解

| 词 | 当前含义 |
| --- | --- |
| `renderer/api/*Client` | migrated renderer boundary 的一线入口 |
| `src/main/routes/*` | migrated settings/session/chat/provider path 的 active owner |
| `agentSessionPresenter` | presenter-backed runtime collaborator，不是 migrated renderer 的直连入口 |
| `agentRuntimePresenter` | 当前聊天 runtime 与持久化 owner |
| `SessionPresenter` | legacy conversation 兼容层，不是 migrated chat 主链路 |
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
