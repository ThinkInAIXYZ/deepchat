# YoBrowser Optimization（UI + CDP 工具）

## 背景

当前 YoBrowser 在 Workspace 侧边栏存在 UI 问题：
- `src/renderer/src/components/workspace/WorkspaceView.vue` 在 `agent` 模式下总会渲染 `WorkspaceBrowserTabs` 分区，即便没有任何 tab，也会出现一块空区域。

## 目标（Goals）

1. **UI**：只有存在 YoBrowser tabs 时，Workspace 侧边栏才显示 Browser Tabs 分区。
2. **Agent 工具直接注入**：YoBrowser 工具（`yo_browser_*`）在 agent 模式下直接可用，无需激活任何 skill。

## 非目标（Non-Goals）

- 不调整 YoBrowser window 的 UI、尺寸、布局、位置策略。
- 不修改 `BrowserContextBuilder.buildSystemPrompt` 的注入策略（不做减少/压缩/裁剪）。
- 不改造其他 agent 工具（filesystem/bash/mcp 等）。
- 不使用 skills 系统来控制 YoBrowser 工具的可见性。

## 用户故事（User Stories）

- 作为用户，我不希望在没有任何浏览器 tab 的情况下，Workspace 侧边栏仍出现空的 Browser Tabs 分区。
- 作为 agent 用户，我希望 YoBrowser 自动化能力以 CDP 为核心，工具在 agent 模式下直接可用。

## 约束与假设（Constraints & Assumptions）

- YoBrowser 现有实现已经基于 Electron Debugger/CDP（`CDPManager`, `BrowserTab.ensureSession()`）。
- 安全边界：`local://` URL 禁止绑定 CDP（`BrowserTab` 现有逻辑已做限制）。

## 验收标准（Acceptance Criteria）

### A. UI：Workspace Browser Tabs 展示逻辑

- [ ] `src/renderer/src/components/workspace/WorkspaceView.vue` 仅在 `chatMode === 'agent' && yoBrowserStore.tabCount > 0` 时渲染 `WorkspaceBrowserTabs`。
- [ ] 当 `tabCount === 0` 时，不显示 Browser Tabs 分区（不保留空白区域）。

### B. 工具：YoBrowser CDP 工具直接注入（agent 模式）

- [ ] agent tool definitions 中包含 `yo_browser_*` 工具（agent 模式下直接可用）。
- [ ] agent 的 tool call 路由正确处理 `yo_browser_*` 工具（`toolName.startsWith('yo_browser_')`）。
- [ ] 不依赖 skills 系统（不检查 `activeSkills`）。

### C. 工具实现：CDP 方式 + 合适的参数定义

- [ ] 工具集合：
  - `yo_browser_tab_list`：列出 tabs 与 active tab。
  - `yo_browser_tab_new`：创建新 tab（可选 url）。
  - `yo_browser_tab_activate`：激活 tab。
  - `yo_browser_tab_close`：关闭 tab。
  - `yo_browser_cdp_send`：向指定/当前 tab 的 CDP session 发送 `{ method, params }`。
- [ ] 参数 schema 符合 CDP 使用方式（method、params 等）。
- [ ] 保留安全边界：`local://` 禁止 CDP attach。

### D. Prompt/Context

- [ ] `BrowserContextBuilder.buildSystemPrompt` 的注入保持现状（不做减少/压缩/裁剪）。

### E. 兼容性

- [ ] 不涉及数据迁移。
- [ ] 现有 YoBrowser UI/窗口/Tab 生命周期保持可用。

## Open Questions

无。
