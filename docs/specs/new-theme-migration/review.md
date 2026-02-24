本轮只做了审查，没有改代码。

**问题清单（按严重度）**
1. **[P0] 新建会话没有稳定写入 `agentId`，会导致按 Agent 过滤/归类失效**
证据：`/Users/zerob13/Documents/deepchat/src/renderer/src/composables/useNewThread.ts:70`、`/Users/zerob13/Documents/deepchat/src/renderer/src/composables/useSessionList.ts:49`、`/Users/zerob13/Documents/deepchat/src/renderer/src/composables/useSessionList.ts:149`。
影响：Sidebar 选中 Agent 后看到的会话集合可能不准确。
建议方案：在 NewThread 创建分支统一落 `session.config.agentId`；并补一个“创建后立即可被筛选命中”的测试。

2. **[P0] Sidebar 的 Agent 一级模型与计划不一致（Template + ACP）**
证据：`/Users/zerob13/Documents/deepchat/src/renderer/src/stores/agent.ts:53`、`/Users/zerob13/Documents/deepchat/src/renderer/src/stores/agent.ts:55`、`/Users/zerob13/Documents/deepchat/src/renderer/src/components/WindowSideBar.vue:33`、`/Users/zerob13/Documents/deepchat/src/renderer/src/composables/useNewThread.ts:74`。
影响：模板 Agent 在入口层不可选，相关分支逻辑形同虚设。
建议方案：`sidebarAgents` 直接由模板 + ACP 映射生成，去掉临时 synthetic `local-agent` 兼容层。

3. **[P1] Phase3 的搜索/分组本地化未完整落地**
证据：`/Users/zerob13/Documents/deepchat/src/renderer/src/composables/useSessionList.ts:57`（有 `searchQuery`），但 `/Users/zerob13/Documents/deepchat/src/renderer/src/components/WindowSideBar.vue:287` 仍是硬编码分组文案。
影响：功能与 spec 偏差，且 i18n 一致性被破坏。
建议方案：在 Sidebar 接入搜索输入绑定 `searchQuery`，分组标题改为 i18n key。

4. **[P1] Phase6“window-only”未完成，TabPresenter 仍是核心注册组件**
证据：`/Users/zerob13/Documents/deepchat/src/main/presenter/index.ts:45`、`/Users/zerob13/Documents/deepchat/src/main/presenter/index.ts:136`、`/Users/zerob13/Documents/deepchat/src/main/presenter/index.ts:357`。
影响：架构仍保留 tab 主路径，维护复杂度高。
建议方案：先做一轮“兼容 API 外观保留、内部实现 window-only”收敛，再删 presenter 注册与销毁链路。

5. **[P1] tab 事件与 tab 命名合同仍大量暴露**
证据：`/Users/zerob13/Documents/deepchat/src/main/events.ts:181`、`/Users/zerob13/Documents/deepchat/src/renderer/src/events.ts:156`、`/Users/zerob13/Documents/deepchat/src/main/presenter/sessionPresenter/index.ts:424`、`/Users/zerob13/Documents/deepchat/src/shared/types/presenters/thread.presenter.d.ts:149`。
影响：调用方继续依赖旧语义，后续很难彻底清理。
建议方案：分两步：先标记 deprecated + 建立 mapping；再在下一轮移除 tab 合同。

6. **[P1] Session 内部仍以 `tabId` 作为主语义字段**
证据：`/Users/zerob13/Documents/deepchat/src/main/presenter/sessionPresenter/managers/conversationManager.ts:24`、`/Users/zerob13/Documents/deepchat/src/main/presenter/sessionPresenter/managers/conversationManager.ts:96`、`/Users/zerob13/Documents/deepchat/src/main/presenter/sessionPresenter/index.ts:64`。
影响：语义与 window-only 目标冲突，容易引入误读和回归。
建议方案：字段重命名为 window/session 语义（可先 alias 再迁移）。

