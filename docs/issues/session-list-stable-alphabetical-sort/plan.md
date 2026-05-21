# 会话列表固定字母排序 Plan

## 实现方向

- 将 `src/renderer/src/stores/ui/session.ts` 的统一排序入口从 `updatedAt` 倒序改为基于标题的字母升序比较。
- 为排序比较器增加 `id` 兜底，保证同标题时也稳定。
- 取消 `toggleSessionPinned()` 中对本地 `updatedAt` 的人工刷新，避免 pin / unpin 触发排序漂移和时间分组漂移。
- `getPinnedSessions()` 与 `getFilteredGroups()` 返回前都基于同一排序规则整理，确保列表展示稳定。

## 兼容性

- 不修改 session IPC/client 接口。
- 不修改 sidebar 现有 pinned 与 grouped 的区域划分。
- 会话时间分组仍按 `updatedAt` 判断属于 today/yesterday/older，但组内顺序改为标题字母序。

## 测试策略

- renderer store：覆盖 `fetchSessions()` 的标题排序行为。
- renderer store：覆盖 pin / unpin 后仍按标题排序、且不依赖更新时间置顶。

## 验证

- 运行聚焦 Vitest 用例验证 session store 排序回归。
- 完成后运行 `pnpm run format`、`pnpm run i18n`、`pnpm run lint`。
