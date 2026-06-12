# Presenter IPC 迁移改造清单

更新时间：2026-06-12  
当前分支：`codex/presenter-ipc-migration-plan`

## 结论

这次真正要改的不是把所有 presenter 本体推倒重写，而是把 renderer 到 main 的 IPC 边界收口。

目标结构是：

```text
settings / renderer 组件
  -> src/renderer/api/*Client.ts
  -> window.deepchat.invoke/on
  -> src/shared/contracts/routes + events
  -> src/main/routes/*
  -> 现有 presenter 方法
```

也就是说，presenter 仍然是 main 侧业务 owner；要去掉的是 renderer 直接知道
`knowledgePresenter`、`skillSyncPresenter`、`remoteControlPresenter:call`、`window.electron.ipcRenderer`
这些 legacy IPC 细节。

## 当前状态和剩余 Legacy 面

以 2026-06-11 当前工作区扫描为准，settings 业务组件已经不再直接调用
`useLegacyPresenter(...)`、`useLegacyRemoteControlPresenter(...)`、
`useLegacyShortcutPresenter(...)`，也不再直接订阅 settings/notification/ACP/knowledge/skill-sync
等旧 IPC 事件。

当前仍保留的 raw IPC 只在这些 preload/bridge 边界：

| 类型 | 文件 | 保留原因 |
| --- | --- | --- |
| typed bridge 内部实现 | `src/preload/createBridge.ts` | 这是 `window.deepchat.invoke/on` 的底层桥，不属于业务 legacy 调用。 |
| preload runtime id | `src/preload/index.ts` | 仍用 `sendSync('get-window-id')` / `sendSync('get-web-contents-id')` 暴露窗口上下文，后续应并入窄 preload runtime API。 |
| plugin settings 专用 preload | `src/preload/plugin-settings-preload.ts` | 用 `createBridge(ipcRenderer)` 包成 `window.deepchatPlugin`，仍是 typed route backed。 |
| 启动/解锁窗口 preload | `src/preload/splash-preload.ts` | splash 可能早于完整 presenter route runtime 启动；renderer 只使用 `window.deepchatSplash`；preload 边界已通过单测覆盖，真实加密库解锁仍需隔离 profile 验证。 |
| 悬浮窗专用 preload | `src/preload/floating-preload.ts` | 使用 shared channel 常量、payload 校验和 scoped unsubscribe。 |
| browser overlay preload | `src/preload/browser-overlay-preload.ts` | 专用 overlay API，已用 shared event schema 校验 activity payload。 |

初始审计中发现的 settings 侧缺口，目前状态如下：

| 初始 legacy 域 | 当前状态 |
| --- | --- |
| `knowledgePresenter` | 已迁移到 `knowledge.*` routes、`knowledge.file.*` typed events、`KnowledgeClient`。 |
| `skillSyncPresenter` | 已迁移到 `skillSync.*` routes/events、`SkillSyncClient`。 |
| `remoteControlPresenter:call` | `RemoteSettings` 已迁移到 `remoteControl.*` routes、`RemoteControlClient`；main 兼容 handler 已删除。 |
| `agentSessionPresenter` | Dashboard/Remote agent list 已迁移到 `SessionClient` typed routes。 |
| MCP Router | 已迁移到 `mcp.router.*` routes 和 `McpClient`。 |
| GitHub Copilot OAuth | 已迁移到 `oauth.githubCopilot.*` routes 和 `OAuthClient`。 |
| NowledgeMem/exporter | 已迁移到 `nowledgeMem.*` routes 和 `NowledgeMemClient`。 |
| `sqlitePresenter.repairSchema` | 已迁移到 `databaseSecurity.repairSchema` route。 |
| `yoBrowserPresenter.clearSandboxData` | 已迁移到 `browser.clearSandboxData` route。 |
| `skillPresenter.readSkillFile` | 已迁移到 `skills.readFile` route。 |
| Settings/notification/ACP terminal 旧事件 | 已迁移到 `WindowClient`、`AcpTerminalClient` 和 typed events。 |

自动化迁移 gate 已经收口；剩余不是代码路径，而是需要真实外部服务/本机状态的人工验证记录，
例如 GitHub Copilot OAuth、Remote Control 真实账号绑定、MCP Router 安装、NowledgeMem live
connection、真实 profile 数据库修复、browser sandbox reset、使用隔离加密 profile 的 splash
数据库解锁。

## 分层改造

### 1. Shared contracts

要在 `src/shared/contracts/routes/*.routes.ts` 和 `src/shared/contracts/events/*.events.ts`
为每个剩余域补 route/event contract。每个 route 必须定义：

- `name`
- `input` schema
- `output` schema
- renderer 看到的 domain 名，而不是 presenter 名

例子：

| 旧 presenter 方法 | 新 route |
| --- | --- |
| `knowledgePresenter.listFiles(id)` | `knowledge.listFiles` |
| `skillSyncPresenter.previewImport(...)` | `skillSync.previewImport` |
| `remoteControlPresenter.createTelegramPairCode()` | `remoteControl.createPairCode` |
| `sqlitePresenter.repairSchema()` | `database.repairSchema` |

事件也一样，renderer 不再听旧通道，而是听 typed event：

| 旧事件 | 新事件 |
| --- | --- |
| `RAG_EVENTS.FILE_UPDATED` | `knowledge.file.updated` |
| `RAG_EVENTS.FILE_PROGRESS` | `knowledge.file.progress` |
| `SKILL_SYNC_EVENTS.NEW_DISCOVERIES` | `skillSync.discoveries.changed` |
| `NOTIFICATION_EVENTS.SHOW_ERROR` | `notifications.errorShown` 或 settings notification domain |

### 2. Main routes

要在 `src/main/routes/index.ts` 或更细的 route handler 中把新 route 接到现有 presenter。

关键点：

- main route runtime 需要注入对应 presenter，例如 `knowledgePresenter`、`skillSyncPresenter`、
  `remoteControlPresenter`。
- route handler 只做输入校验、调用 presenter、输出校验，不把 UI 状态塞进去。
- 涉及当前窗口的 route，例如 settings ready、close、provider install consume，必须使用
  invoking `webContentsId`，不能用“当前 focused window”猜。

### 3. Event bridge

main 内部可以继续用 `EventBus`，但 renderer-visible 事件要统一通过 typed event 发布。

要改 `src/main/routes/legacyTypedEventBridge.ts`：

