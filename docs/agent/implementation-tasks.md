# 实施任务拆分（强类型与拆分计划）

> 按阶段推进，无兼容妥协；每项任务尽量独立可合并。

## 阶段 1：类型与文档落地（已完成部分）
- [x] 更新 `message-architecture.md` 为强类型、去兼容描述
- [x] 补充 事件→UI 映射表 与 渲染检查清单
- [x] 提交 `presenter-split-plan.md`
- [x] 生成 Provider 工作的 Cursor 规则

## 阶段 2：核心类型骨架
- [x] 新建 `src/shared/types/core/usage.ts`（`UsageStats/RateLimitInfo`）
- [x] 新建 `src/shared/types/core/llm-events.ts`（判别联合+工厂+守卫）
- [x] 新建 `src/shared/types/core/agent-events.ts`（`LLMAgentEvent*` 引用共享类型）
- [x] 新建 `src/shared/types/core/chat.ts`（`Message/AssistantMessageBlock/UserMessageContent`）
- [x] 新建 `src/shared/types/core/mcp.ts`（MCP 相关类型）
- [x] 新建 `src/shared/types/index.d.ts`（统一 re-export）

## 阶段 3：Presenter 类型拆分 (Completed)
- [x] 将核心消息类型迁移到 `src/shared/types/core/*`
- [x] 创建 `ModelConfig` 和相关类型在 `src/shared/types/core/model.ts`
- [x] 使用 B 方案：legacy.presenters.d.ts 别名核心类型到强类型
- [x] 统一 `ChatMessage`、`LLMAgentEvent`、`LLMCoreStreamEvent` 类型契约
- [x] 更新 `types/index.d.ts` 导出新结构
- [x] 保持构建兼容性，所有类型检查通过

## 阶段 4：Provider 接入强类型事件 (Completed)
- [x] 在 Provider 实现中输出 `LLMCoreStreamEvent`（工厂构造）
- [x] `tool_call_*` 严格遵循 start/chunk/end 序列与 id 聚合
- [x] 在结束前发送一次 `usage`
- [x] 触发限流时发送 `rate_limit`（在 Presenter 层处理）
- [x] 错误统一 `error` + `stop`
- [x] 为上述行为补充单测（序列/字段/边界）

## 阶段 5：Agent 与 UI 对齐 (Completed)
- [x] Agent 层：仅消费 CoreEvent，产出 `LLMAgentEvent`（严格区分 `response/error/end`）
- [x] UI 层：移除独立 `tool_call_permission` 类型，统一 `action + action_type`
- [x] 按映射表完善渲染器，完成快照测试与契约测试

## 阶段 6：质量与工具 (Completed)
- [x] 为 `事件→UI 映射` 增加契约测试（表驱动）
- [x] 运行全量测试与性能评估（含图像与大文本场景）

## 附：检查清单（提交前）
- [ ] 所有事件由工厂方法创建
- [ ] 所有 UI 块具备 `timestamp`，并按消息内顺序排序
- [ ] 工具调用 id 唯一稳定，状态仅 `loading→success|error`
- [ ] 权限块状态仅 `pending|granted|denied`
- [ ] i18n key 覆盖所有用户可见文案
- [ ] 限流信息显示完整且无阻塞
