# Agent 输入区高级配置回归实施计划

## 1. 类型与接口

1. 新增 `SessionGenerationSettings`（共享类型）。
2. `CreateSessionInput` 增加 `generationSettings?: Partial<SessionGenerationSettings>`。
3. `IAgentSessionPresenter` 增加：
   - `getSessionGenerationSettings(sessionId)`
   - `updateSessionGenerationSettings(sessionId, settings)`
4. `IAgentImplementation` 增加可选：
   - `getGenerationSettings?`
   - `updateGenerationSettings?`

## 2. 主进程（newAgent + deepchat）

1. `agentSessionPresenter.createSession` 透传 `generationSettings` 到 `agent.initSession`。
2. `agentSessionPresenter` 新增 generation settings 读写代理，保持 permission 相关接口不变。
3. `agentRuntimePresenter`：
   - `initSession` 构造并持久化会话配置（模型默认 + 默认 system prompt + 覆盖值）。
   - `processMessage` / `resumeAssistantMessage` 读取会话配置构建上下文。
   - `runStreamForMessage` 使用会话 `temperature/maxTokens`，并将
     `contextLength/thinkingBudget/reasoningEffort/verbosity` 合并到 `modelConfig`。
   - 新增 `getGenerationSettings` / `updateGenerationSettings`。
   - `updateGenerationSettings` 做 sanitize/clamp 并同步内存与 DB。

## 3. 持久化与迁移

1. `deepchat_sessions` 迁移版本升级至 `12`。
2. 新增 generation settings 列，旧行允许 `NULL`。
3. `DeepChatSessionStore` 新增 generation settings 的 get/update 封装。

## 4. 渲染层

1. `draftStore` 新增 generation settings 草稿字段与 `toGenerationSettings`。
2. `NewThreadPage` 创建会话时附带 `generationSettings`。
3. `ChatStatusBar`：
   - 权限左侧新增高级配置按钮。
   - overlay modal 覆盖输入框上方（非全屏遮罩）。
   - modal 字段：system prompt 下拉 + 温度 + 上下文长度 + 最大输出 + 按能力显示 thinking budget / verbosity。
   - Effort 外置，按能力显隐，走会话/草稿双路径写回。
   - 保存策略 300ms 防抖。

## 5. i18n

1. 新增 `chat.advancedSettings.*`。
2. system prompt 的 `Empty` 复用 `promptSetting.emptySystemPromptOption`。

## 6. 测试与验证

1. 更新 main 单测：deepchat/newAgent generation settings 透传、读写、sanitize。
2. 更新 renderer 单测：NewThreadPage 携带 draft generation settings。
3. 执行：
   - `pnpm run format`
   - `pnpm run lint`
   - 相关测试集

## 7. 风险与回退

1. 风险：旧会话 `NULL` 字段导致运行时配置不完整。
   - 方案：运行时统一 fallback。
2. 风险：前端多入口写回导致状态竞争。
   - 方案：会话/草稿分路径 + 防抖聚合写回。
3. 回退：仅需隐藏新入口并停用 generation settings 写回，数据库新增列可兼容保留。
