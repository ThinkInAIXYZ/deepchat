# Agent 输入区高级配置回归（默认 Agent 模式）

## 背景

`newAgent` 链路上线后，默认 Agent 输入区丢失了旧输入框里的高级模型配置能力（system prompt、temperature、contextLength、maxTokens 等），导致用户无法在默认 Agent 体验中按会话精细控制生成参数。

## 目标

1. 在默认 Agent 模式恢复高级配置能力，并保持新 UI 风格。
2. 高级配置入口放在权限按钮左侧，以 overlay modal 覆盖输入框上方展示。
3. 参数按会话级持久化，切会话/重启可恢复。
4. `Effort` 保持外置快捷入口，不进入 modal。

## 已确认决策

1. 仅默认 Agent（DeepChat）展示该能力，ACP 模式不展示。
2. `Effort` 外置并按模型能力显隐。
3. 保存策略固定为实时防抖（300ms），无“应用/取消”。
4. system prompt 来源复用 settings 的系统提示词数据源（含 `Empty`）。
5. 历史会话若存在非预设 system prompt，UI 显示只读临时项 `Current custom`。

## 范围

1. 共享类型新增会话生成配置模型，并接入 newAgent IPC。
2. deepchat 会话表新增生成配置字段与迁移。
3. deepchat 运行时统一按会话配置构造上下文和模型参数。
4. 渲染层补齐草稿态与活动会话态双路径写回。
5. 状态栏新增高级配置入口与 overlay modal。
6. i18n 增补 `zh-CN`、`en-US`。

## 非目标

1. 不在 modal 中放 `Effort`。
2. 不改动当前“活动会话切模型”语义。
3. 不改 ACP 现有权限与输入交互。

## 数据与持久化

`deepchat_sessions` 新增列：

1. `system_prompt`
2. `temperature`
3. `context_length`
4. `max_tokens`
5. `thinking_budget`
6. `reasoning_effort`
7. `verbosity`

迁移策略：

1. 旧行允许 `NULL`。
2. 运行时读取时对 `NULL` 回落为“当前模型默认值 + 默认 system prompt”。
3. 不阻塞现有会话读取。

## 验收标准

1. NewThread 修改高级配置后，首条消息立即按该配置执行。
2. Chat 页面中途修改高级配置，仅影响后续消息。
3. 切会话后配置恢复；重启后仍可恢复。
4. settings 调整系统提示词预设后，modal 下拉可读取最新列表。
5. ACP 模式下不展示高级配置入口，权限行为不回归。

## 测试矩阵

主进程：

1. deepchat_sessions 迁移后字段可读写。
2. initSession 持久化会话生成配置。
3. process/resume/runStream 使用会话配置。
4. updateGenerationSettings 的 sanitize/clamp 正确。
5. newAgent createSession 透传 generationSettings。
6. newAgent get/updateSessionGenerationSettings 代理与异常正确。

渲染层：

1. NewThread 创建会话携带 draft generationSettings。
2. 默认 Agent 显示高级配置入口，ACP 不显示。
3. Effort 仅在支持时显示且选项按模型能力变化。
4. modal 仅提供 system prompt 下拉（无文本输入）。
5. 连续修改参数时按 300ms 防抖写回。
