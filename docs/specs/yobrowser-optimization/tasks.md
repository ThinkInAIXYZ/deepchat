# YoBrowser Optimization：任务拆分（Tasks）

> 说明：本 tasks 用于后续落地实现的拆分；当前请求仅完善文档，因此这里只给出可执行顺序与验收点，不执行代码变更。

## Phase 1：UI（Workspace 侧边栏）

1. 调整 Browser Tabs 分区显示条件
- 文件：`src/renderer/src/components/workspace/WorkspaceView.vue`
- 改动：`WorkspaceBrowserTabs` 仅在 `chatMode === 'agent' && yoBrowserStore.tabCount > 0` 时渲染。
- 验收：无 tabs 时不出现分区；有 tabs 时出现并能点击切换。

2.（可选）补 renderer 单测
- 文件：`test/renderer/**`（按现有测试组织落位）
- 用例：tabCount=0/1 下的条件渲染。

---

## Phase 2：完全移除 `browser_*` 工具体系

3. 移除 agent 工具定义注入（browser_*)
- 文件：`src/main/presenter/agentPresenter/acp/agentToolManager.ts`
- 改动：删除 YoBrowser `getToolDefinitions()` 注入逻辑。
- 验收：tool definitions 不再包含任何 `browser_*`。

4. 移除 agent 的 `browser_*` call 路由
- 文件：`src/main/presenter/agentPresenter/acp/agentToolManager.ts`
- 改动：删除/禁止 `toolName.startsWith('browser_')` 分支。
- 验收：任何 `browser_*` tool call 都会被视为 unknown tool。

5. 清理 agent loop 对 `browser_*` 的特殊处理
- 文件：`src/main/presenter/agentPresenter/loop/toolCallProcessor.ts`
- 改动：从 `TOOLS_REQUIRING_OFFLOAD` 移除所有 `browser_*`。

6. 删除旧工具实现代码
- 目录/文件（预计）：
  - `src/main/presenter/browser/BrowserToolManager.ts`
  - `src/main/presenter/browser/tools/**`
- 验收：repo 中不再保留这套封装工具实现，且无残留引用。

7. 更新文档与示例
- 文件：`docs/architecture/tool-system.md`（以及搜索到的其他文档）
- 改动：移除/更新关于 `browser_*` 的示例与说明，改为 `yo-browser-cdp` skill + `yo_browser_*` 最小工具面。

8. 更新/修复测试
- 文件：`test/main/**`（按失败点定位）
- 改动：移除任何假设 `browser_*` 存在的断言。

---

## Phase 3：新增 `yo-browser-cdp`（CDP skill + 最小工具面）

9. 创建 skill 文档
- 文件：`resources/skills/yo-browser-cdp/SKILL.md`
- 内容要求：
  - 激活/关闭规则（仅在需要网页自动化时）。
  - tab/active tab/CDP session 概念。
  - 安全边界：`local://` 禁止 CDP。
  - 推荐工作流：list tabs → activate/new → `yo_browser_cdp_send(Page.navigate)` → `yo_browser_cdp_send(Runtime.evaluate)` → wait/retry。
  - 常见错误处理：element not found、navigation 超时、tab 被销毁等。

10. 实现最小 `yo_browser_*` 工具集，并做 skill gating
- 目标：工具只在 `yo-browser-cdp` 激活时可用（默认不可见）。
- 工具集合（最终以实现为准）：
  - `yo_browser_tab_list`
  - `yo_browser_tab_new`
  - `yo_browser_tab_activate`
  - `yo_browser_tab_close`
  - `yo_browser_cdp_send`

11.（可选）补 main 单测覆盖 gating
- 验证：
  - 默认无 `yo_browser_*`。
  - 激活 `yo-browser-cdp` 后出现 `yo_browser_*`。
  - `browser_*` 永久不存在。

---

## Phase 4：验收与质量门禁

12. 手工验收
- Agent 模式下：无 tabs 时 Workspace 不显示 Browser Tabs；创建 tab 后显示。
- 激活 `yo-browser-cdp`：模型可按 skill 指引使用 CDP 工具完成基本操作。

13. 质量门禁
- `pnpm run format && pnpm run lint && pnpm run typecheck`
- `pnpm test`