- 把 `RAG_EVENTS.FILE_UPDATED/FILE_PROGRESS` 映射到 `knowledge.file.updated/progress`。
- 把 `SKILL_SYNC_EVENTS.NEW_DISCOVERIES` 映射到 `skillSync.discoveries.changed`。
- 把 notification/settings/ACP terminal 等旧事件逐步映射到 typed events 或专用 client API。

注意：bridge 是过渡层。最终如果 presenter 直接 publish typed event，bridge 可以删除。

### 4. Renderer API clients

每个域补一个或扩展一个 client，文件放在 `src/renderer/api`。

| 域 | Client |
| --- | --- |
| Knowledge | 新增 `KnowledgeClient.ts` |
| Skill sync | 新增 `SkillSyncClient.ts` |
| Remote control | 新增 `RemoteControlClient.ts`，替代 `RemoteControlRuntime.ts` |
| Agent session dashboard | 扩展 `SessionClient.ts` 或新建 dashboard client |
| MCP Router | 扩展 `McpClient.ts` |
| GitHub Copilot OAuth | 新增 `OAuthClient.ts` 或放到 Provider auth client |
| NowledgeMem | 新增 `NowledgeMemClient.ts` 或归到 exporter/export client |
| Database repair | 扩展 `DatabaseSecurityClient.ts` 或新增 database ops route |
| Browser sandbox | 扩展 `BrowserClient.ts` |
| Skill file read | 扩展 `SkillClient.ts` |

Client 负责把 route 的 envelope 还原成组件需要的老返回形态。这样组件改动最小。

### 5. Renderer 组件

组件里要做的事很机械：

- 删除 `useLegacyPresenter(...)`。
- 删除 `window.electron.ipcRenderer.on/send/removeAllListeners`。
- 改用 `createXxxClient()`。
- 事件订阅统一保存 unsubscribe，在 `onBeforeUnmount/onUnmounted` 调用。
- 不再 `removeAllListeners(oldChannel)`，因为那会误删同通道其他监听者。

### 6. Guard

`scripts/architecture-guard.mjs` 现在已经能拦 settings legacy IPC，并且已有测试证明：

- settings 重新引入 `@api/legacy/presenters` / `useLegacyPresenter` 会失败。
- settings 重新直接监听 `window.electron.ipcRenderer.on(...)` 会失败。
- `src/renderer/api/legacy/**` 被视为已退休路径，重新出现会失败。
- baseline 已重新生成，业务层 legacy 计数为 `0`，剩余例外限定在 preload/bridge 边界。

## Presenter-by-Presenter 改造

### `knowledgePresenter`

旧入口：

- `KnowledgeBaseSettings.vue`: `isSupported`
- `BuiltinKnowledgeSettings.vue`: `getSupportedLanguages`, `getSeparatorsForLanguage`
- `KnowledgeFile.vue`: `getSupportedFileExtensions`, `validateFile`, `addFile`, `deleteFile`,
  `reAddFile`, `listFiles`, `similarityQuery`, `pauseAllRunningTasks`, `resumeAllPausedTasks`
- `KnowledgeFile.vue`, `KnowledgeFileItem.vue`: `RAG_EVENTS.FILE_UPDATED/FILE_PROGRESS`

要改：

- 新增 `src/shared/contracts/routes/knowledge.routes.ts`。
- 新增 `src/shared/contracts/events/knowledge.events.ts`。
- 新增 `src/renderer/api/KnowledgeClient.ts`。
- `src/main/routes/index.ts` 注入 `knowledgePresenter` 并 dispatch `knowledge.*`。
- `legacyTypedEventBridge.ts` 把 RAG 事件映射到 typed event。
- 四个知识库组件改用 `KnowledgeClient`。

测试：

- `test/main/routes/contracts.test.ts`: route/event catalog 包含 `knowledge.*`。
- `test/main/routes/dispatcher.test.ts`: mock `knowledgePresenter`，验证每个 route 调到正确方法。
- `test/renderer/api/clients.test.ts`: `KnowledgeClient` 输入输出和事件 unsubscribe。
- 组件测试：`BuiltinKnowledgeSettings`, `KnowledgeBaseSettings`, `KnowledgeFile`,
  `KnowledgeFileItem`。

副作用：

- `addFile/reAddFile` 会触发 embedding、向量库写入和进度事件。
- `similarityQuery` 会返回已索引内容片段，不能扩大调用面。
- 文件选择和真实文件 path 在单测里很难完全模拟。

人工验证：

- 新建一个内置知识库配置。
- 添加一个支持文件，确认列表出现并有进度。
- 暂停/恢复处理。
- re-add 文件。
- 删除文件。
- 执行一次相似度搜索。
- 上传不支持的文件，确认错误提示仍然正确。

### `skillSyncPresenter`

旧入口：

- `SyncPromptDialog.vue`: `getNewDiscoveries`, `acknowledgeDiscoveries`, `SKILL_SYNC_EVENTS.NEW_DISCOVERIES`
- `SyncStatusSection.vue`: `scanExternalTools`
- `ImportWizard.vue`: `scanExternalTools`, `previewImport`, `executeImport`
- `ExportWizard.vue`: `getRegisteredTools`, `previewExport`, `executeExport`

要改：

- 新增 `skillSync.*` routes。
- 新增 `SkillSyncClient.ts`。
- 新增 typed events：`skillSync.discoveries.changed`，必要时补 scan/import/export progress。
- 组件全部改用 `SkillSyncClient`。

测试：

- route contract 测 tool id、skill name、conflict strategy、export options。
- handler 测 scanner/converter 被正确调用。
- renderer client 测 preview/execute 的输入输出。
- 组件测发现提示、扫描、导入预览、导出预览、冲突策略。

副作用：

- import/export 会读写外部工具目录。
- conflict strategy 一旦传错会覆盖或复制技能文件。
- 外部工具扫描依赖用户机器环境，CI 只能 mock。

人工验证：

- 扫描本机已安装工具。
- 导入一个技能，分别验证 skip/overwrite/rename 等冲突策略。
- 导出一个技能到一个临时外部工具目录。
- 验证“不再提示新发现”仍然生效。

### `remoteControlPresenter`

旧入口：

- `RemoteSettings.vue`: `useLegacyRemoteControlPresenter({ safeCall: false })`
- Telegram/Weixin 兼容方法：settings/status/bindings/pair code/login/restart/remove

要改：

- 新增 `remoteControl.*` routes 和 `RemoteControlClient.ts`。
- 优先用通用 channel route：
  - `remoteControl.listChannels`
  - `remoteControl.getSettings`
  - `remoteControl.saveSettings`
  - `remoteControl.getStatus`
  - `remoteControl.listBindings`
  - `remoteControl.removeBinding`
  - `remoteControl.removePrincipal`
  - `remoteControl.getPairingSnapshot`
  - `remoteControl.createPairCode`
  - `remoteControl.clearPairCode`