7. **[P2] YoBrowser 仍保留 tab 形态 API（单页运行但多标签合同）**
证据：`/Users/zerob13/Documents/deepchat/src/main/presenter/browser/YoBrowserPresenter.ts:147`、`/Users/zerob13/Documents/deepchat/src/main/presenter/browser/YoBrowserToolHandler.ts:19`、`/Users/zerob13/Documents/deepchat/src/renderer/src/stores/yoBrowser.ts:15`、`/Users/zerob13/Documents/deepchat/src/shared/types/browser.ts:51`。
影响：Phase6 简化收益被稀释。
建议方案：压成单实例页面合同，`tabId` 改为固定 page identity。

8. **[P2] mock/debug 预览路径仍在生产运行路径中**
证据：`/Users/zerob13/Documents/deepchat/src/renderer/src/views/ChatTabView.vue:8`、`/Users/zerob13/Documents/deepchat/src/renderer/src/components/WindowSideBar.vue:85`、`/Users/zerob13/Documents/deepchat/src/renderer/src/composables/useMockViewState.ts:1`。
影响：增加分支复杂度与误触风险。
建议方案：若不再需要演示模式，整体下线并迁到 dev-only feature flag。

9. **[P3] UI class 拼写疑似错误**
证据：`/Users/zerob13/Documents/deepchat/src/renderer/settings/App.vue:6`（`ounded-t-none`）。
影响：样式可能未生效。
建议方案：修正 class 名并做一次 settings 页面视觉回归。

**Phase 落地结论（按顺序）**
1. Phase1：基本完成。
2. Phase2：部分完成（Agent 一级模型与 spec 不一致）。
3. Phase3：部分完成（search UI 与分组 i18n 缺口）。
4. Phase4：部分完成（创建链路对 `agentId` 持久化不稳定）。
5. Phase5：基本完成（结构在，但依赖前面 `agentId` 正确性）。
6. Phase6：部分完成（window-only/YoBrowser 简化仍有大量 tab 兼容层）。
7. Phase7：部分完成（cleanup 与 i18n 清理未收口）。

**可清理项（代码 + i18n）**
1. mock 预览链路：
`/Users/zerob13/Documents/deepchat/src/renderer/src/composables/useMockViewState.ts`
`/Users/zerob13/Documents/deepchat/src/renderer/src/components/ChatPreviewPage.vue`
`/Users/zerob13/Documents/deepchat/src/renderer/src/components/WelcomePreviewPage.vue`
`/Users/zerob13/Documents/deepchat/src/renderer/src/components/ChatPreviewTopBar.vue`
`/Users/zerob13/Documents/deepchat/src/renderer/src/components/ChatPreviewMessageList.vue`
以及 `/Users/zerob13/Documents/deepchat/src/renderer/src/components/WindowSideBar.vue` 的 debug toggle。

2. tab 兼容层（若确定进入最终 window-only）：
`/Users/zerob13/Documents/deepchat/src/main/presenter/tabPresenter.ts`
以及 main/renderer/shared 中 `TAB_EVENTS`、`openConversationInNewTab`、tab 合同类型。

3. i18n 未使用 key（当前代码扫描结果）：
`/Users/zerob13/Documents/deepchat/src/renderer/src/i18n/en-US/newThread.json` 里的
`newThread.selectAgent`、`newThread.templateAgents`、`newThread.acpAgents`、`newThread.manageAgents`。
`common.sidebar.toggleWelcomePage` 仅用于 debug 开关，若下线 debug 可一起删。

**验证情况**
- `pnpm run lint` 通过。
- `pnpm run typecheck` 通过。
- `pnpm run i18n`、`pnpm run i18n:en` 通过。
- 测试集当前有大量基线失败，无法作为本次迁移完成度的可靠信号。

如果你同意，我下一步可以把这些问题拆成“先修正确性（P0/P1）/再做架构收口（Phase6）/最后清理（Phase7）”的可执行改动清单（按提交粒度列出）。
