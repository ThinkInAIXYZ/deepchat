# 会话历史分页稳定性 Plan

## 实现方向

- 以 [spec.md](./spec.md) 为准，优先修复共享 message store 的竞态和刷新语义。
- 在 renderer store 中区分“首屏恢复/切会话恢复”和“同会话刷新”：
  - 首屏恢复仍以最近消息窗口为主。
  - 同会话刷新根据当前已加载条数补齐相同规模的窗口，避免历史被截断。
- 为顶部翻页增加请求代次保护，确保异步返回只影响当前有效请求。
- 在主进程消息分页 helper 中允许多取 1 条记录，仅用于 `hasMore` 探测，不扩大公开分页上限。

## 兼容性

- 不调整 shared route schema，因此 IPC/client 调用方无需改协议。
- 刷新后的消息顺序仍保持 `orderSeq ASC`。
- `hasMoreHistory` / `nextCursor` 继续由 store 管理，聊天页滚动逻辑无需改交互。

## 测试策略

- renderer store:
  - 覆盖 `loadOlderMessages()` 的跨会话失效保护。
  - 覆盖同会话刷新时保留已加载历史窗口。
- main message store:
  - 覆盖 `limit=500` 时依然正确返回 `hasMore`。

## 验证

- 运行聚焦 Vitest 用例验证回归场景。
- 完成后运行 `pnpm run format`、`pnpm run i18n`、`pnpm run lint`。