- Weixin iLink 保留窄 route：
  - `remoteControl.weixinIlink.startLogin`
  - `remoteControl.weixinIlink.waitLogin`
  - `remoteControl.weixinIlink.removeAccount`
  - `remoteControl.weixinIlink.restartAccount`
- `RemoteSettings.vue` 不再依赖 `RemoteControlRuntime.ts`。
- 最后删除 `remoteControlPresenter:call` handler 和 allowlist。

测试：

- route schema 测 channel enum 和 settings discriminated union。
- handler 测不同 channel 的 presenter 方法映射。
- `RemoteSettings.vue` 组件测保存、状态刷新、配对码、binding 删除。

副作用：

- 远控配置可能包含 token、secret、账号绑定，route output 必须脱敏。
- Weixin 登录是长任务，自动化只能 mock；真实等待流程需要人工测。

人工验证：

- Telegram 保存 token，生成/清除 pair code，删除 binding。
- Feishu/QQBot/Discord 保存配置并刷新状态。
- Weixin iLink 启动登录、等待成功或失败、重启账号、移除账号。

### `agentSessionPresenter`

旧入口：

- `DashboardSettings.vue`: `getUsageDashboard`, `retryRtkHealthCheck`
- `RemoteSettings.vue`: `getAgents`

要改：

- `getAgents` 优先复用已有 `SessionClient.getAgents` 或 `ConfigClient.listAgents`。
- 新增：
  - `sessions.usageDashboard.get`
  - `sessions.rtkHealth.retry`
- `DashboardSettings.vue` 和 `RemoteSettings.vue` 改用 typed client。

测试：

- route handler 测 dashboard 聚合和 retry 调用。
- 组件测试 dashboard loading/error/empty、有数据、RTK retry。
- Remote settings 测 agent 列表加载。

副作用：

- dashboard 可能扫描大量会话，route 要保留现有性能和错误兜底。
- RTK retry 会触发后台检查，必须仍然是用户显式点击。

人工验证：

- 打开有历史会话的 dashboard。
- 点击 RTK retry，确认状态和错误信息刷新。
- Remote settings 的 agent 下拉仍能加载。

### `mcpPresenter` 的 MCP Router 部分

旧入口：

- `McpBuiltinMarket.vue`: `getMcpRouterApiKey`, `setMcpRouterApiKey`,
  `updateMcpRouterServersAuth`, `isServerInstalled`, `listMcpRouterServers`,
  `installMcpRouterServer`

要改：

- 扩展 `McpClient.ts`，新增 `mcp.router.*` routes。
- API key 存储和 server install 仍在 main。
- 安装后继续复用 MCP 配置刷新/服务器状态事件。

测试：

- route contract 测 page/limit/apiKey/serverKey。
- handler mock 网络和安装流程。
- `McpBuiltinMarket.vue` 组件测保存 key、分页、安装按钮状态。

副作用：

- 会访问 MCP Router 网络接口。
- 保存 API key 会写配置。
- 安装 server 会改 MCP server 配置，可能启动进程。

人工验证：

- 保存 MCP Router API key。
- 拉取市场列表。
- 安装一个 server，确认 MCP 设置里出现。

### `oauthPresenter`

旧入口：

- `GitHubCopilotOAuth.vue`: `startGitHubCopilotLogin`, `startGitHubCopilotDeviceFlowLogin`

要改：

- 新增 `oauth.githubCopilot.startLogin` 和 `oauth.githubCopilot.startDeviceFlowLogin`，
  或放到 provider auth domain。
- 新增 `OAuthClient.ts` 或 `ProviderAuthClient.ts`。
- 组件只关心 boolean/result，不直接碰 presenter。

测试：

- handler mock OAuth presenter，验证 providerId 传递。
- 组件测登录成功/失败和 loading 状态。

副作用：

- 会打开浏览器/device flow，写入 provider credential。
- CI 只能 mock shell/deeplink。

人工验证：

- 用 disposable provider/account 跑一次 device flow。
- 如果传统 OAuth 仍保留，也跑一次传统登录。

### `exporter` / NowledgeMem

旧入口：

- `NowledgeMemSettings.vue`: `getNowledgeMemConfig`, `updateNowledgeMemConfig`,
  `testNowledgeMemConnection`

要改：

- 新增 `nowledgeMem.getConfig/updateConfig/testConnection` routes。
- 新增 `NowledgeMemClient.ts`，或放到 export/domain client。
- config schema 要限制 URL、timeout 范围，同时保留现有默认值。

测试：

- route schema 测 timeout bounds 和 URL 字段。
- handler mock exporter。
- 组件测保存、重置、测试连接成功/失败。

副作用：

- test connection 会发网络请求。
- API key 不能泄露到日志或错误详情。

人工验证：

- 配一个本地或 disposable endpoint。
- 验证测试成功、测试失败、保存后刷新仍保留。

### `sqlitePresenter`

旧入口：

- `DataSettings.vue`: `repairSchema`

要改：

- 新增 `database.repairSchema` 或 `databaseSecurity.repairSchema` route。
- 推荐放在 database ops domain，不和 encryption route 混太深。
- `DataSettings.vue` 改用 typed client。

测试：

- handler mock repair report。
- 组件测 repair loading、成功报告、错误状态。

副作用：

- 会修改本地数据库 schema。
- 不能在真实主 profile 上随便人工验证。

人工验证：

- 复制一个测试 profile。
- 在副本上触发 repair。
- 检查报告 UI 和数据库仍能正常打开。

### `yoBrowserPresenter`

旧入口：

- `DataSettings.vue`: `clearSandboxData`

要改：

- 扩展 `BrowserClient.ts`，新增 `browser.clearSandboxData`。
- `DataSettings.vue` 改用 `BrowserClient`。

测试：

- browser route handler mock。
- 组件测清理确认、loading、错误 toast。

副作用：

- 会清浏览器 sandbox/cache。

人工验证：

- 打开 browser 产生 sandbox 数据。
- 清理。
- 再打开确认是干净状态。

### `skillPresenter`

旧入口：

- `SkillEditorSheet.vue`: `readSkillFile`

要改：

- 扩展 `SkillClient.ts`，新增 `skills.readFile`。
- renderer 只能传 skill name/id，路径解析留在 main。

测试：

- schema 拒绝空名和路径穿越形态。
- Skill editor 组件测加载内容。

副作用：

- 文件读取不能扩大到任意路径。

人工验证：

