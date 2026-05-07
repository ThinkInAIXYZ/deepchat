# `agent.db` 主链路 SQLite 结构化收敛实施计划

## 1. 目标

把 `new_sessions` 与 `deepchat_*` 主链路中的热路径 JSON 依赖下沉到结构化 SQLite 表，同时保持：

1. renderer 侧消息类型与 exporter 兼容
2. legacy import / export 不回归
3. 升级过程不要求用户手动迁移

## 2. 关键设计决策

### 2.1 保留头表，拆出热字段

`deepchat_messages` 继续作为消息头表，保留：

- `id`
- `session_id`
- `order_seq`
- `role`
- `status`
- `is_context_edge`
- `created_at`
- `updated_at`

同时新增结构化表承载热字段：

- `deepchat_user_messages`
- `deepchat_user_message_files`
- `deepchat_user_message_links`
- `deepchat_assistant_blocks`
- `new_session_active_skills`
- `new_session_disabled_agent_tools`

`deepchat_messages.content` 与 `new_sessions.active_skills` / `disabled_agent_tools` 保留为回退源和兼容字段，但不再作为主链路读写来源。

### 2.2 repository 边界重组 JSON

renderer 与 exporter 仍消费 `ChatMessageRecord.content` 的 JSON 字符串形式，因此结构化内容只在
`DeepChatMessageStore` 边界按需重组。

这保证：

1. 新持久化模型不向 renderer 扩散
2. 旧视图与导出逻辑无需整体重写

### 2.3 恢复链路分页化

- `sessions.restore(sessionId, limit?)` 返回最新一页
- `sessions.listMessagesPage()` 继续向更老消息翻页
- renderer `messageStore.loadMessages()` 只请求第一页
- `ChatPage.vue` 在接近顶部时触发历史追加，并保持滚动锚点稳定

### 2.4 搜索索引与降级

搜索索引使用两层表：

1. `deepchat_search_documents`
2. `deepchat_search_documents_fts`

查询顺序：

1. 先执行 FTS5
2. FTS 不可用或执行失败时降级到 `LIKE`

索引同步点：

1. session create / rename / delete
2. message create / edit / delete / clear / fork / import
3. assistant message finalize / error

### 2.5 streaming 改成 block 级增量写

assistant streaming 期间：

1. `deepchat_assistant_blocks` 增量 replace
2. `deepchat_messages.status` 更新为 `pending`
3. 不再重复重写 `deepchat_messages.content`

最终态：

1. 进入 `sent/error`
2. 再把完整 blocks 序列化回 `deepchat_messages.content`
3. 同步搜索文档

### 2.6 migration + background backfill

schema migration 在启动时只做表创建与版本升级，不阻塞 UI。

后台 backfill 做三件事：

1. 从 `deepchat_messages.content` 拆 user / assistant 结构化数据
2. 从 `new_sessions` JSON 列拆 skills / disabled tools
3. 初始化搜索文档与 FTS 索引

backfill 需要：

1. 可重入
2. 记录级 fallback 安全
3. 与 legacy import 共用结构化写入 helper

## 3. 公开接口变化

### 3.1 Shared types

- `MessagePageCursor`
- `ChatMessagePageResult`
- `MessageStartResult`

### 3.2 Typed routes

- 扩展 `sessions.restore`
- 新增 `sessions.listMessagesPage`

### 3.3 Internal ports

- `MessageRepository.listPageBySession(...)`
- `IAgentImplementation.listMessagesPage(...)`
- `IAgentImplementation.processMessage(...) => { requestId, messageId }`

## 4. 兼容性策略

### 4.1 Legacy data

- 不删除 `conversations/messages`
- 不删除旧 `chat.db` import/export 兼容层
- `LegacyChatImportService` 导入后立即写结构化热路径

### 4.2 Read fallback

如果某条消息尚未完成结构化回填：

1. user 消息回退到 `deepchat_messages.content`
2. assistant blocks 回退到 `deepchat_messages.content`
3. session skills / disabled tools 回退到 `new_sessions` JSON 列

## 5. 测试策略

### 5.1 Main

- migration / backfill 幂等
- messageStore 结构化读写与 fallback
- session restore / page cursor / sendMessage 返回值
- searchHistory 的 FTS / LIKE 双路径

### 5.2 Renderer

- 首屏只恢复一页
- 向上翻页前插不跳动
- streaming + optimistic message + pagination 并存

### 5.3 Smoke

- 创建会话
- 重开大会话
- 顶部加载历史
- 历史搜索
- 编辑 / 重试 / 导出
- 升级后重启

## 6. 风险与缓解

### 风险 1：backfill 半途被中断

缓解：

1. 读路径保留记录级 fallback
2. 启动后 hook 可重复执行

### 风险 2：FTS5 在当前 SQLite 运行时不可用

缓解：

1. 表创建失败时保留普通表
2. 查询自动降级到 `LIKE`

### 风险 3：renderer 滚动位置抖动

缓解：

1. 顶部翻页前记录旧 scrollHeight 与 scrollTop
2. 消息前插后通过差值恢复锚点
