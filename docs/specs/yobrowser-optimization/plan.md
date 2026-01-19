# YoBrowser Optimization：实施方案（Plan）

## 现状盘点（基于代码）

- Renderer：`src/renderer/src/components/workspace/WorkspaceView.vue` 在 `agent` 模式下渲染 `WorkspaceBrowserTabs`，但不关心是否存在 tabs。
- Renderer：`src/renderer/src/stores/yoBrowser.ts` 已维护 tabs 与 `tabCount`（由 IPC 事件更新）。
- Main：YoBrowser 通过 `YoBrowserToolHandler` + `YoBrowserToolDefinitions` 暴露 `yo_browser_*` 工具，当前有 skill gating 逻辑（需要激活 `yo-browser-cdp` skill）。
- Agent loop：`src/main/presenter/agentPresenter/loop/toolCallProcessor.ts` 中 `TOOLS_REQUIRING_OFFLOAD` 包含 `yo_browser_cdp_send`。

## 总体设计

1) UI：Browser Tabs 分区只在 `tabCount > 0` 时出现。
2) YoBrowser 工具直接注入：agent 模式下直接提供 `yo_browser_*` 工具，不依赖 skills 体系。
3) 工具实现保持 CDP 方式：`yo_browser_cdp_send` + tab 管理，参数 schema 按 CDP 定义。

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

## 2) YoBrowser 工具直接注入（agent 模式，不依赖 skills）

### 2.1 移除 tool definitions 的 skill gating

- `src/main/presenter/browser/YoBrowserToolHandler.ts`
  - 删除 `getActiveSkills()` 方法或不再使用。
  - `getToolDefinitions()` 直接返回 `getYoBrowserToolDefinitions()`（不再受 `activeSkills` 控制）。

### 2.2 同步更新 AgentToolManager 注入逻辑

- `src/main/presenter/agentPresenter/acp/agentToolManager.ts`
  - `getAllToolDefinitions()` 中，在 agent 模式下直接追加 `yoBrowserPresenter.toolHandler.getToolDefinitions()`（不再传递/依赖 conversationId 做 gating）。
  - `callTool()` 中，`toolName.startsWith('yo_browser_')` 分支保持不变（继续路由到 YoBrowser handler）。

### 2.3 移除 skill 文档与残留引用

- 删除 `resources/skills/yo-browser-cdp/` 整个目录。
- `docs/architecture/tool-system.md`：
  - 删除或改写“YoBrowser CDP 工具仅在 `yo-browser-cdp` skill 激活时可用”的描述。
  - 改为：“YoBrowser CDP 工具在 agent 模式下直接可用”。
- 全局搜索 `yo-browser-cdp` / `allowedTools` / `skill gated`，确保没有残留引用（代码、文档、测试）。

---

## 3) 工具实现：CDP 方式 + 参数定义（保持现状）

### 3.1 工具集合（无需改动）

- `yo_browser_tab_list`
- `yo_browser_tab_new`
- `yo_browser_tab_activate`
- `yo_browser_tab_close`
- `yo_browser_cdp_send`

### 3.2 参数 schema（保持现状，无需改动）

- `src/main/presenter/browser/YoBrowserToolDefinitions.ts`：
  - `cdp_send` 参数：`{ tabId?: string, method: string, params?: object }`。
  - 其他 tab 管理工具参数保持不变。

### 3.3 安全边界（保持现状）

- `src/main/presenter/browser/BrowserTab.ensureSession()`：
  - 检查 `currentUrl.startsWith('local://')`，若为真则抛出错误（禁止 CDP attach）。

---

## 不在本计划内

- system prompt / browser context 的缩减或重写。
- 任何对 YoBrowser UI 行为（窗口位置/大小等）的调整。
- skills 体系（YoBrowser 不再使用 skills 来控制工具可见性）。
