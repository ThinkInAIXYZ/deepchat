# 右侧按需 Sidepanel 实施计划

## 1. 关键决策

1. 用新的 `Sidepanel` 替换 `ArtifactDialog`，不再维护独立 artifact drawer。
2. sidepanel 分为两个一级 tab：`workspace`、`browser`。
3. sidepanel 默认隐藏；开启状态仅由顶部按钮和 artifact 完成事件驱动。
4. `workspace` 会话级状态与 `browser` 窗口级状态分离。
5. 旧 workspace 的 `Plan / Terminal` 直接删除，不做兼容层。
6. YoBrowser 主界面入口和独立窗口 UI 一并下线；底层先收敛到单嵌入实例。

## 2. 状态模型

### Window 级

新增 `sidepanel` store：

1. `open: boolean`
2. `activeTab: 'workspace' | 'browser'`
3. `width: number`
4. `browserHostBounds: { x: number; y: number; width: number; height: number } | null`

### Session 级

按 `sessionId` 保存：

1. `selectedArtifactContext: { threadId: string; messageId: string; artifactId: string } | null`
2. `selectedFilePath: string | null`
3. `selectedDiffPath: string | null`
4. `viewMode: 'preview' | 'code'`
5. `sections: { artifacts: boolean; files: boolean; git: boolean }`

## 3. 渲染层改造

### Chat 主布局

1. `ChatTabView.vue`
   - 移除 `ArtifactDialog`
   - 引入 `ChatSidePanel`
   - 布局改为主内容 + 右侧滑出 panel

2. `ChatTopBar.vue`
   - 新增 `Workspace` 按钮
   - 接入 `sidepanelStore.toggleWorkspace()`

### Workspace UI

新增组件：

1. `components/sidepanel/ChatSidePanel.vue`
2. `components/sidepanel/WorkspacePanel.vue`
3. `components/sidepanel/WorkspaceAccordionSection.vue`
4. `components/sidepanel/WorkspaceArtifactList.vue`
5. `components/sidepanel/WorkspaceFileTree.vue`
6. `components/sidepanel/WorkspaceGitChanges.vue`
7. `components/sidepanel/WorkspaceViewer.vue`
8. `components/sidepanel/BrowserPanel.vue`

`WorkspaceViewer` 统一渲染：

1. artifact preview/code
2. file preview/code
3. git diff

能复用的现有实现：

1. artifact preview 组件族
2. `useArtifactCodeEditor`
3. `MarkdownRenderer`
4. `WorkspaceFileNode` 的树节点样式与操作

### Artifact 列表来源

1. 从 `messageStore.messages` 和 `streamingBlocks` 解析 artifact。
2. 复用 `useArtifacts.ts` 的标签解析逻辑，抽出纯函数用于列表和消息卡片共享。
3. 由 sidepanel store 负责“最新 artifact 完成后自动打开”的状态更新。

## 4. Main / Presenter 改造

### WorkspacePresenter

删除：

1. `getPlanEntries`
2. `updatePlanEntries`
3. `emitTerminalSnippet`
4. `terminateCommand`
5. `clearWorkspaceData`
6. `PlanStateManager`

保留：

1. `registerWorkspace`
2. `registerWorkdir`
3. `unregisterWorkspace`
4. `unregisterWorkdir`
5. `readDirectory`
6. `expandDirectory`
7. `revealFileInFolder`
8. `openFile`
9. `searchFiles`

新增：

1. `readFilePreview(filePath: string): Promise<WorkspaceFilePreview | null>`
2. `getGitStatus(workspacePath: string): Promise<WorkspaceGitState | null>`
3. `getGitDiff(workspacePath: string, filePath?: string): Promise<WorkspaceGitDiff | null>`

实现策略：

1. `readFilePreview`
   - 复用 `FilePresenter.prepareFileCompletely(absPath, undefined, 'origin')`
   - 标准化 text / markdown / html / svg / image / binary
2. `getGitStatus`
   - `git rev-parse --is-inside-work-tree`
   - `git status --porcelain=v1 --branch`
3. `getGitDiff`
   - `git diff -- file`
   - `git diff --cached -- file`
   - staged / unstaged 合并返回

### Agent Bash

1. 删除向 `workspacePresenter.emitTerminalSnippet()` 的发送。
2. 保留命令执行本身，不再产出 workspace terminal 片段。

## 5. YoBrowser 嵌入策略

### Presenter

`YoBrowserPresenter` 增加嵌入式 host 生命周期：

1. `ensureEmbeddedTarget(): Promise<number | null>`
2. `attachEmbeddedToWindow(windowId: number): Promise<number | null>`
3. `updateEmbeddedBounds(windowId: number, bounds: Rectangle, visible: boolean): Promise<void>`
4. `detachEmbedded(): Promise<void>`

策略：

1. 仅维护一个活动 browser target。
2. 不再依赖多个 `BrowserWindowInfo` 列表驱动 UI。
3. `getBrowserContext()` 最多返回一个活动窗口快照，保证 tool handler 兼容。
4. 独立窗口创建接口不再由 renderer 调用；如仍被内部调用，重定向到同一活动 target。

### Renderer

1. `BrowserPanel` 渲染 toolbar 和占位容器。
2. 使用 `ResizeObserver` + `getBoundingClientRect()` 把容器 bounds 同步给 main。
3. panel 关闭、切 tab、路由切换时隐藏嵌入内容。

## 6. 事件与类型清理

删除 workspace 事件：

1. `WORKSPACE_EVENTS.PLAN_UPDATED`
2. `WORKSPACE_EVENTS.TERMINAL_OUTPUT`

保留：

1. `WORKSPACE_EVENTS.FILES_CHANGED`

新增共享类型：

1. `SidePanelTab`
2. `WorkspaceNavSection`
3. `WorkspaceFilePreview`
4. `WorkspaceGitFileChange`
5. `WorkspaceGitState`
6. `WorkspaceGitDiff`

同步更新：

1. `src/shared/types/presenters/workspace.d.ts`
2. `src/shared/types/presenters/index.d.ts`
3. `src/shared/types/presenters/legacy.presenters.d.ts`

## 7. 测试策略

### Main

1. `readFilePreview`：文本、markdown、html、svg、图片、二进制、非法路径
2. `getGitStatus`：非仓库、clean repo、dirty repo
3. `getGitDiff`：staged、unstaged、stashed-free basic cases

### Renderer

1. `ChatTopBar` workspace 按钮显隐与切换
2. artifact 完成后的自动滑出行为
3. `Artifacts / Files / Git` 折叠区与 viewer 切换
4. `BrowserPanel` bounds 同步与导航按钮行为

## 8. 风险与缓解

1. 风险：artifact 流式更新和 sidepanel 自动滑出状态竞争
   - 缓解：只在 artifact 从 loading 进入 loaded 且 panel 关闭时自动打开
2. 风险：嵌入式 browser bounds 不准导致内容错位
   - 缓解：用容器真实 `getBoundingClientRect()`，并在 resize/tab 切换时强制同步
3. 风险：删除旧 workspace 事件后存在死引用
   - 缓解：先全仓搜索，再删类型/事件/发送方/监听方
