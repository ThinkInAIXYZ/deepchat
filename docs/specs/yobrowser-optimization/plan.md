# YoBrowser Session 单实例实施计划

## 1. 主进程模型

1. `YoBrowserPresenter` 用 `Map<sessionId, SessionBrowserState>` 替代全局单状态。
2. 每个 `SessionBrowserState` 仅包含一个 `WebContentsView`、一个 `BrowserTab`、attach 信息、可见性和最后一次 bounds。
3. `load_url` 负责首次懒加载：创建 browser、发起 sidepanel open、等待 host ready、再导航。

## 2. 工具路由

1. `YoBrowserToolDefinitions` 仅注册 `load_url`、`get_browser_status`、`cdp_send`。
2. `YoBrowserToolHandler.callTool` 必须接收 `conversationId` 并据此路由 session。
3. `AgentToolManager` 和 `ToolPresenter` 把这 3 个名字视为内建 YoBrowser 工具。
4. MCP 同名工具在定义收集阶段直接过滤。

## 3. Renderer 行为

1. `BrowserPanel` 接收 `sessionId`，所有 presenter 调用都显式带 sessionId。
2. 切换 session 时先 detach 旧 session browser。
3. 若旧 session 状态不是 `working`，立即 destroy。
4. 若旧 session 状态是 `working`，加入 `pendingBrowserDestroySessionIds`，等状态变更后再 destroy。
5. YoBrowser 事件 payload 带 `sessionId`，只更新当前 panel 对应的会话。

## 4. 独立 browser 下线

1. 删除 `src/renderer/browser` 旧壳入口。
2. `windowPresenter` 中旧 `browser` window 类型不再创建独立窗口，统一回退到 chat window。
3. 清理 `tabPresenter` 中依赖 `browserTabId` 的 YoBrowser 分支。

## 5. 测试策略

1. main:
   - tool definitions 只剩 3 个新工具。
   - 旧工具名报 unknown tool。
   - `load_url` 懒加载与 host-ready 流程成立。
   - session 间 browser state 隔离。
2. renderer:
   - `BrowserPanel` 仅响应当前 session 事件。
   - session 切换时的 detach / destroy / pending destroy 成立。
3. 回归:
   - `cdp_send` 仍走 offload。
   - disabled tools 存储和展示使用新工具名。
