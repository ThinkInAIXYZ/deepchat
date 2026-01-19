# YoBrowser Optimization：实施方案（Plan）

## 现状盘点（基于代码）

- Renderer：`src/renderer/src/components/workspace/WorkspaceView.vue` 在 `agent` 模式下渲染 `WorkspaceBrowserTabs`，但不关心是否存在 tabs。
- Renderer：`src/renderer/src/stores/yoBrowser.ts` 已维护 tabs 与 `tabCount`（由 IPC 事件更新）。
- Main：YoBrowser 通过 `BrowserToolManager` 导出大量 `browser_*` 工具定义，并在 `AgentToolManager` 中注入到 agent 工具集中。
- Agent loop：`src/main/presenter/agentPresenter/loop/toolCallProcessor.ts` 对部分 `browser_*` 工具有输出 offload 白名单。

## 总体设计

按你的要求分成三块：

1) UI：Browser Tabs 分区只在 `tabCount > 0` 时出现。
2) 完全移除 `browser_*`：从 agent 工具列表/路由/实现/文档/测试中彻底清理。
3) CDP Skill 化：新增 `yo-browser-cdp`，并提供最小工具面（CDP send + tab 管理），工具仅在 skill 激活时可用。

> 约束：不做任何 system prompt / browser context 缩减。

---

## 1) UI：Browser Tabs 分区仅在 `tabCount > 0` 时渲染

- 修改 `WorkspaceView.vue`：
  - 引入 `useYoBrowserStore()`。
  - 将 `showBrowserTabs` 改为：`chatMode.currentMode.value === 'agent' && yoBrowserStore.tabCount > 0`。

说明：
- `yoBrowserStore.tabCount` 已存在且由 tabs 数组计算。
- tabs 更新依赖现有 `YO_BROWSER_EVENTS.*`（TAB_CREATED/TAB_CLOSED/TAB_COUNT_CHANGED 等），无需新增事件。

---

## 2) 完全移除 `browser_*` 工具体系

这里的“完全移除”需要同时覆盖：

### 2.1 从 agent 工具注入与执行链路移除

- `src/main/presenter/agentPresenter/acp/agentToolManager.ts`
  - 移除 `getAllToolDefinitions()` 中对 `yoBrowserPresenter.getToolDefinitions()` 的注入。
  - 移除 `callTool()` 中对 `browser_*`（例如 `toolName.startsWith('browser_')`）的路由分支。

### 2.2 删除旧工具实现与依赖

- 删除/移除构建引用链：
  - `src/main/presenter/browser/BrowserToolManager.ts`
  - `src/main/presenter/browser/tools/**`
- 同步清理任何残留引用（全局搜索 `browser_` / `BrowserToolManager`）。

### 2.3 同步更新外围逻辑、文档、测试

- `src/main/presenter/agentPresenter/loop/toolCallProcessor.ts`
  - 从 `TOOLS_REQUIRING_OFFLOAD` 中移除 `browser_*`（至少 `browser_read_links` / `browser_get_clickable_elements`）。
- `docs/architecture/tool-system.md`
  - 移除 `browser_*` 相关说明与示例，改为描述：YoBrowser 自动化由 `yo-browser-cdp` skill 触发 + `yo_browser_*` 最小工具面。
- 测试
  - 更新/删除任何假设 `browser_*` 存在的测试（例如 tool definitions 断言）。

风险：
- 删除 `browser_*` 后，若 repo 内仍存在引用会导致构建/运行失败；因此需要全局清理。

回滚：
- 按你的要求不保留旧实现，回滚需依赖 git 历史恢复。

---

## 3) CDP Skill 化：`yo-browser-cdp` + 最小工具面

### 3.1 Skill 目录与命名

- 新增 skill：`resources/skills/yo-browser-cdp/SKILL.md`（名称 `yo-browser-cdp`）。

### 3.2 最小工具面（仅在 skill 激活时暴露）

工具名以 `yo_browser_` 前缀区分旧 `browser_*`：

- `yo_browser_tab_list`
  - 输出：tabs 列表 + active tabId。
- `yo_browser_tab_new`
  - 输入：`{ url?: string }`；输出：新 tabId + url。
- `yo_browser_tab_activate`
  - 输入：`{ tabId: string }`。
- `yo_browser_tab_close`
  - 输入：`{ tabId: string }`。
- `yo_browser_cdp_send`
  - 输入：`{ tabId?: string, method: string, params?: object }`。
  - 输出：`Debugger.sendCommand(method, params)` 的响应（推荐 JSON 文本）。

关键约束：
- 必须复用现有安全边界：当 tab URL 为 `local://` 时拒绝 CDP attach。
  - 推荐实现路径：通过 `BrowserTab.ensureSession()` 获取 session，再执行 `sendCommand`，避免绕过现有检查。

### 3.3 Skill gating 方案

- 目标：默认情况下 tool definitions **不包含** `yo_browser_*`。
- 当且仅当 active skills 包含 `yo-browser-cdp` 时，才将 `yo_browser_*` 注入 tool definitions。
- 建议复用现有 `deepchat-settings` 的 gating 模式：
  - 在 `AgentToolManager.getAllToolDefinitions()` 中读取 `presenter.skillPresenter.getActiveSkills(conversationId)`，若包含 `yo-browser-cdp` 则追加 `yo_browser_*` tool definitions。

### 3.4 Skill 文档内容要点（SKILL.md）

- 激活规则：仅当用户明确需要网页浏览/网页自动化/抓取验证时才激活；结束后及时 deactivate。
- 心智模型：tab → active tab → CDP session → method/params。
- 推荐 workflow：
  - `yo_browser_tab_list`（确认 active tab）
  - 必要时 `yo_browser_tab_new` / `yo_browser_tab_activate`
  - `yo_browser_cdp_send` 执行：
    - 页面导航：`Page.navigate`
    - 读 DOM/内容：`Runtime.evaluate`
    - 等待：`Runtime.evaluate` + 轮询/超时
- 常见错误处理：element not found、导航超时、tab 被销毁、CDP attach 被拒绝（local://）。

### 3.5 测试策略

- Renderer
  - 验证 `WorkspaceView`：tabCount=0 不显示；tabCount>0 显示。
- Main
  - tool definitions：默认无 `browser_*`，默认无 `yo_browser_*`。
  - 激活 `yo-browser-cdp` 后：出现 `yo_browser_*`。
  - 永久：`browser_*` 不再出现。

---

## 不在本计划内

- system prompt / browser context 的缩减或重写。
- 任何对 YoBrowser UI 行为（窗口位置/大小等）的调整。
