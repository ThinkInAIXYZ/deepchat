# 删除功能清单（实测 grep，2026-11-05，分支 feat/mygo-rewrite）

用法：这份清单是起点，不是终点。文件名里带的词不代表整个文件都要删。每个「修改」项都要打开文件看具体引用，只删与被砍功能有关的部分。删完用 grep 复查，剩余引用应为零。

通用复查命令（把 PATTERN 换成各节给出的关键词）：

```bash
grep -rlE 'PATTERN' src test electron.vite.config.ts electron-builder.yml docs --exclude-dir=i18n
```

i18n 目录单独处理：23 个 locale 目录，每个都要删对应键。

## 1. YoBrowser 与 Agent 浏览器自动化

关键词：`YoBrowser|yoBrowser|BrowserTab|CDPManager|BrowserClient|browser-overlay|BrowserPanel|AgentBrowserPiP|BrowserActivityOverlay|cdp_send|load_url|get_browser_status`

### 1.1 整个删除

main：

- `src/main/desktop/browser/` 目录下：`ScreenshotManager.ts`、`YoBrowserToolHandler.ts`、`YoBrowserPresenter.ts`、`yoBrowserSession.ts`、`YoBrowserOverlayWindow.ts`、`CDPManager.ts`、`BrowserTab.ts`
- `BrowserProfileImportService.ts` 同目录，是否删除见决策 D1
- `src/main/tool/browser/` 目录：`errors.ts`、`definitions.ts`

preload：`src/preload/browser-overlay-preload.ts`

shared：

- `src/shared/types/browser.ts`
- `src/shared/contracts/events/browser.events.ts`
- `src/shared/contracts/routes/browser.routes.ts`

renderer：

- `src/renderer/api/BrowserClient.ts`
- `src/renderer/browser-overlay/` 整个目录（`index.html`、`main.ts`、`env.d.ts`、`BrowserActivityOverlay.vue`）
- `src/renderer/src/components/sidepanel/BrowserPanel.vue`
- `src/renderer/src/components/browser/AgentBrowserPiP.vue`

测试：

- `test/main/desktop/browser/YoBrowserPresenter.test.ts`、`BrowserTab.test.ts`、`YoBrowserToolHandler.test.ts`
- `test/main/tool/agentTools/agentToolManagerYoBrowser.test.ts`
- `test/renderer/components/BrowserPanel.test.ts`、`AgentBrowserPiP.test.ts`、`BrowserActivityOverlay.test.ts`
- `test/e2e/specs/08-browser-route.smoke.spec.ts`
- `test/e2e/specs/35-baizhi-cloud-browser.smoke.spec.ts`：先读，名字里有 browser，可能与 YoBrowser 无关，不确定就不要删，记录在任务结果里

文档：`docs/features/agent-browser-pip/`。保留或删除由用户决定，默认不动，只在 `plan.md` 任务 A5 的结果里注明。

### 1.2 修改（只删相关引用）

main：

- `src/main/app/composition.ts`：创建、注册、启动、停止 YoBrowser 的部分
- `src/main/desktop/routes.ts`、`src/main/desktop/tab.ts`：内嵌网页、截图相关部分
- `src/main/tool/index.ts`、`src/main/tool/runtimePorts.ts`、`src/main/tool/agentTools/agentToolManager.ts`：浏览器工具的注册与端口
- `src/main/agent/deepchat/resources/systemEnvPromptBuilder.ts`、`systemPromptBuilder.ts`：提示词里描述浏览器工具的部分
- `src/main/agent/deepchat/runtime/toolAdapters.ts`、`src/main/agent/shared/agentSessionNormalization.ts`、`src/main/agent/promptSettings.ts`
- `src/main/mcp/settings.ts`、`src/main/mcp/apps/sandboxRegistry.ts`：先读，只删与 YoBrowser 有关的
- `src/main/session/deletion.ts`、`contracts.ts`、`lifecycle.ts`：多半是会话关闭时清理浏览器状态，先读

shared：`src/shared/contracts/domainSchemas.ts`、`src/shared/contracts/routes.ts`、`src/shared/contracts/events.ts`、`src/shared/types/desktop.ts` 里对 browser 的注册与类型

renderer：

- `src/renderer/api/index.ts`
- `src/renderer/src/components/sidepanel/ChatSidePanel.vue`、`src/renderer/src/apps/chat-main/ChatTabView.vue`
- `src/renderer/src/components/markdown/useMarkdownLinkNavigation.ts`：链接点击原本可能走内置浏览器，改成系统浏览器打开
- `src/renderer/src/stores/mcpElicitation.ts`、`src/renderer/src/components/acp/AcpElicitationForm.vue`
- `src/renderer/settings/components/`：`ReleaseNotes.vue`、`AboutUsSettings.vue`、`TunnelSyncSettings.vue`、`GrokOAuth.vue`、`DataSettings.vue`。这几个文件很可能只是用了 BrowserClient 来打开外部链接，需要改成走已有的外部链接能力（先 grep `openExternal` 或 `externalUrl` 看现有写法，复用它）

构建与测试配置：

- `electron.vite.config.ts`：preload 的 `browserOverlay` 入口（约第 56 行）、renderer 的 `browserOverlay` 入口（约第 143 行）
- `test/e2e/fixtures/electronApp.ts`
- `test/renderer/api/clients.test.ts`、`test/renderer/api/preloadBoundaries.test.ts`、`test/main/app/compositionBoundaries.test.ts`、`test/main/routes/dispatcher.test.ts`
- 其他命中过的测试：`mcpElicitation.test.ts`、`ChatTabView.test.ts`、`LinkNode.test.ts`、`DataSettings.test.ts`、`AboutUsSettings.test.ts`、`ReleaseNotes.test.ts`、`AcpElicitationForm.test.ts`、`ChatSidePanel.test.ts`、`GrokOAuth.test.ts`、`McpIndicator.test.ts`、`dispatch.test.ts`、`deepChatAgentHarness.test.ts`、`agentToolManagerRead.test.ts`、`toolService.test.ts`

