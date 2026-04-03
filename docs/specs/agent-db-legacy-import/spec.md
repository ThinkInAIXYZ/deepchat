# Agent DB Legacy Import Spec

## Goal

将主数据库从 `chat.db` 切换到 `agent.db`，并在不删除旧库数据的前提下，把历史数据异步导入新表结构，且支持失败后手动重试。

## Scope

1. 主库文件切换为 `app_db/agent.db`。
2. 启动后后台任务读取旧库 `app_db/chat.db` 并导入：
   - `conversations` -> `new_sessions` / `deepchat_sessions`
   - `messages` -> `deepchat_messages`（变体仅保留最后一个）
   - `message_attachments(search_result/search_results)` -> `deepchat_message_search_results`
3. `searchresult` 读写统一走新结构：
   - 新链路写入：tool 结果中的 `application/deepchat-webpage`
   - 新链路读取：`agentSessionPresenter.getSearchResults()`
4. 导入状态持久化与重试：
   - 新表 `legacy_import_status`
   - IPC：`getLegacyImportStatus` / `retryLegacyImport`
5. 不删除旧库文件，仅在导入任务中按需只读打开并在完成后关闭连接。

## Non-Goals

1. 不实现旧 chat 表结构的兼容兜底建表。
2. 不在本阶段删除所有 legacy 组件，仅注释/迁移关键调用点。
3. 不处理跨版本全量回填的 UI 引导。

## Constraints

1. 旧库读取需使用 `SELECT *`，避免字段漂移导致导入失败。
2. 导入任务必须非阻塞启动流程。
3. 数据导入需要幂等，可重复执行。
