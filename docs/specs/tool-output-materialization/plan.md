# Tool Output Materialization（工具输出文件化）实施计划

## 0) 范围与依赖
- 覆盖所有 tool call 输出（traditional/auto-tools/ACP）。
- 依赖 `Context Files`（`docs/specs/context-files/spec.md`）提供 `ContextRef` 与读取 API。

## 1) Hook 点与改造目标
- Hook 点（main）：
  - tool call 写入对话上下文的位置（native function-call 与 legacy 两种）
  - UI 事件里携带的 `tool_call_response`（避免 renderer/main 被大 payload 撑爆）
- 改造目标：
  - 大输出不再直接注入 `conversationMessages`
  - 统一写入 `artifacts/tool/<toolCallId>.*` 并返回摘要 + `ContextRef`

## 2) 归档与摘要实现
- 归档：
  - 根据输出类型选择 `.json`/`.txt`
  - 写入完成后更新 `ContextRef.byteSize`
  - 物化策略固定为 eager（工具输出作为源数据 artifacts，不做 lazy 缓存）
- 摘要：
  - 头/尾片段（可配置）
  - 提取错误段落（可选，先做简单关键字）

## 3) ACP 终端输出接入（建议紧随其后）
- 复用相同 materialization 逻辑：
  - 完整输出写入 `artifacts/terminal/<snippetId>.log`
  - UI 与模型拿到短片段 + `ContextRef`

## 4) 配置项
- `maxInlineChars` / `maxInlineBytes`
- snippet 的头/尾长度（行数或字节）
- dev mode 统计开关

## 5) 测试
- Unit：
  - 超阈值时生成 artifacts + ContextRef
  - snippet 生成与边界（空输出/超长单行/二进制兜底）
- Integration：
  - native function-call：tool message 体积显著下降
  - legacy：`<function_call>` 中 response 不包含完整原始数据
  - export/import 后 ref 可读取
