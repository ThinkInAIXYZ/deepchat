# 渲染层启动路由清单

采集方式：用 `shell/spike` 加载真实渲染层（`out/renderer`），把 `window.deepchat.invoke` 全部转发到 Node sidecar，sidecar 记录每一次调用。

复现：

```bash
cd /Users/colab/Documents/deepchat
pnpm exec electron-vite build --outDir out
cd shell/spike
SPIKE_ROUTE_LOG=/tmp/route-log.jsonl go run . -seconds 14 -renderer ../../out/renderer -sidecar ./sidecar/sidecar.mjs
```

一次冷启动共 **53 次调用，29 个不同路由**。

## 调用频次

| 次数 | 路由 | 首次调用入参 |
| --- | --- | --- |
| 9 | `config.getEntries` | `{"keys":["sidebar_group_mode"]}` |
| 5 | `device.getInfo` | `{}` |
| 3 | `config.listCustomPrompts` | `{}` |
| 3 | `mcp.listPrompts` | `{}` |
| 3 | `onboarding.getState` | `{}` |
| 2 | `config.getLanguage` | `{}` |
| 2 | `upgrade.getStatus` | `{}` |
| 2 | `project.getSnapshot` | `{}` |
| 2 | `mcp.listToolDefinitions` | `{}` |
| 2 | `mcp.getClients` | `{}` |
| 2 | `mcp.listResources` | `{}` |
| 1 | `window.getRuntimeIdentity` | `{}` |
| 1 | `settings.getSnapshot` | `{}` |
| 1 | `config.getTheme` | `{}` |
| 1 | `acp.elicitation.list` | `{}` |
| 1 | `window.getCurrentState` | `{}` |
| 1 | `remoteControl.listChannels` | `{}` |
| 1 | `toolchains.getStatus` | `{}` |
| 1 | `mcp.getServers` | `{}` |
| 1 | `mcp.getEnabled` | `{}` |
| 1 | `notification.rendererReady` | `{}` |
| 1 | `providers.listSummaries` | `{}` |
| 1 | `startup.getBootstrap` | `{}` |
| 1 | `sessions.getAgents` | `{}` |
| 1 | `config.resolveDeepChatAgentConfig` | `{"agentId":"deepchat"}` |
| 1 | `skills.listCatalog` | `{"agentId":"deepchat"}` |
| 1 | `orchestration.getCapability` | `{"agentId":"deepchat"}` |
| 1 | `tools.listDefinitions` | `{"chatMode":"agent","agentWorkspacePath":null}` |
| 1 | `sessions.listLightweight` | `{"limit":30,"cursor":null,"includeSubagents":false}` |

## 结论

- 启动路径只需要少量路由，**没有** 依赖 YoBrowser、浮动窗口或 computer use 预览的调用，与阶段 A 的删除结果一致。
- `mcp.*` 合计 9 次调用，是启动时最重的一块；sidecar 化时应优先保证 MCP 的初始化可以延迟，否则冷启动会被它拖慢。
- `device.getInfo` 调用 5 次且入参为空，属于可以缓存的结果。
- 这些路由正好对应平台抽象里的接口：`config.*`、`settings.getSnapshot` 走 `AppHost`/设置存储，`mcp.*` 走 sidecar 内的 MCP 服务，`window.*` 走 `WindowHost`。

## 下一步

1. 让真实 main 进程跑在 sidecar 里，用同一份清单做回归：路由名与入参形状必须一致。
2. MCP 相关路由默认异步越过后再补齐，避免启动阻塞。

## 用真实 sidecar 重放：覆盖率

`DEEPCHAT_ROUTE_LOG=<path>` 会让 sidecar 记录每次调用是否被真实路由服务。用当前实现重放冷启动：

| 指标 | 数值 |
| --- | --- |
| 冷启动调用总数 | 119 次进入 sidecar |
| 被真实路由服务 | **110 次（92.4%）** |
| 落到空实现 | 9 次 |
| 由壳直接回答 | 1 次（`notification.rendererReady`） |

未服务的调用（共 8 条路由）：

| 次数 | 路由 | 原因 |
| --- | --- | --- |
| 2 | `mcp.listToolDefinitions` | 需要 MCP 活连接 |
| 2 | `mcp.getClients` | 同上 |
| 1 | `mcp.listPrompts` | 同上 |
| 1 | `mcp.listResources` | 同上 |
| 1 | `project.getSnapshot` | 需要 `ProjectService` 与工作区状态 |
| 1 | `acp.elicitation.list` | 需要 ACP 运行时 |
| 1 | `remoteControl.listChannels` | 需要远程控制运行时 |

对照上一轮（22 条路由时）是 72/124 次，接入 `settings.*` 与 `mcp.getServerAuthStatus` 后提升到 110/120。

其中 `mcp.getServerAuthStatus` 单条就占了 42 次调用——MCP 指示器会对每个服务器轮询一次，这也是为什么它值得优先实现：只依赖 `McpOAuthManager` 与设置，不需要活连接。

