# Agent Progress Todo 实施计划

## 当前基线

- Agent 工具定义由 `AgentToolManager.getAllToolDefinitions()` 汇总，`ToolPresenter` 根据 `disabledAgentTools` 过滤内置工具。
- 高级工具面板 `McpIndicator.vue` 已按 `tool.server.name` 对内置工具分组，YoBrowser 通过 `yobrowser` 分区显示和开关。
- DeepChat agent 执行链路为 `agentRuntimePresenter -> processStream -> dispatch.executeTools -> ToolPresenter.callTool -> AgentToolManager.callTool`。
- Renderer 实时更新走 `chat.stream.updated` typed event，payload 是完整 assistant blocks snapshot。
- 当前 shared `@shared/chat` 和 renderer display type 已支持 `plan` block，但 `@shared/types/agent-interface.d.ts` 与 `AssistantMessageBlockSchema` 还未完整纳入 `plan`。
- ACP 已能把外部 `plan` notification 映射为 `plan` block，但 `MessageBlockPlan.vue` 目前只显示摘要和进度条，不显示完整 checklist。

## 架构决策

1. `update_plan` 是 DeepChat built-in agent tool，不是 MCP server。
2. 新工具归入现有 Core 工具分区：
   - `server.name = 'agent-core'`
   - `function.name = 'update_plan'`
   - 这样可直接复用 `disabledAgentTools` 和高级工具面板的单工具开关，不额外增加单工具分区。
3. `AgentToolManager` 持有 session-scoped `PlanState`，按 `conversationId` 维护 `current/revision/updatedAt`。
4. 工具调用成功后通过 `AgentToolProgressUpdate` 扩展出 `kind: 'agent_plan'` 把 snapshot 交给 dispatch。
5. `dispatch.ts` 负责发布 `chat.plan.updated` typed event，不把 DeepChat `update_plan` snapshot 插入当前 assistant message。
6. `update_plan` tool call block 标记为 internal progress tool，renderer 默认隐藏该 pill，避免重复展示“update_plan 调用完成”。
7. `chat.plan.updated` event 和 renderer plan store 是 DeepChat todo 的实时来源。若后续需要持久化，应设计独立 progress 存储，不复用 assistant message blocks。
8. MVP 使用可收起浮层，不把 Progress 放入 Workspace 内容区，不增加 sidepanel 顶层 tab。

## 数据与类型

新增或扩展：

- `src/shared/types/agent-plan.ts`
  - `AgentPlanStepStatus`
  - `AgentPlanItem`
  - `UpdatePlanArgs`
  - `AgentPlanSnapshot`
  - `AgentPlanState`
- `src/shared/types/agent-interface.d.ts`
  - `AssistantBlockType` 增加 `plan`
  - `AssistantMessageExtra` 增加 plan 相关字段类型
- `src/shared/contracts/common.ts`
  - `AssistantMessageBlockSchema.type` 增加 `plan`
  - `extra` schema 保持 json record
- `src/shared/contracts/events/chat.events.ts`
  - 新增 `chatPlanUpdatedEvent`
- `src/shared/contracts/events.ts`
  - 导出并登记新事件
- `src/shared/types/presenters/tool.presenter.d.ts`
  - `AgentToolProgressUpdate` 增加 `agent_plan` variant

Plan snapshot:

```ts
interface AgentPlanSnapshot {
  sessionId: string
  toolCallId?: string
  explanation?: string
  plan: AgentPlanItem[]
  revision: number
  updatedAt: string
}
```

## Main Process Flow

```text
Model emits update_plan tool call
  -> accumulator adds tool_call block
  -> dispatch.executeTools runs ToolPresenter.callTool
  -> AgentToolManager validates args and updates PlanState
  -> AgentToolManager emits AgentToolProgressUpdate(kind: agent_plan)
  -> dispatch marks the update_plan tool call internal and publishes chat.plan.updated
  -> renderer receives chat.stream.updated snapshot and chat.plan.updated live event
  -> model receives tiny success result
```

Implementation pieces:

- Add `agentPlanTool.ts` under `src/main/presenter/toolPresenter/agentTools/`.
- Add zod schema with `.strict()` objects and max length 12.
- Register tool definition from `AgentToolManager.getAllToolDefinitions()` only in `chatMode === 'agent'`.
- Route `toolName === UPDATE_PLAN_TOOL_NAME` in `AgentToolManager.callTool()`.
- Add helper in `dispatch.ts`:
  - `markInternalPlanToolCall(blocks, toolCallId)`
  - `publishPlanUpdated(snapshot, messageId)`
