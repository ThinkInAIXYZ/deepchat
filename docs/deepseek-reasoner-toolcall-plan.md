# DeepSeek Reasoner 工具调用适配方案

## 背景与目标
- DeepSeek Reasoner（`deepseek-reasoner` 系列）在调用工具时会返回 `reasoning_content`，官方要求在触发工具调用前先下发这段思考内容（参考「Thinking Mode」文档示例）。
- 默认数据库/消息流水线（`ThreadPresenter` -> `LLMEventHandler` -> `ContentBufferHandler`/`ToolCallHandler`）已经会把 reasoning 事件写入消息记录，因此重点是保证事件顺序与工具调用前置。
- 目标：当使用 DeepSeek Reasoner 且触发工具调用时，确保推理内容按文档顺序出现在工具调用前，格式化层（`openAICompatibleProvider.ts`) 注入即可被下游正确持久化。

## 现状梳理
- 主要路径：`openAICompatibleProvider.handleChatCompletion()` 处理流式增量，`supportsFunctionCall=true` 时使用原生 `tool_calls` 事件。
- 推理处理：`delta.reasoning_content`/`delta.reasoning` 直接触发 `createStreamEvent.reasoning()`，未与工具调用做顺序绑定，导致 DB 虽存储 reasoning，但顺序可能落后于工具调用。
- 工具处理：`delta.tool_calls` 逐个触发 `toolCallStart`/`toolCallChunk`，不感知推理内容；`nativeToolCalls` 最终汇总结束事件。
- DeepSeek Provider：继承 `OpenAICompatibleProvider`，未有针对 Reasoner 的特殊逻辑。

## 开发计划
1. 需求细化：确定需要适配的模型前缀（`deepseek-reasoner`/`deepseek-reasoner-v2` 等）与兼容列表，确认是否包含 OpenRouter/自建网关前缀。
2. 数据流梳理：标注 `handleChatCompletion` 中与 `reasoning`/`tool_calls` 相关的关键节点，设计插入点，确保注入层在 provider（格式化/流处理）即可被 `ThreadPresenter` 下游持久化。
3. 方案落地：实现 Reasoner 专属的推理缓存与前置注入，保证事件顺序正确；同时保持 `createStreamEvent.reasoning()` 继续实时输出以复用现有 DB 写入逻辑。
4. 验证与回归：构造包含 `reasoning_content` + `tool_calls` 的流式用例，验证 UI 呈现、工具调用参数及停止理由；回归其他 OpenAI 兼容模型不受影响。
5. 文档与开关：补充注释/配置说明，必要时增加临时开关以便快速回滚。

## 技术方案
- **模型识别**：新增 `isDeepseekReasoner(modelId: string)` 辅助，匹配 `deepseek-reasoner` 及后续版本/通道前缀（含 OpenRouter `deepseek/deepseek-reasoner`）。仅在 `supportsFunctionCall` 且命中 Reasoner 时启用特殊逻辑。
- **历史消息重排（核心）**：
  - 利用现有消息流水线已存好的 reasoning 片段，不再额外缓存流内内容。
  - 在 `openAICompatibleProvider.formatMessages()` 或准备请求参数时，对「当前请求上下文」做轻量重排：若上一轮是 Reasoner 且包含 `reasoning_content` + `tool_calls`，将 `reasoning_content` 放在对应工具调用之前（满足文档图示序）。历史消息本身完整，重排只在「当前回合构造上下文」生效，不修改 DB。
  - 仅对“本轮 loop 输出工具调用”的情况执行；纯历史消息无需处理，避免重复。
- **流式事件保持现状**：继续在流循环中直接 `createStreamEvent.reasoning()` 输出，保证 UI 实时展示和 DB 写入；顺序依赖于上一步的上下文重排来喂给模型。
- **边界处理**：未命中 Reasoner 或无工具调用时保持原行为；避免对非 Reasoner 模型的消息顺序做任何调整。

## 测试与验证
- 人工/录制流式样例：构造含 `reasoning_content` → `tool_calls` → `content` 的增量，验证上下文重排后模型请求体中 reasoning 位于工具调用前，UI 顺序与 DB 存储均保持合理。
- 回归：常规 OpenAI/GPT/Qwen 等模型的工具调用路径不变；图片/多模态分支不受影响。
- CLI/自动化：若可，补充针对「格式化消息重排」的单测（输入消息数组，输出顺序断言），验证仅在 Reasoner + 当前轮工具调用时触发。

## 风险与注意事项
- 事件重复：需避免在已有推理流事件之外重复注入相同片段，可通过“仅在首次 tool_calls 前注入并清空缓存”控制。
- 类型扩展：如需在工具事件中携带推理内容，需检查 `LLMCoreStreamEvent`/下游消费者是否支持扩展字段，必要时增加向后兼容的 optional 字段。
- 上游差异：不同供应商（官方/代理/OpenRouter）字段命名可能略有差异，需观察 `delta.reasoning` 兼容分支。
