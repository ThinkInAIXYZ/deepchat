# `agent.db` 主链路 SQLite 结构化收敛规格

## 概述

本规格覆盖 `agent.db` 新主链路中的 `new_sessions` 与 `deepchat_*` 数据域，目标是把仍然依赖
JSON blob 的热路径收束为结构化 SQLite 表，同时保持 legacy `conversations/messages` 与旧
`chat.db` 导入导出兼容层可继续工作。

这轮改造优先解决三个慢点：

1. 会话恢复时一次性拉全量消息
2. 历史搜索依赖消息 JSON 扫描
3. assistant streaming 期间频繁整条重写 `deepchat_messages.content`

## 范围

### In Scope

- `sessions.restore` 改为“恢复最近一页消息”
- 新增 `sessions.listMessagesPage`
- 新增主链路结构化表：
  - `deepchat_user_messages`
  - `deepchat_user_message_files`
  - `deepchat_user_message_links`
  - `deepchat_assistant_blocks`
  - `new_session_active_skills`
  - `new_session_disabled_agent_tools`
  - `deepchat_search_documents`
  - `deepchat_search_documents_fts`
- renderer 聊天页改为首屏分页恢复 + 顶部继续加载历史
- 自动 migration + 可重入 backfill
- `LegacyChatImportService` 直接写入新结构化热路径

### Out of Scope

- 退役 legacy `conversations/messages`
- 物理删除 `deepchat_messages.content`
- 物理删除 `new_sessions.active_skills` / `disabled_agent_tools`
- 把 `metadata`、`subagent_meta_json`、`deepchat_pending_inputs.payload_json` 也拆成结构化表

## 用户故事

### US-1：重开大线程更快

作为用户，我希望重新打开历史很长的会话时，应用只恢复我当前最需要的一页消息，而不是等待全量消息回放完成。

### US-2：历史搜索更稳定

作为用户，我希望搜索历史记录时结果能更快出现，并且在 SQLite FTS 不可用时仍能自动退回普通查询。

### US-3：流式回答不再频繁重写整条消息

作为系统维护者，我希望 assistant streaming 只增量写 block 级数据，减少热路径上的整条 JSON 重写。

### US-4：升级不打断现有数据

作为已有用户，我希望升级后无需手动迁移；旧数据会被自动兼容读取并在后台逐步回填。

## 功能需求

### A. 分页恢复

- [x] `sessions.restore` 输入支持可选 `limit`
- [x] `sessions.restore` 输出包含 `messages`、`nextCursor`、`hasMore`
- [x] 默认仅恢复最近 `100` 条消息
- [x] 新增 `sessions.listMessagesPage({ sessionId, cursor, limit })`
- [x] cursor 固定为 `{ orderSeq, id }`
- [x] 只支持向更老消息反向翻页

### B. 结构化消息存储

- [x] user message 文本、文件、链接拆到独立表
- [x] assistant blocks 拆到 `deepchat_assistant_blocks`
- [x] active skills / disabled agent tools 拆到独立表
- [x] repository 读路径优先读结构化表，缺行时按记录级别回退旧 JSON

### C. 搜索索引

- [x] 新增普通搜索文档表与 FTS5 虚表
- [x] 会话只索引标题
- [x] 用户消息只索引可见文本
- [x] 助手消息只索引可见内容、错误文本与可见 plan 文本
- [x] 不索引 tool call 原始 JSON、附件元数据、未稳定的 streaming 临时块
- [x] 查询顺序固定为 FTS5 优先、失败后回退 `LIKE`

### D. 流式写入

- [x] streaming 期间只增量 upsert `deepchat_assistant_blocks`
- [x] 最终进入 `sent/error` 时才写回 `deepchat_messages.content`
- [x] tool interaction、retry、edit、fork、delete 统一经过结构化读写路径

### E. 自动迁移与回填

- [x] schema migration 自动创建新表
- [x] 启动后后台执行一次性、可重入 backfill
- [x] backfill 覆盖消息结构化拆分、session skills/tools 拆分与搜索索引初始化
- [x] backfill 不阻塞应用启动

## 验收标准

- [x] 恢复大线程时首屏只加载最近一页消息
- [x] 滚动到顶部可以继续加载更老消息
- [x] `chat.sendMessage` 不再通过全量消息回查 `requestId/messageId`
- [x] FTS5 可用时优先命中全文索引，不可用时自动回退 `LIKE`
- [x] old rows 未完成回填时，新读路径仍能通过 JSON fallback 正常工作
- [x] legacy import 新写入数据会同步进入结构化热路径

## 约束

1. 保持 typed route / typed client 体系，不回退到 legacy transport。
2. renderer 继续复用 `ChatMessageRecord.content` 现有 JSON 形态；结构化重组只发生在 repository 边界。
3. migration 必须幂等，backfill 必须可重入。
4. 只改新主链路，不动 legacy `conversations/messages` 的兼容职责。

## 非目标

1. 本期不做跨页双向游标。
2. 本期不引入新的 UI 搜索入口。
3. 本期不做旧 JSON 列物理清理。

## 开放问题

无。