- Keep tool output small and context-friendly. The tool response to the model should be `{}` or `Plan updated`, not the full plan.

## Renderer Flow

- `MessageBlockPlan.vue`
  - Replace summary-only rendering with full checklist.
  - Support existing ACP `plan_entries` with `{ content, status }` and new DeepChat `{ step, status }`.
  - Keep progress count in the header.
  - Render empty state when `plan_entries` is empty.
  - This component is compatibility UI for ACP/history; DeepChat `update_plan` does not create these blocks.
- New `AgentProgressFloat.vue`
  - Input: latest active plan snapshot for current session.
  - Collapsed by default. Collapsed state stored in sidepanel/session UI store or local `useStorage` keyed by session id.
  - Expands and collapses with a short height/opacity transition.
  - Shows only when current active session has a non-empty active plan during generation or a latest settled plan from current turn.
- Chat page integration:
  - Subscribe through a small renderer client method for `chat.plan.updated`.
  - Maintain `latestPlanBySession` in a small Pinia/composable store.
  - Clear active floating plan when a new user turn starts and no plan has arrived yet.
- `MessageItemAssistant.vue`
  - Skip rendering internal `update_plan` tool_call blocks by checking `block.extra.internalTool === true` and `block.tool_call.name === 'update_plan'`.

## Tool Toggle UI

- `McpIndicator.vue`
  - Keep `update_plan` under existing `agent-core` grouping.
  - Do not add a separate Progress group or group label.
- Existing `disabledAgentTools` storage works without a schema migration because it stores tool names.
- New sessions inherit agent default `disabledAgentTools`; built-in DeepChat default remains enabled.

## Prompting

Update `ToolPresenter.buildToolSystemPrompt()`:

- Add `buildProgressPrompt(toolNames)`.
- Include rules only when `toolNames.has('update_plan')`.
- Keep this separate from formal planning responses and from question tool rules.

## Compatibility

- Existing ACP plan blocks should continue rendering because `MessageBlockPlan` will normalize both `{ content }` and `{ step }`.
- Existing assistant messages with summary-only `plan_entries` still render.
- DeepChat `update_plan` no longer creates new assistant `plan` blocks; this intentionally keeps the message list free of process-state todo items.
- Sessions with `disabledAgentTools` do not need migration. If a user had disabled all tools manually, `update_plan` starts enabled unless agent config later explicitly disables it.
- If `update_plan` is disabled during an active generation, the current request's tool list is not retroactively mutated; the change applies to subsequent tool refreshes, matching existing tool toggle behavior.

## Test Strategy

Main tests:

- `AgentPlanTool` validation rejects unknown status, empty step, extra fields, multiple `in_progress`, and more than 12 steps.
- Valid payload increments revision and normalizes trimmed steps.
- Empty plan clears current snapshot and emits a snapshot with `plan: []`.
- `AgentToolManager` lists `update_plan` in `agent-core` for DeepChat agent mode and omits it when disabled through `ToolPresenter`.
- `ToolPresenter.buildToolSystemPrompt()` includes progress rules only when enabled.
- `dispatch.executeTools` handles `agent_plan` progress update by publishing event and not inserting any `plan` block.

Renderer tests:

- `MessageBlockPlan` renders completed / in_progress / pending entries with accessible status text.
- Long step text wraps without changing icon alignment.
- ACP-style `{ content }` plan entries still render.
- Internal `update_plan` tool_call block is hidden.
- `McpIndicator` shows `update_plan` inside Agent Core and toggles it through `disabledAgentTools`.
- Floating panel renders collapsed by default, animates expand/collapse, and ignores stale lower revision updates.

Validation commands after implementation:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm test -- test/main/presenter/toolPresenter test/main/presenter/agentRuntimePresenter test/renderer/components/message test/renderer/components/McpIndicator.test.ts
```

## Risks

- Tool-call UI noise: hidden internal tool call must be scoped only to `update_plan`, not all agent-core tools.
- Message pollution: DeepChat `update_plan` must not append process-state todo items to assistant message blocks.
- Type drift: there are multiple assistant block type definitions; all active shared/renderer schemas must include `plan`.
- Event ordering: floating panel should compare `revision` and ignore stale updates for the same session.
- Overuse by model: system prompt must explicitly skip simple one-shot tasks.

## Rollout

1. Implement tool and validation behind normal tool availability.
2. Add event/block support and renderer checklist.
3. Add floating panel.
4. Add tool toggle group and prompt rules.
5. Run tests and validation commands.
6. If floating panel feels intrusive in QA, keep message block as canonical and ship panel collapsed by default.
