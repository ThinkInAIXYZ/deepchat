# 任务拆分：侧边栏历史会话分页加载卡死

按提交粒度排序，每项可独立 review。

## T1 — 分页停止携带子代理会话（核心，最小修复）
- [ ] `src/renderer/src/stores/ui/session.ts:512`、`:551` 将 `includeSubagents: true` 改为 `false`
- [ ] `test/renderer/stores/sessionStore.test.ts` 增断言：分页请求 `includeSubagents === false`，
      翻页 cursor 推进与 `hasMore` 收敛正确
- 提交：`fix(session): exclude subagents from sidebar pagination`

## T2 — 侧边栏列表加载后自动填充视口（核心）
- [ ] `WindowSideBar.vue` 新增 `ensureSessionListFilled()`：
      `scrollHeight <= clientHeight && hasMore && !loadingMore` 时循环 `loadNextPage()`
- [ ] 加 `isFilling` 重入防护与轮数上限
- [ ] 在 `onMounted` 首屏加载后、以及会话列表/agent 过滤变化的 `watch` 中触发复检
- [ ] `test/renderer/components/WindowSideBar.test.ts` 增用例：
      - 未填满视口 + `hasMore` → 自动持续加载至 `hasMore=false`
      - 已填满视口 → 不额外自动加载
- 提交：`fix(sidebar): auto-fill session list viewport to resume pagination`

## T3 — （次要）侧边栏搜索接入后端 FTS
- [ ] 搜索关键词非空时调用 `sessionClient.searchHistory(query)`，合并命中会话
- [ ] 加 debounce
- [ ] 如需要，`SessionClient.ts` 暴露 `searchHistory`
- [ ] 增搜索命中未加载会话的用例
- 提交：`feat(sidebar): search history via backend FTS`
- 备注：可拆为独立后续 PR，不阻塞 T1+T2 合入

## T4 — 质量门禁与收尾
- [ ] `pnpm run format && pnpm run i18n && pnpm run lint && pnpm run typecheck`
- [ ] `pnpm test:renderer`（必要时 `pnpm test`）
- [ ] PR 描述附 BEFORE/AFTER 行为说明，`Closes #1762`，base 分支 `dev`
- [ ] 实现完成后按 SDD 保留策略：删除本目录 `plan.md` / `tasks.md`，
      `spec.md` 作为回归契约保留（两周后若无价值再清理）
