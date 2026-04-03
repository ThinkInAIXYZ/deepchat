# Message Trace 独立落库实施计划

## 1. 关键决策

1. Trace 从“历史反推”改为“provider 请求侧采集”。
2. Trace 与 Toolbar 主功能拆分为独立发布项。
3. 同一消息允许多条 trace，默认展示最新。
4. 仅存脱敏数据；mask 策略保留敏感值尾 4 位。

## 2. 数据层设计

### 2.1 新表

新增 `deepchat_message_traces`：

1. 主键：`id`
2. 关联字段：`message_id`, `session_id`
3. 请求标识：`request_seq`
4. 请求信息：`provider_id`, `model_id`, `endpoint`, `headers_json`, `body_json`
5. 控制字段：`truncated`
6. 时间字段：`created_at`

索引：

1. `idx_trace_message_seq (message_id, request_seq DESC)`
2. `idx_trace_session_time (session_id, created_at DESC)`

### 2.2 迁移

1. 增加新 Table 类并纳入 `SQLitePresenter` 初始化。
2. 迁移版本提升至新版本（高于当前最大版本）。
3. 删除会话/消息时同步清理 trace（应用层或 FK 级联二选一，默认应用层显式删除）。

## 3. 采集链路设计

### 3.1 Trace 上下文

在 `agentRuntimePresenter.runStreamForMessage` 构建 trace context：

1. `sessionId`
2. `messageId`
3. `providerId`
4. `modelId`
5. `traceEnabled`（读取 `traceDebugEnabled`）
6. `persistTrace(payload)` 回调

### 3.2 Provider 接入

1. 为 provider 请求流程增加统一 trace hook（在最终请求参数生成后、网络请求发出前）。
2. wrapper provider（如 `dashscope/doubao/siliconcloud`）复用父类 hook 并透传上下文。
3. 非 OpenAI 系 provider（Anthropic/Gemini/Ollama/Vertex/AWSBedrock/Copilot/VoiceAI/ACP）分别在其请求构造点调用 hook。

### 3.3 写库顺序

1. provider 构建最终 `endpoint/headers/body`。
2. 调用脱敏器生成可落库 payload。
3. 计算大小并按 512KB 限制截断。
4. 写入 `deepchat_message_traces` 并分配 `request_seq`。

## 4. 安全与脱敏

1. 扩展 `src/main/lib/redact.ts`：
   - 新增“尾 4 位保留”掩码能力。
   - Header/Body 的敏感键统一进入掩码策略。
2. 数据库只接收脱敏后对象。
3. 日志中禁止输出未脱敏请求体。

## 5. 查询与 UI 接口

### 5.1 IPC / Presenter

在 `IAgentSessionPresenter` 增加：

1. `listMessageTraces(messageId: string): Promise<MessageTraceRecord[]>`
2. `getMessageTraceCount(messageId: string): Promise<number>`（可选；也可在消息查询时聚合）

### 5.2 消息列表可见性

1. `getMessages(sessionId)` 返回 `traceCount`（推荐），避免逐条查询。
2. 渲染层 `MessageToolbar` 根据 `traceCount > 0` 控制 Trace 按钮显隐。

### 5.3 TraceDialog

1. 打开时获取该消息 trace 列表。
2. 默认选中 `request_seq` 最大的一条。
3. 提供历史 trace 轮次切换。

## 6. 测试策略

### Main

1. 表结构与迁移测试（建表、索引、版本升级）。
2. 脱敏测试（尾 4 位保留、生效键覆盖、无明文泄露）。
3. provider trace hook 触发测试（开启/关闭 traceDebugEnabled）。
4. 大 payload 截断测试（`truncated=true`）。
5. 消息/会话删除时 trace 清理测试。

### Renderer

1. Trace 按钮显隐测试（有/无 traceCount）。
2. TraceDialog 默认最新条目与历史切换测试。
3. 接口错误态（空数据、查询失败）展示测试。

## 7. 风险与回退

1. 风险：多 provider 接入点分散，易漏采。
   - 缓解：建立 provider 接入清单并加覆盖测试。
2. 风险：trace 体积膨胀影响 DB。
   - 缓解：512KB 上限 + 截断标记 + 索引控制。
3. 风险：敏感数据泄漏。
   - 缓解：统一脱敏模块、落库前强制调用、测试校验。
4. 回退：可通过 `traceDebugEnabled` 全局关闭采集，UI 自动隐藏按钮。
