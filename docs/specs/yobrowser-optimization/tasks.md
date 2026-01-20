# YoBrowser Optimization：任务拆分（Tasks）

## Phase 1：UI（Workspace 侧边栏）

1. 调整调整 Browser Tabs 分区显示条件
- 文件：`src/renderer/src/components/workspace/WorkspaceView.vue`
- 改动：`WorkspaceBrowserTabs` 仅在 `chatMode === 'agent' && yoBrowserStore.tabCount > 0` 时渲染。
- 验收：无 tabs 时不出现分区；有 tabs 时出现并能点击切换。

2.（可选）补 renderer 单测
- 文件：`test/renderer/**`（按现有测试组织落位）
- 用例：tabCount=0/1 下的条件渲染。

---

## Phase 2：移除 YoBrowser skill gating

3. 移除 YoBrowser tool definitions 的 skill gating
- 文件：`src/main/presenter/browser/YoBrowserToolHandler.ts`
- 改动：删除 `getActiveSkills()` 方法或不再使用；`getToolDefinitions()` 直接返回 `getYoBrowserToolDefinitions()`。
- 验收：不再依赖 `activeSkills`。

4. 调整 AgentToolManager 注入逻辑（不再依赖 conversationId 做 gating）
- 文件：`src/main/presenter/agentPresenter/acp/agentToolManager.ts`
- 改动：`getAllToolDefinitions()` 中，agent 模式下直接追加 `yoBrowserPresenter.toolHandler.getToolDefinitions()`（可不传 conversationId）。
- 验收：tool definitions 包含 `yo_browser_*`。

5. 删除 skill 文档与残留引用
- 删除 `resources/skills/yo-browser-cdp/` 整个目录。
- 文件：`docs/architecture/tool-system.md`（以及搜索到的其他文档）
- 改动：删除或改写“仅在 `yo-browser-cdp` skill 激活时可用”的描述；改为“agent 模式下直接可用”。
- 全局搜索：确认没有残留的 `yo-browser-cdp` / `skill gated` 引用。

---

## Phase 3：验证工具实现（保持 CDP 方式）

6. 验证工具参数定义
- 文件：`src/main/presenter/browser/YoBrowserToolDefinitions.ts`
- 验收：`yo_browser_cdp_send` 参数为 `{ tabId?: string, method: string, params?: object }`。

7. 验证安全边界
- 文件：`src/main/presenter/browser/BrowserTab.ts`
- 验收：`ensureSession()` 中有 `local://` URL 检查。

8.（可选）补 main 单测
- 验证：
  - agent 模式下 tool definitions 包含 `yo_browser_*`。
  - `callTool()` 正确路由到 YoBrowser handler。

---

## Phase 4：验收与质量门禁

9. 手工验收
- Agent 模式下：无 tabs 时 Workspace 不显示 Browser Tabs；创建 tab 后显示。
- Agent 模式下：不激活任何 skill，`yo_browser_*` 工具直接可用。

10. 质量门禁
- `pnpm run format && pnpm run lint && pnpm run typecheck`
- `pnpm test`