- 打开一个已安装 skill。
- 编辑保存。
- 关闭再打开确认内容仍正确。

### Settings shell / notification / ACP terminal 原始事件

旧入口：

- `settings/App.vue`: settings navigation、provider install、ready、notification。
- `AboutUsSettings.vue`: update check event。
- `AcpTerminalDialog.vue`: `acp-init:*`, `external-deps-required`, `acp-terminal:*`。

已改：

- Settings shell 通过 `WindowClient` typed route/event：
  - `settings.navigateRequested`
  - `settings.providerInstallRequested`
  - `settings.checkForUpdatesRequested`
  - `window.notifySettingsReady`
  - `notification.error`
  - `databaseSecurity.repairSuggested`
- About 更新检查订阅 `WindowClient.onSettingsCheckForUpdates()`。
- `AcpSettings.vue` 的 agent reload 订阅 `ConfigClient.onAgentsChanged()`。
- `SkillsSettings.vue` 的 skill catalog reload 订阅 `SkillClient.onCatalogChanged()`。
- ACP terminal 新增专用 `AcpTerminalClient`：
  - `acpTerminal.input`
  - `acpTerminal.kill`
  - `acpTerminal.started/output/exited/error`
  - `acpTerminal.externalDependenciesRequired`

测试：

- settings app 事件订阅测试已更新。
- About update check 组件测试已更新。
- ACP terminal route/client 已由 contracts、dispatcher、client 测试覆盖。
- 证据：
  - `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/SettingsApp.test.ts test/renderer/components/SettingsApp.providerDeeplink.test.ts test/renderer/components/AboutUsSettings.test.ts`
  - `pnpm exec vitest run test/main/routes/contracts.test.ts test/main/routes/dispatcher.test.ts test/renderer/api/clients.test.ts test/renderer/components/AcpSettings.test.ts`

副作用：

- settings provider deeplink 可能发生在 settings window 打开之前，需要保留 pending 消费语义。
- ACP terminal 是长连接/子进程输出流，事件 payload 要小且稳定。

人工验证：

- provider deeplink 打开 settings 并进入安装预览。
- settings 内跳转目标 section 正常。
- About 页外部触发 check update 正常。
- ACP terminal 初始化、输出、输入、kill、依赖缺失提示正常。

### 当前仍保留的 raw IPC 例外

保留项：

- `src/preload/createBridge.ts`
- `src/preload/index.ts`
- `src/preload/plugin-settings-preload.ts`
- `src/preload/splash-preload.ts`
- `src/preload/floating-preload.ts`
- `src/preload/browser-overlay-preload.ts`

为什么保留：

- splash 是启动期窗口，数据库解锁可能发生在 presenter route runtime 可用之前。
- floating/browser overlay/plugin settings 是专用 preload API，不是业务组件直接调用 presenter。
- `createBridge` 是 typed route/event 的底层实现。
- `src/preload/index.ts` 仍提供窄 `window.api` runtime helper 和同步窗口 ID 获取。

本轮已完成：

- splash 建立 `window.deepchatSplash` 专用 API，renderer 不再暴露通用 `window.electron`。
- floating/browser overlay 完成 channel 常量共享和 payload validation。
- 删除 `remoteControlPresenter:call`、generic `presenter:call` 和
  `src/renderer/api/legacy/**`。

## Legacy Transport 删除后的最终验证条件

删除已完成；当前验证状态如下。

