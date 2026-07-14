# 历史消息读取热路径收敛

## 状态

已实现。

> Historical implementation note: the boolean history checks now belong to the Lifecycle and Turn
> coordinators. `AgentSessionPresenter` and its main-process interface were retired in stage 3.

## 问题

发送消息前，`AgentSessionPresenter` 只需要知道会话里“有没有消息”，但当前会读取并组装
全部历史消息。完整组装还会读取用户正文、文件、链接和助手内容块，因此消息越多，发送前的
无效工作越多。

完整历史读取已经批量查过文件、链接和助手内容块。批量结果里没有某个消息的条目，本意是
这个消息没有对应内容；当前代码却再次按单条消息查询，形成重复读取。

原审计使用测试侧夹具记录过同一路径的历史基线：最初为 8 次完整读取、120 条 SQL；加入
存在性查询后为 7 次、105 条 SQL；信任空的批量分组后为 7 次、35 条 SQL。这些数字只说明
改动动机，本次 PR 不引入或重建测量平台。

## 代码真相

- `deepchat_messages` 已有 `(session_id, order_seq)` 索引，可以用
  `SELECT 1 ... LIMIT 1` 判断会话是否有消息，不需要取消息正文。
- `DeepChatMessageStore.toRecords()` 会先调用 `loadStructuredMaps()`，一次批量加载用户正文、
  文件、链接和助手内容块。
- 批量 map 没有文件、链接或助手内容块的 key，表示该批查询返回空结果，不表示查询失败。
- 用户结构化主行缺失仍可能来自旧数据，必须继续按消息读取一次；仍然缺失时返回消息头中的
  原始内容。
- 助手结构化内容块为空时，消息头中的原始内容仍是兼容旧数据的真实来源，必须保留。

## 改动范围

1. 在 `DeepChatMessagesTable` 增加索引友好的存在性查询，并经
   `DeepChatMessageStore`、`AgentRuntimePresenter` 和 `IAgentImplementation` 贯通。
2. `AgentSessionPresenter` 中只需要布尔值的发送前检查和会话历史存在性检查改用存在性查询。
3. 已完成批量查询时，缺失的文件、链接和助手内容块分组直接按空数组处理。

## 行为不变项

- 首次发送前是否触发异步标题生成的判断不变。
- 草稿转正式会话、标题截取和消息入队顺序不变。
- 发送前存在性查询失败仍向上抛出，不接受一条状态不明的新输入。
- 查找可复用空草稿和迁移预检时，存在性查询失败仍保守地视为“有消息”，避免覆盖或错误
  处理已有会话。
- 旧数据缺少用户结构化主行时，继续使用单条兼容读取和消息头回退。
- 助手没有结构化内容块时，继续返回消息头中的原始内容。
- 不改数据库结构，不增加缓存、开关、事件、观测器或新的运行时状态。

## 验收

- 存在性查询能区分空会话和非空会话，并使用已有 session 索引。
- 发送前只调用存在性查询，不为布尔判断加载完整历史或消息 ID 列表。
- 批量结构化读取对空文件、空链接和空助手内容块不再执行逐消息查询。
- 旧用户主行缺失和助手原始内容回退保持可用。
- 运行相关定向 Vitest、Electron 原生 SQLite 补充验证、`typecheck:node`、格式化、i18n、
  lint 和 `git diff --check`；不运行 full suite、E2E 或 build。

## 回滚

本改动没有数据迁移。若发现兼容性回归，可整体回滚该提交；数据库和既有消息内容不需要恢复。

## 验证结果

- 相关 5 个 Vitest 文件通过：307 个测试通过，2 个原生 SQLite 测试因 Node ABI 跳过。
- 使用 Electron ABI 单独运行原生 SQLite 测试：3 个测试全部通过，存在性查询使用已有 session
  索引。
- `pnpm run typecheck:node`、`pnpm run format`、`pnpm run i18n`、`pnpm run lint` 和
  `git diff --check` 通过。
- 按范围约束未运行 full suite、E2E 或 build。
