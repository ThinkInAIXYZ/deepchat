# Agent DB Legacy Import Plan

## Implementation Steps

1. Database baseline
   - `DatabaseInitializer` 默认路径改为 `agent.db`
   - `SQLitePresenter` 仅自动创建新栈表（保留 `acp_sessions`）
   - 新增表：
     - `deepchat_message_search_results`
     - `legacy_import_status`

2. Searchresult migration
   - `agentRuntimePresenter/dispatch.ts` 解析 `application/deepchat-webpage`
   - 同时写入：
     - assistant `search` block
     - `deepchat_message_search_results`
   - `agentSessionPresenter.getSearchResults()` 从新表读取
   - 前端引用点改为 `agentSessionPresenter.getSearchResults()`

3. Legacy import pipeline
   - 新增 `LegacyChatImportService`
   - after-start hook 非阻塞触发后台导入
   - 从 `chat.db` 读取旧表并映射写入新表
   - 变体策略：assistant 仅保留最后一个 variant
   - 导入状态与错误写入 `legacy_import_status`

4. Retry and observability
   - `agentSessionPresenter` 暴露：
     - `getLegacyImportStatus()`
     - `retryLegacyImport()`
   - 失败后允许手动重试，重复导入保持幂等

5. Supporting updates
   - `SyncPresenter` 与 `DevicePresenter` 路径切到 `agent.db`
   - `SyncPresenter` 计数逻辑兼容 `new_sessions` / `conversations`

## Risks

1. 旧链路若仍访问 legacy chat 表，会因不建表而失败。
2. 导入过程中的异常 JSON 需要降级处理并持续导入后续数据。
3. ACP 旧会话字段可能存在版本差异，需以可选字段方式解析。

## Rollout

1. 先发布后台导入与状态能力，不删旧库文件。
2. 观察导入状态与错误分布后，再移除剩余 legacy 调用点。
