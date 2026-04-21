# Startup Orchestration 任务拆分

## T0 文档同步

- [x] 更新 `spec.md` 为 `agent first, session staged`
- [x] 更新 `plan.md` 为 bootstrap shell + staged session flow
- [x] 更新 `acceptance.md` 为 staged loading 验收口径
- [x] 更新 `tasks.md`，拆分已完成项与 follow-up

## T1 Bootstrap Shell

- [x] 新增 `startup.getBootstrap` route
- [x] 新增 `StartupBootstrapShell` 共享类型
- [x] 返回 `activeSessionId`
- [x] 返回 `activeSession?`
- [x] 返回 bootstrap agents
- [x] 返回 `defaultProjectPath`
- [x] 返回 `startupRunId`

## T2 Renderer Critical Path

- [x] `ChatTabView` critical path 改为 bootstrap shell -> page router
- [x] `agentStore` 支持 `applyBootstrapAgents(...)`
- [x] `sessionStore` 支持 `applyBootstrapShell(...)`
- [x] `projectStore` 支持 `applyBootstrapDefaultProjectPath(...)`
- [x] `pageRouter.initialize()` 优先消费 `activeSessionId`
- [x] `sessionStore.fetchSessions()` 退出 critical path

## T3 Session Lightweight Paging

- [x] `new_sessions` 增加 cursor pagination
- [x] 排序固定为 `updated_at DESC, id DESC`
- [x] 默认 page size 设为 `30`
- [x] 新增 `sessions.listLightweight`
- [x] 新增 `sessions.getLightweightByIds`
- [x] 支持 `prioritizeSessionId`
- [x] `WindowSideBar` 增加首批 skeleton
- [x] `WindowSideBar` 增加滚动翻页
- [x] 翻页只 append

## T4 Active Session Overlay

- [x] 新增 `SessionListItem`
- [x] 新增 `ActiveSessionSummary`
- [x] `sessionStore.activeSession` 由 list item + overlay 组合
- [x] `messageStore.loadMessages()` 返回 restore session
- [x] `ChatPage` 用 restore session 回填 active summary

## T5 Deferred Warmups

- [x] 新增 startup deferred queue
- [x] `modelStore.initialize()` 延后
- [x] `ollamaStore.initialize()` 延后
- [x] active thread restore 延后
- [x] `ACP` draft/bootstrap 延后
- [x] `ACP` config warmup 延后
- [x] provider warmup 增加 `startup.provider.warmup.deferred` 日志

## T6 增量事件回流

- [x] `sessionStore` 支持 `refreshSessionsByIds(...)`
- [x] `sessionStore` 支持 `removeSessions(...)`
- [x] `created/updated/list-refreshed` 优先走定向 upsert
- [x] `deleted` 走本地 remove
- [x] `activated/deactivated` 只更新 active session
- [x] main 侧 `sessions.updated` 携带具体 `sessionIds`
- [x] merge 规则固定为 `id` 去重 + `updatedAt DESC, id DESC`

## T7 观测与校验

- [x] 新增 `startup.bootstrap.ready`
- [x] 新增 `startup.session.first-page.ready`
- [x] 新增 `startup.session.page.appended`
- [x] 新增 `startup.provider.warmup.deferred`
- [x] 运行 `pnpm run format`
- [x] 运行 `pnpm run i18n`
- [x] 运行 `pnpm run lint`
- [x] 运行 `pnpm run typecheck`

## T8 Follow-up

- [ ] 继续收敛 `providerStore.initialize()` 的启动优先级
- [ ] 增加 session list virtualization
- [ ] 为 sidebar 搜索补全量搜索接口
- [ ] 增加更完整的 main/splash startup trace