### 1.3 浏览器数据导入（决策 D1）

- 涉及：`BrowserProfileImportService.ts`、`BrowserDataImportDialog.vue`、`DataSettings.vue`、对应两个测试、`docs/features/browser-profile-import/`
- 先读 `BrowserProfileImportService.ts` 和 `YoBrowserPresenter.ts` 里对它的调用。如果它的唯一用途是把其他浏览器的 cookie 等数据导入 YoBrowser 的分区，则随 YoBrowser 一起删。
- 如果它还有独立用途，保留并告诉用户。

## 2. 浮动按钮与悬浮聊天窗

关键词：`FloatingButton|FloatingChat|floating-preload|floatingButton|floating-widget`

### 2.1 整个删除

- `src/main/desktop/floatingButton/` 目录（`types.ts`、`layout.ts`、`index.ts`、`FloatingButtonWindow.ts`）
- `src/main/desktop/window/FloatingChatWindow.ts`
- `src/preload/floating-preload.ts`
- `src/renderer/floating/` 整个目录（`main.ts`、`env.d.ts`、`FloatingButton.vue`、`components/FloatingSessionItem.vue`，另有 `index.html`）
- `src/renderer/src/stores/floatingButton.ts`
- `src/shared/floatingButtonChannels.ts`、`src/shared/types/floating-widget.ts`
- 测试：`test/main/desktop/floatingButton/` 下三个测试、`test/renderer/stores/floatingButtonStore.test.ts`、`test/renderer/components/FloatingKeyboard.test.ts`（先读，确认只测浮动窗口再删）、`test/e2e/specs/07-floating-ipc-boundary.smoke.spec.ts`

### 2.2 修改

- `src/main/app/composition.ts`、`src/main/desktop/routes.ts`、`src/main/desktop/settings.ts`、`src/main/desktop/window/index.ts`、`src/main/events.ts`、`src/main/config/settingsStore.ts`（默认值 `floatingButtonEnabled`）
- `src/shared/contracts/routes.ts`、`events.ts`、`events/config.events.ts`（`config.floatingButton.changed`）、`routes/config.routes.ts`、`src/shared/types/desktop.ts`
- `src/renderer/api/ConfigClient.ts`、`src/renderer/src/events.ts`、`src/renderer/settings/components/DisplaySettings.vue`（设置里的浮动按钮开关）、`src/renderer/src/components/icons/AcpAgentIcon.vue`（先读，可能只是图标名里有 floating）
- `electron.vite.config.ts`：preload 的 `floating` 入口（约第 55 行）、renderer 的 `floating` 入口（约第 144 行）
- `test/setup.renderer.ts`、`test/renderer/api/preloadBoundaries.test.ts`、`test/main/routes/dispatcher.test.ts`、`test/main/routes/contracts.test.ts`
- 全部 23 个 locale 的 `settings.json`：`floatingButton`、`floatingButtonDesc` 等键（zh-CN 在约 2201 行）

## 3. computer use 的 PiP 预览

关键词：`ComputerUsePreview|AgentComputerUsePiP|computer-use-snapshot`

### 3.1 整个删除

- `src/main/desktop/computerUse/ComputerUsePreviewPresenter.ts`
- `src/renderer/src/components/computerUse/AgentComputerUsePiP.vue`
- 测试：`test/main/desktop/computerUse/ComputerUsePreviewPresenter.test.ts`、`test/renderer/components/AgentComputerUsePiP.test.ts`

### 3.2 修改

- `src/main/app/composition.ts`、`src/main/desktop/routes.ts`、`src/main/mcp/toolManager.ts`、`src/main/mcp/index.ts`：只删预览窗口相关，不要动 CUA 工具调用本身
- `src/renderer/api/ComputerUseClient.ts`、`src/shared/contracts/routes/computerUse.routes.ts`、`src/shared/types/computerUse.ts`、`src/shared/types/desktop.ts`：先读，只删预览相关的 route 与类型。如果整个 route 文件只服务预览，才删整个文件
- `src/renderer/src/apps/chat-main/ChatTabView.vue`
- `test/renderer/components/ChatTabView.test.ts`、`test/main/mcp/toolManager.test.ts`
- 文档：`docs/features/computer-use-snapshot-pip/`，同样默认不动，只在结果中注明

## 4. 设置与数据的兼容规则

- 删除功能时，不删除用户设置存储和数据库里已有的键、表、行。只是不再读取、不再写入。
- 设置默认值里新增的键不要再加。已有用户的 `floatingButtonEnabled`、`floatingButtonBounds` 残留在存储里没有害处，保留。
- 历史会话里可能有旧的浏览器工具调用记录（工具名来自 `src/main/tool/browser/definitions.ts`：`get_browser_status`、`load_url`、`cdp_send`）。删除工具后，renderer 必须仍能正常渲染这些历史消息，不能崩溃，也不能显示为空白。任务 A4 要求为此补一个测试。
- 在发布说明草稿里列出被移除的功能（见 `plan.md` 任务 A5）。

## 5. 已知的未解事项

- 上面的清单来自 grep 命中，包含只提到关键词但无需删除的文件。每一项都必须打开确认。
- `test/e2e/specs/35-baizhi-cloud-browser.smoke.spec.ts` 是否与 YoBrowser 有关未确认。
- `src/main/mcp/apps/sandboxRegistry.ts` 里的 browser 引用未确认，且 MCP Apps 沙箱本身要等 M0，不要顺手改沙箱逻辑。
