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
