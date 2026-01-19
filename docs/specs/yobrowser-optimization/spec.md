# YoBrowser Optimization（UI + CDP Skill 化）

## 背景

当前 YoBrowser 在 Workspace 侧边栏与 agent 工具体系中存在两类问题：

1) **UI**：`src/renderer/src/components/workspace/WorkspaceView.vue` 在 `agent` 模式下总会渲染 `WorkspaceBrowserTabs` 分区，即便没有任何 tab，也会出现一块空区域。

2) **工具体系**：main 侧通过 `BrowserToolManager` 暴露大量 `browser_*` 工具（navigate/action/content/tabs/download 等），你希望：
- **完全移除**这套 `browser_*` 工具（不暴露、不保留旧实现）。
- 走“**完全 CDP**”路线：用 **skill** 教会模型如何操作 CDP，并只提供 **最小工具面**（优先 1 个通用 CDP send + 少量 tab 管理）。

> 重要约束：你明确要求 **不做 system prompt / browser context 的减少**，因此本需求不包含任何“缩减 prompt 注入”的工作。

## 目标（Goals）

1. **UI**：只有存在 YoBrowser tabs 时，Workspace 侧边栏才显示 Browser Tabs 分区。
2. **完全移除 `browser_*`**：从 agent 工具列表、路由、实现代码、文档与测试中彻底移除 `browser_*` 体系。
3. **CDP Skill 化**：新增 `yo-browser-cdp` skill（目录命名按约定），通过 skill 文档讲清 CDP 工作流；并提供最小工具面以 CDP 为核心。

## 非目标（Non-Goals）

- 不调整 YoBrowser window 的 UI、尺寸、布局、位置策略。
- 不修改 `BrowserContextBuilder.buildSystemPrompt` 的注入策略（不做减少/压缩/裁剪）。
- 不改造其他 agent 工具（filesystem/bash/mcp 等）。

## 用户故事（User Stories）

- 作为用户，我不希望在没有任何浏览器 tab 的情况下，Workspace 侧边栏仍出现空的 Browser Tabs 分区。
- 作为 agent 用户，我希望 YoBrowser 自动化能力以 CDP 为核心，并通过 skill 教会模型如何使用，而不是依赖大量高层封装工具。
- 作为维护者，我希望彻底移除现有 `browser_*` 工具实现，减少长期维护面。

## 约束与假设（Constraints & Assumptions）

- YoBrowser 现有实现已经基于 Electron Debugger/CDP（`CDPManager`, `BrowserTab.ensureSession()`）。
- 安全边界：`local://` URL 禁止绑定 CDP（`BrowserTab` 现有逻辑已做限制），skill 必须明确写出该约束。

## 验收标准（Acceptance Criteria）

### A. UI：Workspace Browser Tabs 展示逻辑

- [ ] `src/renderer/src/components/workspace/WorkspaceView.vue` 仅在 `chatMode === 'agent' && yoBrowserStore.tabCount > 0` 时渲染 `WorkspaceBrowserTabs`。
- [ ] 当 `tabCount === 0` 时，不显示 Browser Tabs 分区（不保留空白区域）。

### B. 工具：完全移除 `browser_*` 系列工具

- [ ] agent tool definitions 中不再出现任何 `browser_*` 工具。
- [ ] agent 的 tool call 路由中不再接受/处理 `browser_*`（例如 `toolName.startsWith('browser_')` 这类分支被移除）。
- [ ] 旧工具实现不再保留：`BrowserToolManager` 与 `src/main/presenter/browser/tools/**`（以及其他相关封装）被删除或完全移出构建引用链。
- [ ] repo 内所有对 `browser_*` 的残留引用被清理/更新：
  - `src/main/presenter/agentPresenter/loop/toolCallProcessor.ts` 的 offload 白名单不再包含 `browser_*`。
  - `docs/architecture/tool-system.md` 不再描述 `browser_*` 使用方式。
  - 相关测试不再假设 `browser_*` 存在。

### C. Skill：新增 `yo-browser-cdp`（CDP 为核心 + 最小工具面）

- [ ] 新增 skill：`resources/skills/yo-browser-cdp/SKILL.md`。
- [ ] skill 明确写清：何时 activate/deactivate、tab/active tab、CDP session、`local://` 禁止 CDP、安全/失败处理。
- [ ] `yo-browser-cdp` 激活后才暴露最小工具面（未激活时不可见/不可用）。
- [ ] 最小工具面（名称为最终约定，后续实现需对齐）：
  - `yo_browser_tab_list`：列出 tabs 与 active tab。
  - `yo_browser_tab_new`：创建新 tab（可选 url）。
  - `yo_browser_tab_activate`：激活 tab。
  - `yo_browser_tab_close`：关闭 tab。
  - `yo_browser_cdp_send`：向指定/当前 tab 的 CDP session 发送 `{ method, params }`。

### D. Prompt/Context

- [ ] `BrowserContextBuilder.buildSystemPrompt` 的注入保持现状（不做减少/压缩/裁剪）。

### E. 兼容性

- [ ] 不涉及数据迁移。
- [ ] 现有 YoBrowser UI/窗口/Tab 生命周期保持可用。

## Open Questions

无。