已通过：

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run build`
- 全量 `pnpm test -- --silent --reporter=dot`：376 个文件通过，6 个跳过；3175 个测试通过，
  41 个跳过。
- 聚焦迁移测试：13 个文件 / 130 个测试通过。
- Electron smoke e2e：启动应用、settings control center navigation 两个用例通过。
- Electron settings IPC boundary e2e：真实 settings 窗口确认 `window.deepchat.invoke/on` 存在、
  broad `window.electron` / `api.ipcRenderer` 不暴露，`presenter:call` 被拒绝，并打开
  knowledge、skills、remote、MCP、data 五个迁移后的设置页。
- Electron main renderer IPC boundary e2e：真实主聊天窗口确认 `window.deepchat.invoke/on` 存在，
  可调用 typed `device.getAppVersion` route，broad `window.electron` / `api.ipcRenderer` 不暴露，
  `presenter:call` 被拒绝。
- Electron Data Settings privacy mode e2e：真实 Data Settings 页面点击 Privacy Mode 开关，
  验证 `settings.getSnapshot/settings.update` typed route 状态变化，并在用例结束前恢复原始
  `privacyModeEnabled` 值。
- Electron Remote Control read-only route e2e：真实 Remote Settings 页面切换 Telegram、Feishu、
  QQBot、Discord、Weixin iLink 五个 channel tab，并对每个 channel 读取
  `remoteControl.listChannels/getChannelSettings/getChannelStatus/getChannelBindings`，不需要真实远控账号，
  也不修改远控配置。
- RemoteControl runtime 收口：`WindowSideBar` 已直接使用 `RemoteControlClient` 读取主窗口远控状态，
  `src/renderer/api/RemoteControlRuntime.ts` 已删除。聚焦验证中，`WindowSideBar`/`RemoteSettings`/
  route/client 相关单测 5 个文件 126 个测试通过；真实主窗口 e2e 现在额外读取
  `remoteControl.listChannels/getChannelStatus`，并和 Remote Settings 只读 e2e 一起串行通过。
- Upgrade raw update 事件收口：`upgradePresenter` 不再向 renderer 发送旧的
  `update:status-changed`、`update:error`、`update:progress`、`update:will-restart` raw channel；
  renderer 只通过 `UpgradeClient` 接收 typed `upgrade.status.changed`、`upgrade.progress`、
  `upgrade.willRestart`、`upgrade.error` 事件。`UPDATE_EVENTS` 现在只剩 main 内部
  `update:state-changed`，用于 upgrade/lifecycle 之间的更新中状态同步。聚焦单测 4 个文件 64 个测试通过，
  旧 raw update 事件名源码扫描无命中。
- Dialog raw 事件收口：`DialogPresenter.showDialog` 不再发送旧的 `dialog:request` raw channel；
  renderer dialog store 只通过 typed `dialog.requested` 打开全局对话框，并继续通过
  `dialog.respond/dialog.error` typed routes 回传结果。聚焦验证中，presenter、route、client、store
  相关 5 个文件 82 个测试通过；`dialog:request/dialog:response` 源码扫描无命中。
- Workspace invalidation 收口：`WorkspacePresenter` watcher 不再发送旧的
  `workspace:files-changed` raw channel，只发送 typed `workspace.invalidated`。聚焦验证中，
  workspace presenter watcher、route、client 相关 4 个文件 94 个测试通过；
  `workspace:files-changed` 源码扫描无命中。真实主窗口 e2e 通过 `workspace.register` 读取当前仓库的
  `workspace.readDirectory/searchFiles/getGitStatus`，并在 `finally` unregister；不启动 watcher、不打开文件、
  不调用 OS reveal。
- Device reset 完成通知收口：`DevicePresenter` 的开发环境 reset 完成分支不再发送旧的
  `notification:data-reset-complete-dev` raw channel，而是直接发布 typed
  `appRuntime.dataResetCompleteDev`。`WindowPresenter` 里对应的旧通道翻译 case 已删除，main/renderer
  `NOTIFICATION_EVENTS.DATA_RESET_COMPLETE_DEV` 常量已删除，源码扫描无命中。聚焦单测覆盖 presenter、
  route、client、Data Settings 相关 5 个文件 103 个测试；真实 Data Settings 只读 e2e 与
  `01-launch`、`06-settings-ipc-boundary` 串行运行通过。实际点击 reset data 会删除用户数据，仍只在
  disposable profile 里人工验证。
- System notification click 收口：`NotificationPresenter` 在 Electron 系统通知被点击时，不再发旧的
  `notification:sys-notify-clicked` raw channel，而是直接发布 typed
  `appRuntime.systemNotificationClicked`，payload 形态保持 `{ payload: id }`。`WindowPresenter`
  对应旧通道翻译 case 已删除，main/renderer 的 `NOTIFICATION_EVENTS` 常量也已删除。聚焦单测 4 个文件
  67 个测试通过，真实主窗口 `01-launch` + `09-main-ipc-boundary` e2e 串行通过。真实 OS 通知展示和点击
  依赖系统通知权限，仍作为平台人工验证项。
- Ollama pull progress 收口：`OllamaManager` 不再双发旧的 `ollama:pull-model-progress` raw event，
  只发布 typed `providers.ollama.pull.progress`。renderer 已通过 `ProviderClient.onOllamaPullProgress`
  和 `ollamaStore` 消费该事件；main/renderer 的 `OLLAMA_EVENTS` 常量已删除，源码扫描无命中。聚焦单测
  4 个文件 58 个测试通过，真实 Model Providers 只读 e2e 与 `01-launch`、`06-settings-ipc-boundary`
  串行通过。真实拉取模型依赖本机 Ollama daemon 和网络/本地模型缓存，仍作为 opt-in 手测项。
- Skill catalog/session 收口：`SkillPresenter` 不再双发旧的 `skill:discovered`、
  `skill:installed`、`skill:uninstalled`、`skill:metadata-updated`、`skill:activated`、
  `skill:deactivated` raw event，只发布 typed `skills.catalog.changed` 和
  `skills.session.changed`。`McpIndicator`、skills store 和 settings 已经通过 `SkillClient` 消费 typed
  event；main/renderer 的 `SKILL_EVENTS` 常量已删除，源码和测试扫描无命中。聚焦单测 5 个文件 151 个测试通过，
  真实 Skills 设置页只读 e2e 与 `01-launch`、`06-settings-ipc-boundary` 串行通过。安装/卸载/编辑技能会写磁盘，
  仍作为人工或专项 e2e。
- YoBrowser lifecycle/open 收口：`YoBrowserPresenter` 不再双发旧的 `yo-browser:*` raw event，只发布
  typed `browser.status.changed`、`browser.open.requested` 和 `browser.activity.changed`。旧的
  `yo-browser:window-count-changed` 没有业务消费方，直接退休，不补 typed 替代。`BrowserPanel` 测试也改成
  typed event 名称；main/renderer 的 `YO_BROWSER_EVENTS` 常量已删除，源码和测试扫描无命中。聚焦单测
  4 个文件 71 个测试通过；真实 browser route e2e 通过。`01-launch`、`06-settings-ipc-boundary`
  单跑通过，三用例组合里 `06` 曾出现 app fixture setup 超时，按既有 e2e harness 抖动记录。
- MCP sampling 收口：`McpPresenter` 不再双发旧的 `mcp:sampling-request`、
  `mcp:sampling-decision`、`mcp:sampling-cancelled` raw channel，只发布 typed
  `mcp.sampling.request`、`mcp.sampling.decision`、`mcp.sampling.cancelled`。`McpClient` 和
  `mcpSampling` store 已经消费 typed event；main/renderer 事件常量里的 sampling 三项已删除，源码和测试扫描无命中。
  聚焦单测 4 个文件 68 个测试通过，真实 MCP Settings 只读 e2e 与 `01-launch`、
  `06-settings-ipc-boundary` 串行运行通过。真实 approve/reject/cancel sampling 弹窗链路需要一个会发
  sampling 请求的测试 MCP server 和可运行模型路径，仍作为人工或未来专项 e2e。
- Config font-size 收口：`ConfigPresenter.setSetting('fontSizeLevel', value)` 不再发送旧的
  `config:font-size-changed` raw channel，只通过 typed `settings.changed` 通知 renderer。`uiSettingsStore`
  已经从 `SettingsClient.onChanged` 消费 typed event 并同步 `fontSizeClass`；main/renderer 的
  `FONT_SIZE_CHANGED` 常量已删除，源码和测试扫描无命中。聚焦单测 6 个文件 88 个测试通过，真实
  config/settings 只读 e2e 与 `01-launch`、`06-settings-ipc-boundary` 串行运行通过。真实 Display
  Settings 中调大/调小字体并确认主窗口/设置窗口 class 同步，仍作为人工或未来专项 e2e。
- NowledgeMem config 收口：`ConfigPresenter.setNowledgeMemConfig` 不再发送旧的
  `config:nowledge-mem-config-updated` raw channel；NowledgeMem 设置页保存/读取完全通过
  `nowledgeMem.updateConfig/getConfig` typed routes。main 侧 `NOWLEDGE_MEM_CONFIG_UPDATED` 常量已删除，
  源码和测试扫描无命中。聚焦单测 5 个文件 83 个测试通过，真实 Knowledge Settings 中的 NowledgeMem
  配置 e2e 与 `01-launch`、`06-settings-ipc-boundary` 串行运行通过，包含临时写入和恢复原配置。真实
  Test Connection 仍需要本机 NowledgeMem 服务，保留人工验证。
- MCP config bridge 收口：`McpConfHelper.batchImportMcpServers` 不再把
  `MCP_EVENTS.CONFIG_CHANGED` 直接 `sendToRenderer`，而是只发 main 内部事件；`legacyTypedEventBridge`
  继续把它发布成 typed `mcp.config.changed` 给 renderer。renderer 侧未使用的 `MCP_EVENTS` raw 常量块已删除。
  聚焦单测 5 个文件 89 个测试通过，真实 MCP Settings 只读 e2e 与 `01-launch`、
  `06-settings-ipc-boundary` 串行运行通过。外部 marketplace batch import 会修改 MCP server 配置且可能依赖网络，
  仍作为人工或 opt-in e2e。
- ACP workspace/debug 收口：`AcpProvider` 和 `AcpProcessManager` 不再发送旧的
  `acp-workspace:*` raw channel；ACP ready 事件改为 typed `sessions.acp.modes.ready`、
  `sessions.acp.commands.ready`、`sessions.acp.configOptions.ready`。ACP debug 事件改成 main 内部
  `ACP_DEBUG_EVENTS.EVENT`，由 bridge 发布 typed `providers.acp.debug.event` 给 renderer。main/renderer
  的 `ACP_WORKSPACE_EVENTS` 常量已删除，ChatStatusBar 测试也改成直接触发 `SessionClient` typed listener。
  聚焦单测 6 个文件 157 个测试通过，真实 ACP/Provider 设置只读 e2e 与 `01-launch`、
  `06-settings-ipc-boundary` 串行运行通过。真实 ACP agent warmup、debug action、mode/model/config option
  流转需要可运行 agent 和本机依赖，仍作为人工或 opt-in e2e。
- Electron Knowledge read-only route e2e：真实 Knowledge Settings 页面读取
  `knowledge.isSupported/getSupportedLanguages/getSeparatorsForLanguage/getSupportedFileExtensions`，
  不添加文件、不触发 ingestion、不修改知识库数据。
- Electron MCP read-only route e2e：真实 MCP Settings 页面读取
  `mcp.getEnabled/getServers/getClients/listToolDefinitions/listPrompts/listResources/getNpmRegistryStatus`，
  不切换 MCP、不刷新 registry、不安装 marketplace server、不启停 MCP server。
- Electron NowledgeMem config route e2e：真实 Knowledge Settings 页面展开 NowledgeMem 配置面板，
  通过 UI 保存临时 base URL/API key，验证 `nowledgeMem.getConfig/updateConfig` typed routes，
  并在用例结束前恢复原配置；不运行需要真实服务的 Test Connection。
- Electron Dashboard read-only route e2e：真实 Settings Overview dashboard 读取
  `sessions.getUsageDashboard`，验证 summary、calendar、provider/model breakdown、RTK snapshot
  结构；不触发 `sessions.retryRtkHealthCheck`，不修改 session 数据。
- Electron Skills read-only route e2e：真实 Skills Settings 页面读取
  `skills.getDirectory/listMetadata`；如果当前 profile 存在已安装 skill，则额外验证
  `skills.readFile/getFolderTree/getExtension/listScripts`。用例不安装、不删除、不保存 skill 文件。
- Skills 聚焦稳定性 e2e：`01-launch`、`06-settings-ipc-boundary`、
  `16-skills-readonly-route` 三个用例一起运行通过；同时收紧 e2e 主窗口识别，避免 floating/settings/splash
  等非主窗口被误判为主聊天窗口。
- Electron ACP read-only route e2e：真实 ACP Settings 页面读取
  `config.getAcpState/listAcpRegistryAgents/listManualAcpAgents/getAcpSharedMcpSelections/listAgents`，
  验证 ACP 状态、registry agent、manual agent、shared MCP selections、DeepChat/ACP agent list；
  不切换 ACP、不刷新 registry、不安装/修复/卸载 registry agent、不修改 manual agent。
- ACP 聚焦稳定性 e2e：`01-launch`、`06-settings-ipc-boundary`、
  `17-acp-readonly-route` 三个用例一起运行通过。
- Electron Provider read-only route e2e：真实 Model Providers 设置页面等待 provider 列表渲染，
  读取 `providers.listSummaries/listDefaults/listModels/getRateLimitStatus`，断言时只保留 provider
  数量、模型数量、字段类型和布尔状态；不保存 provider 设置、不刷新模型、不测试真实连通性、不运行
  OAuth、不同步 ModelScope MCP server、不启动 ACP debug action。
- Provider 聚焦稳定性 e2e：`01-launch`、`06-settings-ipc-boundary`、
  `18-provider-readonly-route` 三个用例一起运行通过。
- Electron SkillSync read-only route/event e2e：真实 Skills Settings 页面确认同步状态区存在，
  读取 `skillSync.getRegisteredTools/getNewDiscoveries/scanExternalTools`，并验证 typed
  `skillSync.scan.started/completed` 事件可送达；不 acknowledge discoveries，不 preview/execute
  import/export。
- SkillSync 聚焦稳定性 e2e：`01-launch`、`06-settings-ipc-boundary`、
  `19-skill-sync-readonly-route` 三个用例一起运行通过。
- Electron Data Security read-only route e2e：真实 Data Settings 页面确认 database encryption、
  database repair、YoBrowser sandbox 三个区域可见，读取
  `databaseSecurity.getStatus/device.getInfo/device.getAppVersion`；不启用/停用数据库加密、不改密码、
  不修复 schema、不重置数据、不清理 browser sandbox。
- Data Security 聚焦稳定性 e2e：`01-launch`、`06-settings-ipc-boundary`、
  `20-data-security-readonly-route` 三个用例一起运行通过。
- Electron Project read-only route e2e：真实 Environments Settings 页面读取
  `project.listRecent/listEnvironments/pathExists`，并对当前仓库路径和一个生成的不存在路径验证
  `pathExists`；不打开目录、不唤起 native directory picker。
- Project 聚焦稳定性 e2e：`01-launch`、`06-settings-ipc-boundary`、
  `21-project-readonly-route` 三个用例一起运行通过。
- Electron Window read-only route e2e：真实主窗口和真实 Settings 窗口分别读取
  `window.getCurrentState`，验证 context-aware route 返回两个不同窗口的状态快照；不最小化、不最大化、
  不 focus、不关闭窗口。
- Window 聚焦稳定性 e2e：`01-launch`、`06-settings-ipc-boundary`、
  `22-window-readonly-route` 三个用例一起运行通过。
- Electron provider install preview e2e：通过 typed
  `window.requeuePendingSettingsProviderInstall` route 排队一个自定义 provider 预览，打开真实 Settings
  窗口后验证 Provider 预览弹窗展示 provider 名称、base URL、masked key，并确认 pending preview 队列已消费；
  不点击确认，不写 provider 配置。
- Provider preview 聚焦稳定性 e2e：`01-launch`、`06-settings-ipc-boundary`、
  `25-window-provider-deeplink-preview` 三个用例一起运行通过。
- Electron Config settings read-only route e2e：真实 DeepChat Agents、Notifications Hooks、
  Shortcuts 设置页面读取 `config.listAgents`、`config.resolveDeepChatAgentConfig`、
  `config.getAgentMcpSelections`、`config.getHooksNotifications`、`config.getShortcutKeys`；不创建/更新/删除
  agent，不保存 hooks，不执行 hook command，不重置或修改快捷键。
- Config settings 聚焦稳定性 e2e：`01-launch`、`06-settings-ipc-boundary`、
  `23-config-readonly-route` 三个用例一起运行通过。
- Electron Shortcut config route/event e2e：真实 Shortcuts 设置页中，从 Settings renderer 通过
  typed `config.setShortcutKeys` 写入临时 `QuickSearch` 快捷键，验证
  `config.shortcutKeys.changed` typed event，再调用 `shortcut.destroy`、`shortcut.register`、
  `shortcut.unregister`，最后在 `finally` 恢复原始快捷键配置。
- Shortcut event bridge 收口：`config.shortcutKeys.changed` 现在由
  `ConfigPresenter.setShortcutKey/resetShortcutKeys` 直接发布，`legacyTypedEventBridge` 不再 monkey patch
  `configPresenter` 的快捷键方法。聚焦 route/client/component 单测 4 个文件 81 个测试通过。
- Shortcut 聚焦稳定性 e2e：`01-launch`、`06-settings-ipc-boundary`、
  `28-shortcut-route-restore` 三个用例使用 `--workers=1` 串行运行通过；删除 shortcut monkey patch
  后同一组 e2e 重新构建再跑也通过。Electron 组合用例需要串行跑，因为 DeepChat 有单实例
  `SingletonLock`，并发 worker 可能在启动阶段误失败。
- Electron Hooks notification command e2e：通过 `config.setHooksNotifications` 保存一条临时 hook，
  在真实 Notifications Hooks 页面确认渲染，再通过 `config.testHookCommand` 执行无副作用本地
  `node -e` 命令，验证 stdout/exit code，最后在 `finally` 恢复原 hooks config。
- Hooks notification 聚焦稳定性 e2e：`01-launch`、`06-settings-ipc-boundary`、
  `27-hooks-notification-command` 三个用例一起运行通过。
- Electron DeepChat agent CRUD e2e：真实 DeepChat Agents 设置页通过 UI 创建唯一临时 agent，
  用 `config.listAgents` 验证，再通过 UI 更新名称/描述，最后通过 `config.deleteDeepChatAgent` 删除，并在
  `finally` 里按测试名前缀做兜底清理。
- DeepChat agent CRUD 聚焦稳定性 e2e：`01-launch`、`06-settings-ipc-boundary`、
  `26-deepchat-agent-crud` 三个用例一起运行通过。
- Electron Config system read-only route e2e：真实 About 设置页面读取
  `config.getProxySettings`、`config.getUpdateChannel`、`config.getSyncSettings`、
  `config.getSkillDraftSuggestions`、`config.getEntries` 的模型默认值/文件大小配置和
  `upgrade.getStatus`；不打开 General proxy 区域、不修改 proxy/update channel、不检查更新、不下载更新、
  不打开日志目录、不刷新 provider DB。
- Config system 聚焦稳定性 e2e：`01-launch`、`06-settings-ipc-boundary`、
  `24-config-system-readonly-route` 三个用例一起运行通过。
- Upgrade/About 聚焦稳定性 e2e：重新构建后，`01-launch`、`06-settings-ipc-boundary`、
  `24-config-system-readonly-route` 三个用例使用 `--workers=1` 串行运行通过。
- 稳定本地用户路径组合 e2e：启动、settings navigation、settings IPC boundary、floating IPC boundary、
  browser route lifecycle、main renderer IPC boundary、Data Settings privacy mode、Remote Control
  read-only routes、Knowledge read-only routes、MCP read-only routes、NowledgeMem config route
  和 Dashboard read-only route 十二个用例一起运行通过。e2e launcher 的主窗口等待放宽到 60 秒，
  避免长组合顺序运行时出现冷启动误报。
- 包含 Skills 的 13 用例长组合暂不升级为稳定 gate：本轮长组合里的 `01-launch` 和
  `08-browser-route` 在 Electron app setup 阶段超时，但二者随后单跑通过，Skills 单跑和聚焦组合也通过；
  当前归类为 e2e harness 稳定性问题，不是 presenter route 行为失败。
- Electron floating IPC boundary e2e：通过 typed config route 打开真实 floating renderer，验证 built/e2e
  模式加载 bundled renderer 文件，窗口只暴露 `floatingButtonAPI`，不暴露 broad
  `window.electron`、`window.deepchat`、`api.ipcRenderer`，并在用例结束后恢复原 floating 设置。
- Electron browser route e2e：用 `browser.loadUrl` 加载本地 `data:` 页面，轮询
  `browser.getStatus` 到 ready，验证 typed `browser.status.changed` 事件并调用 `browser.destroy`；
  该用例故意不清理真实 profile 的 browser sandbox。
- Session/Conversation/Stream runtime 收口：`AgentSessionPresenter` 删除旧 `session:*` renderer
  双发，只保留 `sessions.updated` typed event；`AgentRuntimePresenter`、`dispatch`、`echo` 和
  `PendingInputCoordinator` 删除旧 `stream:*`/`session:*` renderer 发送，改为
  `chat.stream.updated/completed/failed`、`sessions.status.changed`、
  `sessions.pendingInputs.changed` 和新增 `sessions.compaction.changed`；旧
  `sessionPresenter` 的 conversation/tab/message managers 停止发送无人消费的 `conversation:*`；
  `LifecycleManager.notifyMessage` 不再动态转发任意 lifecycle event 到 renderer。源码层
  `eventBus.sendToRenderer` 只剩 typed publisher `publishDeepchatEvent`。
- 本轮验证：`format`、`i18n`、`lint`、`typecheck`、`electron-vite build` 均通过；聚焦单测 9 个文件
  339 个测试通过；e2e 中 `01-launch`、`09-main-ipc-boundary`、`23-config-readonly-route`
  通过，`06-settings-ipc-boundary` 在四用例组合里 Electron app fixture setup 超时后单跑通过，
  `01-launch + 09-main-ipc-boundary` 使用 `--workers=1` 组合通过。
- 最后一轮 presenter event 扫尾：`eventBus.send(...)` 已经在 `src/main` / `src/renderer`
  源码中清零，`legacyTypedEventBridge` 已删除且无引用；`eventBus.sendToRenderer` 在运行时代码中只剩
  typed publisher `publishDeepchatEvent` 使用。`WindowPresenter` / `TabPresenter` 中无人订阅的旧广播
  已删除，包括 `system-theme-updated`、窗口最大化/全屏旧 channel、`setActiveTab`、
  `update-window-tabs` 和 `tab:title-updated`。
- 当前 `src/main/presenter` 下仍能搜到的 `webContents.send(...)` 不再是全局 presenter 事件迁移缺口，
  而是明确保留的独立窗口/专用 preload 协议：floating button 的 `floatingButtonAPI` channel、
  splash/database-unlock 启动期 channel、browser overlay activity channel，以及 ACP terminal 发给
  settings webContents 的 `DEEPCHAT_EVENT_CHANNEL` typed envelope。若后续要继续收敛这些小窗口，
  应先为 secondary renderer 增加 typed-envelope preload 支持，再迁移发送端。
- 最新聚焦验证：`contracts.test.ts`、`dispatcher.test.ts`、`clients.test.ts`、
  `preloadBoundaries.test.ts` 共 4 个文件 84 个测试通过；`windowPresenter.test.ts` 1 个文件
  4 个测试通过。
- 最新用户视角 e2e：`01-launch`、`06-settings-ipc-boundary`、`07-floating-ipc-boundary`、
  `09-main-ipc-boundary`、`22-window-readonly-route`、`23-config-readonly-route` 使用
  `-c test/e2e/playwright.config.ts --workers=1` 运行通过，共 6 个测试。为了避免本机真实
  DeepChat profile 的加密数据库 splash 和首次引导状态干扰自动化验证，e2e fixture 现在默认创建临时
  `DEEPCHAT_E2E_USER_DATA_DIR`，并写入已完成 onboarding 的最小 `app-settings.json`。
- 2026-06-13 收尾补充：renderer 侧无人引用的 `WINDOW_EVENTS` / `SYSTEM_EVENTS` 常量已删除，
  `docs/architecture/event-system.md` 已改为说明这些窗口事件只属于 main 内部协作；全量本地 smoke
  e2e 使用 `--workers=1` 跑完，结果为 26 个通过、3 个跳过。跳过项是 live provider/chat 集成测试，
  需要 `RUN_PROVIDER_INTEGRATION=true` 和显式配置好的 provider/model/API key。
- 同日最终门禁：`format`、`i18n`、`lint`、`typecheck`、focused Vitest 5 个文件 88 个测试通过；
  `src/renderer/src/env.d.ts` 显式补齐 Vite env、CSS、`?url` asset 和 inline worker 声明，避免
  `vue-tsgo` 依赖隐式 `vite/client` 合并。
- 同日完整单测门禁：`pnpm test -- --silent --reporter=dot` 通过，382 个文件通过、6 个跳过，
  3192 个测试通过、41 个跳过；其中把陈旧的 `session:activated` / `stream:end` 测试断言改成
  typed `sessions.updated` / `chat.stream.completed`，Config helper 测试也补齐 `sendToMain` 与 typed
  renderer publisher mock。

仍未满足：

- 真实外部服务/本机 profile 的人工验证还没有全部完成。
- Provider 外部动作仍需人工或带真实凭据的 opt-in smoke：refresh models、provider live
  connection、key status、rate-limit update、Ollama model pull progress、live chat generation、
  session persistence、GitHub Copilot OAuth、ACP debug action。
- SkillSync 仍需人工验证真实导入/导出和冲突处理，因为这些会写入 DeepChat skill 目录或外部工具目录。
- MCP sampling 仍需人工或专项 e2e 验证真实 approve/reject/cancel 弹窗链路，因为现有只读 e2e 不会启动
  会发 sampling 请求的 MCP server，也不会跑模型调用。
- Display Settings 字体大小仍需人工或专项 e2e 验证真实 UI 点击和跨窗口 class 同步，因为现有 config
  smoke 只读，不修改用户显示设置。
- NowledgeMem Test Connection 仍需人工或 opt-in e2e，因为它依赖本机或测试环境中真实运行的
  NowledgeMem 服务。
- MCP 外部 batch import 仍需人工或 opt-in e2e，因为它会修改 MCP server 配置，并可能依赖外部 marketplace
  数据。
- ACP runtime 行为仍需人工或 opt-in e2e：真实 agent warmup、debug action、mode/model/config option
  变更都依赖本机 agent/runtime 环境。
- Data/database 外部或破坏性动作仍需在 disposable/copied profile 上人工验证：数据库加密启用/改密/停用、
  database repair、各类 reset data、开发环境 reset 完成提示、YoBrowser sandbox clear、真实加密库
  splash unlock。
- Project/native path 仍需人工验证：目录选择器、open directory、remote/default workdir 选择和 OS
  shell 集成。
- Window 行为型动作仍需人工验证：focus main、minimize、maximize/restore、close settings/current
  window，以及 OS 级 `deepchat://provider/install` 协议分发到 preview queue 的端到端行为。
