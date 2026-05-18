# Agent Progress Todo 任务清单

## T0 规格冻结

- [x] 阅读 SDD 规范与用户提供的 Codex progress 设计文档。
- [x] 梳理 DeepChat 当前 agent tool、dispatch、message block、tool toggle、sidepanel/workspace 基线。
- [x] 明确 MVP UI 决策：聊天内 checklist + 可收起浮层，不重做 Workspace。
- [x] 移除开放澄清项。

## T1 Shared Types 与 Event Contract

- [x] 新增 `src/shared/types/agent-plan.ts`。
- [x] 更新 `src/shared/types/agent-interface.d.ts` 的 assistant block 类型与 extra 字段。
- [x] 更新 `src/shared/contracts/common.ts` 允许 `plan` block。
- [x] 新增并登记 `chat.plan.updated` typed event。
- [x] 更新 renderer display type 中 plan extra 的更具体类型。

## T2 update_plan 工具与校验

- [x] 新增 `src/main/presenter/toolPresenter/agentTools/agentPlanTool.ts`。
- [x] 定义 `UPDATE_PLAN_TOOL_NAME` 与 zod schema。
- [x] 实现 strict validation、最多 12 steps、最多一个 `in_progress`。
- [x] 实现 session-scoped `PlanState` 和 revision 递增。
- [x] 成功时返回极简 tool result，失败时返回模型可读错误。
- [x] 添加 main 单测覆盖 validation 和 state 更新。

## T3 ToolPresenter 集成与提示词

- [x] 在 `AgentToolManager.getAllToolDefinitions()` 注册 `agent-core/update_plan`。
- [x] 在 `AgentToolManager.callTool()` 路由 `update_plan`。
- [x] 扩展 `AgentToolProgressUpdate` 支持 `agent_plan`。
- [x] 在 `ToolPresenter.buildToolSystemPrompt()` 注入 Progress 使用规则。
- [x] 确认 `disabledAgentTools` 可过滤 `update_plan`。
- [x] 添加 ToolPresenter/AgentToolManager 单测。

## T4 Dispatch 与 Message Block 更新

- [x] 在 `dispatch.ts` 处理 `agent_plan` progress update。
- [x] 不向 current assistant message 插入 `plan` block。
- [x] 标记 `update_plan` tool_call block 为 internal。
- [x] 发布 `chat.plan.updated` event。
- [x] 确保 empty plan 清空 active checklist。
- [x] 添加 dispatch 单测覆盖 update 只发 event 且不插入 plan block。

## T5 Renderer Checklist

- [x] 重写 `MessageBlockPlan.vue` 为完整 checklist。
- [x] 兼容 ACP `{ content, status }` 与 DeepChat `{ step, status }` 两种 entry。
- [x] 增加 completed / in_progress / pending 三态样式。
- [x] 增加 empty state 与 screen reader 文本。
- [x] 在 `MessageItemAssistant.vue` 隐藏 internal `update_plan` tool call。
- [x] 添加 renderer 组件测试。

## T6 Floating Progress Panel

- [x] 新增 `AgentProgressFloat.vue`。
- [x] 新增或扩展 renderer store/composable 维护 latest plan snapshot。
- [x] 订阅 `chat.plan.updated`，按 session 和 revision 去重。
- [x] 在 `ChatPage.vue` 输入区上方挂载浮层。
- [x] 支持 per-session collapsed state，默认收起。
- [x] 增加展开 / 收起动画。
- [x] 添加浮层渲染与折叠测试。

## T7 工具分区开关与 i18n

- [x] 确认 `update_plan` 出现在现有 Agent Core 分组中。
- [x] 不新增单独 Progress 分组或分组 i18n 文案。
- [x] 确认草稿会话和已有 session 都能开关 `update_plan`。
- [x] 更新 DeepChat agent settings 工具列表展示需要的分组标签。
- [x] 添加 `McpIndicator` 测试覆盖 Core 内单工具 toggle。

## T8 验证

- [x] 运行 `pnpm run format`。
- [x] 运行 `pnpm run i18n`。
- [x] 运行 `pnpm run lint`。
- [x] 运行 `pnpm run typecheck`。
- [x] 运行相关 main/renderer 测试。
- [ ] 手动验证一个多步骤 agent 任务能显示、更新、完成和隐藏 progress。
