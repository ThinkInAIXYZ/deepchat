# YoBrowser Session 单实例收敛

## 背景

当前 YoBrowser 还保留了多 window / 多 tab 的旧抽象，但实际运行时已经收敛为单个 sidepanel browser host。继续暴露 `open / close / focus / list`、windowId、tabId 等接口，只会增加状态分叉和错误恢复成本。

同时，session 切换后 browser 的回收策略需要和会话状态对齐：如果旧 session 仍在 `working`，切走时只能先 detach，不能立刻销毁，否则会打断本轮工具调用。

## 目标

1. 每个 session 最多持有一个 YoBrowser `webContents`。
2. agent 仅暴露 3 个裸工具名：`load_url`、`get_browser_status`、`cdp_send`。
3. `load_url` 首次调用时懒创建 browser，并自动完成 sidepanel attach 流程。
4. session 切换时按会话状态销毁：
   - 非 `working`：立即 detach 并销毁。
   - `working`：先 detach，待状态结束后再销毁。
5. 下线旧独立 browser shell，只保留聊天右侧 sidepanel 的 YoBrowser。

## 非目标

- 不扩成通用多窗口 browser 系统。
- 不保留旧 `yo_browser_*` 别名兼容。
- 不让 `cdp_send` 自动创建 browser；必须先 `load_url`。
- 不额外重构通用 window presenter 架构。

## 用户故事

- 作为 agent 用户，我希望 browser 工具是直接、稳定、少状态的，不需要理解 window/tab 多实体模型。
- 作为使用多会话的用户，我希望切换 session 时前一个 session 的 browser 不串到当前会话。
- 作为正在执行 browser 工具的用户，我希望切走会话不会打断仍在运行中的 browser 操作。

## 约束与假设

- “正在 loading” 统一按当前 session 状态 `working` 处理。
- 一个 session 同时只允许一个 sidepanel browser 实例。
- `cdp_send` 永远绑定当前 tool call 的 `conversationId`。
- `load_url`、`get_browser_status`、`cdp_send` 视为内建保留工具名，MCP 不得覆盖。

## 验收标准

### A. 工具面

- [ ] agent tool definitions 仅包含 `load_url`、`get_browser_status`、`cdp_send`。
- [ ] 旧 `yo_browser_*` 名称调用时返回 unknown tool。
- [ ] `cdp_send` 若 session browser 尚未初始化，返回明确错误，要求先 `load_url`。

### B. Session 生命周期

- [ ] `load_url` 首次调用时才创建对应 session 的 browser。
- [ ] 不同 session 持有各自独立 browser state，不共享 page / visibility / attach 状态。
- [ ] session 切换时，旧 session 若非 `working`，立即 destroy。
- [ ] session 切换时，旧 session 若为 `working`，仅 detach；该 session 结束后再 destroy。

### C. UI 与事件

- [ ] Renderer 仅响应当前 `sessionId` 的 YoBrowser 事件。
- [ ] 切换 session 后，browser panel 不显示前一个 session 的状态。
- [ ] 旧独立 browser shell 入口不再可用。

### D. 文档与接口

- [ ] `IYoBrowserPresenter` 与共享类型收敛到 session-aware 单实例接口。
- [ ] 架构文档与本 spec 使用新工具名与新生命周期语义。

## Open Questions

无。
