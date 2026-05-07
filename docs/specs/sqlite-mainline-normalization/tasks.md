# `agent.db` 主链路 SQLite 结构化收敛任务清单

## T0 规格

- [x] 新增 `docs/specs/sqlite-mainline-normalization/spec.md`
- [x] 新增 `docs/specs/sqlite-mainline-normalization/plan.md`
- [x] 新增 `docs/specs/sqlite-mainline-normalization/tasks.md`

## T1 共享契约与 typed routes

- [x] 新增 `MessagePageCursor`
- [x] 新增 `ChatMessagePageResult`
- [x] 新增 `MessageStartResult`
- [x] 扩展 `sessions.restore`
- [x] 新增 `sessions.listMessagesPage`
- [x] 更新 `SessionClient`

## T2 主链路分页恢复

- [x] `SessionService.restoreSession()` 改为最近一页恢复
- [x] `AgentSessionPresenter` / `AgentRuntimePresenter` 增加分页消息读取
- [x] `MessageRepository` 增加 `listPageBySession()`
- [x] renderer `messageStore.loadMessages()` 只拉第一页
- [x] `ChatPage.vue` 顶部触发继续加载历史并保持滚动锚点

## T3 结构化 SQLite 表

- [x] 新增 `deepchat_user_messages`
- [x] 新增 `deepchat_user_message_files`
- [x] 新增 `deepchat_user_message_links`
- [x] 新增 `deepchat_assistant_blocks`
- [x] 新增 `new_session_active_skills`
- [x] 新增 `new_session_disabled_agent_tools`
- [x] 将新表接入 `sqlitePresenter` 与 `schemaCatalog`

## T4 热路径读写收口

- [x] user message 写入同步落到结构化表
- [x] assistant streaming 改为 block 级增量写
- [x] finalize / error 时写回稳定 JSON + 搜索索引
- [x] repository 读路径优先结构化，缺行回退 JSON
- [x] clone / delete / recover / update content 同步处理结构化表

## T5 搜索索引

- [x] 新增 `deepchat_search_documents`
- [x] 新增 `deepchat_search_documents_fts`
- [x] 接入 session create / rename / delete 同步
- [x] 接入 message create / edit / delete / fork / import 同步
- [x] `searchHistory()` 改为 FTS 优先、`LIKE` 回退

## T6 自动迁移与回填

- [x] 新增 migration 版本并创建新表
- [x] 实现后台 normalization backfill
- [x] backfill session skills / disabled tools
- [x] backfill user / assistant 结构化消息
- [x] backfill 搜索文档
- [x] 启动后 hook 自动触发一次可重入 backfill

## T7 兼容性

- [x] `LegacyChatImportService` 导入后直接补齐结构化热路径
- [x] 保留 legacy `conversations/messages` 兼容职责
- [x] 保留旧 JSON 列作为 fallback source

## T8 测试与验证

- [x] 更新 renderer `ChatPage` 分页相关测试
- [x] 更新 main `messageStore` 结构化读写测试
- [x] 更新 `agentSessionPresenter` 搜索与 send/createSession 测试
- [x] 运行相关 main / renderer vitest 用例
- [ ] 运行全量 `pnpm test`

## T9 质量检查

- [ ] `pnpm run format`
- [ ] `pnpm run i18n`
- [ ] `pnpm run lint`
- [x] `pnpm run typecheck`
