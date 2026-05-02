# YoBrowser Session 单实例任务拆分

1. 收敛共享类型与 presenter 接口到 session-aware 单实例模型。
2. 重写 `YoBrowserPresenter` 的 session 状态管理、attach、detach、destroy 流程。
3. 将 tool definitions / handler / agent routing 切到 `load_url`、`get_browser_status`、`cdp_send`。
4. 在 renderer sidepanel 中按 `sessionId` 驱动 browser panel，并实现 `working` 态延迟销毁。
5. 删除旧独立 browser shell 与 `browserTabId` 相关残留。
6. 更新 main / renderer / agent presenter 测试到新工具名和新生命周期。
7. 更新规格与架构文档，并跑格式化、i18n、lint、关键测试。
