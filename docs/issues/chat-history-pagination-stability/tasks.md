# 会话历史分页稳定性 Tasks

- [ ] 确认 [spec.md](./spec.md) 没有遗留 `[NEEDS CLARIFICATION]`。
- [ ] 在 renderer message store 中补齐历史分页请求失效保护。
- [ ] 调整同会话刷新逻辑，保留已加载历史窗口。
- [ ] 修复主进程分页的 `limit=500` `hasMore` 探测边界。
- [ ] 更新 renderer/main 聚焦测试。
- [ ] 运行 `pnpm run format`、`pnpm run i18n`、`pnpm run lint`。
