# Tool Output Materialization（工具输出文件化）规格

## 目标与边界
本 spec 专注解决“tool call 返回内容过大导致上下文膨胀/截断丢信息”的问题，且必须与 auto-tools 解耦：
- 适用于所有模式：traditional / auto-tools / ACP
- 只改变“输出承载方式”，不改变工具语义与权限流程

依赖：
- `docs/specs/context-files/spec.md`（Context Files 与 ContextRef 标准）

## 核心行为
当任意 tool call 的输出超过阈值时：
1) 完整输出写入 context artifacts（按 toolCallId 归档）
2) 返回给模型/对话的内容只包含：
   - 短摘要（实现端生成）
   - 少量可读片段（例如头/尾各 N 行）
   - `ContextRef` 指向完整输出
   - 明确提示模型如何继续获取（建议：先 `context.tail` 或 `context.grep`）

严禁：
- 静默截断且无法回溯原始内容

## 归档规则
- 文件归档位置：`<userData>/context/<conversationId>/artifacts/tool/`
- 文件命名：`<toolCallId>.<ext>`
  - 若输出是 JSON 且可序列化，优先 `.json`
  - 否则 `.txt`
- `ContextRef`：
  - `kind = 'artifact'`
  - `hint` 至少包含：tool name、server name（如有）、toolCallId、以及输出大小

### 物化策略（必须 eager）
工具输出属于“源数据型 artifacts”：一旦被裁切出上下文，就必须可回溯。因此这里的 `ContextRef` 必须采用 eager 物化：
- 在 tool call 结束时立即写入 artifacts 文件
- `ContextRef.id` 必须立即可读（不依赖 SQLite 可重建）
- export/import 必须包含对应 artifacts，否则 ref 会失效

## 阈值与摘要
### 阈值
建议配置项：
- `maxInlineChars`（默认例如 4000）
- `maxInlineBytes`（默认例如 16KB）

任意一个触发都进入 materialization（以更严格为准）。

### 摘要（实现端生成）
摘要最小应包含：
- tool：`<server>/<toolName>`、toolCallId
- size：原始输出大小、是否为 JSON
- snippet：头/尾片段（可配置：各 40 行或各 2KB）
- errors：若输出包含常见 error/stacktrace 关键词，提取相关段落（可选）
- ref：`ContextRef`

模型侧的建议读取策略（固定文案即可）：
- “如果需要更多细节：先 `context.tail(refId, 200)`，或 `context.grep(refId, 'Error|Exception', ...)`”

## 模型上下文写入策略（适配两种 function call 模式）
### 1) Native function-calling 模型
- 当前会把 tool message content 直接写入 `conversationMessages`。
- 新策略：tool message content 改为“摘要 + ContextRef”，避免把原始大输出注入上下文。

### 2) Legacy（把 tool record 文本拼到 assistant content）
- 当前会拼接 `<function_call>{...response: toolResponse.content}</function_call>`。
- 新策略：response 字段改为“摘要 + ContextRef”，并保证原始内容在 artifacts 可读。

## UI/可观测性
- UI 的 tool block 展示同样的摘要与片段，并提供：
  - “查看完整输出”（分页 read）
  - “在输出中搜索”（grep）
  - “查看末尾”（tail）
- dev mode 可记录：materialization 命中次数、平均节省的字符数

## ACP 终端输出（与本 spec 的关系）
ACP `execute_command` 的输出也应视作“工具输出”：
- 不使用固定长度截断作为最终策略
- 完整输出进入 `artifacts/terminal/<snippetId>.log`
- 返回给模型/UI 的只是一小段 + `ContextRef`

注：ACP 终端的具体落点可在实现时作为单独任务，但输出承载与 ref 规则沿用本 spec。

## 安全与权限
- 不改变既有 permission pipeline（写/执行依旧需要审批）。
- context artifacts 的读取通过 Context Files API 完成（受会话范围限制）。
- 若用户导出会话，需要明确包含 artifacts（否则 ref 失效）。