- Config 行为型动作仍需人工验证：DeepChat agent 的高级编辑项，例如模型选择、默认项目路径、工具开关、
  subagent slots 和 auto-compaction 控件；hooks notification 的自定义脚本/失败场景和真实事件派发；
  system notification 的真实 OS 展示/点击；
  Shortcut Settings UI 里的编辑、清除、重置、保存动作，以及 OS global shortcut 的真实按键触发、
  focus/blur 后是否重复注册、快捷键冲突处理；proxy/update channel 保存、打开日志目录、provider DB
  refresh、真实 update check/download/restart install，因为这些会修改用户设置、依赖平台全局快捷键状态、
  调用 OS shell、重启应用或触发网络/元数据刷新。

最终合并前仍建议跑下面的 gate：

```bash
rg "useLegacyPresenter|useLegacyRemoteControlPresenter|useLegacyShortcutPresenter" src/renderer
rg "@api/legacy|legacy/presenters|legacy/runtime" src
rg "presenter:call|remoteControlPresenter:call" src/main src/renderer
rg "DISPATCHABLE_PRESENTERS|REMOTE_CONTROL_METHODS|src/renderer/api/legacy" src/main src/renderer src/preload
node scripts/architecture-guard.mjs
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm test
```

多个 Electron e2e spec 合并运行时请加 `--workers=1`，避免单实例锁导致第二个 Electron 进程启动失败。

搜索必须只剩明确 allowlist，例如 preload/runtime 兼容层；业务组件里不能再有。
