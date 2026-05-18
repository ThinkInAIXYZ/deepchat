# Agent Progress Todo 规格

## 背景

DeepChat agent 已经具备文件、命令、YoBrowser、skills、subagent、提问与权限交互等能力，但缺少一个轻量的“执行进度 / todo”工具。用户在多步骤任务中只能从文本和 tool call pill 推断当前状态，无法稳定看到“已完成、正在做、待处理”。

用户提供了 agent-progress-todo 参考文档；核心模型参考 Codex 的 `update_plan`：一次工具调用提交完整 checklist snapshot，runtime 替换当前计划并发出稳定事件，UI 渲染 progress checklist。

## 目标

- DeepChat agent 可调用 `update_plan` 更新当前任务进度。
- 用户能在生成过程中看到当前 plan 的 completed / in_progress / pending 状态。
- `update_plan` 作为内置 agent 核心工具出现，可在 Core 分组中按工具单独启用或停用。
- checklist 是 agent turn 的过程态，不插入 assistant message 列表；实时展示由独立 plan event/store 驱动。
- 生成中提供一个可收起的实时 Progress 浮层，避免用户滚动离开最新消息后失去进度可见性。

## 用户故事

### US-1：多步骤任务可见进度

作为用户，当我让 DeepChat agent 执行跨文件或跨阶段任务时，我希望看到已完成、正在处理、待处理的 checklist，而不是只能读 tool call 和中间文本。

### US-2：可控的核心工具

作为用户，我希望 Progress/Todo 保持在核心工具区域里，不额外增加单工具分区；如果我不希望 agent 展示计划，可以在 Core 分组中停用 `update_plan`。

### US-3：消息列表保持干净

作为用户，我希望 todo/progress 不被写入聊天消息列表，避免中间状态污染最终回答。即使后续需要持久化，也应进入独立的 progress 存储，而不是 assistant message blocks。

### US-4：实时但不打扰

作为用户，我希望执行中有一个可收起的 Progress 浮层显示最新进度；如果我不需要看，可以折叠，不影响输入区和消息阅读。

## MVP 范围

- 新增 DeepChat 内置 agent 工具 `update_plan`。
- 工具 schema 与参考文档一致：`explanation?: string`，`plan: { step: string; status: "pending" | "in_progress" | "completed" }[]`。
- 工具校验：
  - `plan` 必须为数组，允许空数组用于清空 checklist。
  - `step` trim 后必须为非空字符串。
  - `status` 只允许 `pending | in_progress | completed`。
  - 同一 snapshot 最多一个 `in_progress`。
  - 拒绝额外字段。
  - MVP 最多 12 个 step，超出返回模型可读错误。
- Runtime 维护 session-scoped latest plan state：`current`、`revision`、`updatedAt`。
- DeepChat typed event 使用 `chat.plan.updated` 承载参考文档中的 `plan.update` 语义。
- DeepChat `update_plan` 不新增 assistant `plan` block，也不在消息列表中渲染 todo。
- 生成中浮层从最新 plan snapshot 渲染，默认收起，支持带动画的展开 / 折叠。
- 高级工具面板在 `agent-core` 分区显示 `update_plan`，支持按单个工具停用。
- Agent system tooling prompt 注入使用规则，避免简单任务滥用 checklist。
- 覆盖 validation、handler、dispatch/event、UI 渲染、工具分区开关测试。

## UX 决策

MVP 不重做 Workspace 信息架构，也不把 Progress 作为 Workspace 主内容区的一部分。原因：

- 当前右侧 sidepanel 已经有 `workspace` 与 `browser` 两个顶层 tab，Workspace 内部又包含 Files、Git、Artifacts。直接塞入实时任务状态会让 Workspace 承担过多职责。
- Progress 是 agent turn 的执行状态，不是 workspace 文件资产。它应优先跟随 chat generation，而不是跟随文件预览。
- 用户截图更接近一个轻量 progress panel；可收起浮层能满足实时可见性，同时保留消息内持久记录。

MVP UI 形态：

- Message list：DeepChat `update_plan` 不插入 `plan` block；`update_plan` 自身 tool call pill 标记为 internal，默认不渲染。
- Floating panel：仅当前 session 有 active plan 时显示；desktop 固定在输入区上方右侧，mobile 使用输入区上方全宽紧凑条；默认收起，可动画展开 / 折叠，折叠状态按 session 保存。
- Tool toggle：在 Advanced Settings -> Built-in Tools 的 Core 分组中显示 `update_plan`。关闭该工具后，本轮之后的工具列表不再暴露该工具。

## Tool Contract

工具名：`update_plan`

```ts
type AgentPlanStepStatus = 'pending' | 'in_progress' | 'completed'

interface AgentPlanItem {
  step: string
  status: AgentPlanStepStatus
}

interface UpdatePlanArgs {
  explanation?: string
  plan: AgentPlanItem[]
}
```

成功结果应保持极简，推荐：

```json
{}
```

错误结果必须可被模型自修复，例如：

```text
invalid update_plan arguments: at most one step can be in_progress
```

## Event Contract

Codex 参考文档里的 `plan.update` 在 DeepChat 中落为 typed event：

```ts
interface ChatPlanUpdatedEvent {
  sessionId: string
  messageId: string
  toolCallId?: string
  plan: AgentPlanItem[]
  explanation?: string
  revision: number
  updatedAt: string
}
```

语义：

- 每个事件代表一次完整 snapshot 替换。
- `revision` 在 session 内单调递增。
- UI 收到更高 revision 后覆盖当前 checklist。
- `plan.length === 0` 表示清空 active checklist。
- 事件用于实时浮层；如后续需要持久化，应写入独立 progress 存储，不复用 assistant message blocks。

## Assistant Block Compatibility

DeepChat `update_plan` 不写入 assistant `plan` block。现有 `plan` block 兼容逻辑仅用于 ACP agent notification 和已有历史消息。

兼容的 `plan` block `extra` 存储结构：

```ts
{
  plan_entries: AgentPlanItem[]
  plan_explanation?: string
  plan_revision: number
  plan_updated_at: string
}
```

渲染规则：

- `explanation` 存在时显示在 checklist 上方一行。
- `completed` 使用 dimmed style 和 check icon。
- `in_progress` 使用 active style 和 running indicator。
- `pending` 使用 normal/muted style 和 hollow circle。
- 长 step 必须换行，第二行缩进到文本起始位置。
- screen reader 文本包含本地化后的 status 与 step 文本。

## Agent 使用规则

注入到工具系统 prompt：

```text
Use update_plan for non-trivial multi-step tasks.
Skip update_plan for simple one-shot answers or trivial edits.
Keep each plan step short, concrete, and verifiable.
Keep the plan current as work progresses.
At most one step may be in_progress at a time.
When a step completes, update the plan immediately and move the next active step to in_progress in the same call.
Use explanation only when the plan changes materially or when progress would otherwise be unclear.
```

## 验收标准

- `update_plan` 出现在 DeepChat agent 的内置工具列表中，且 `server.name` 为 `agent-core`。
- Advanced Settings 的 Built-in Tools 中，`update_plan` 出现在 Core 分组内，可作为单个工具开关。
- 关闭 `update_plan` 后，新请求工具定义不再包含该工具，系统 prompt 也不再包含 Progress 使用规则。
- 有效 payload 更新 session plan state，`revision` 递增，`updatedAt` 为 ISO 8601 UTC string。
- 无效 payload 返回模型可读错误，不更新 state，不发 `chat.plan.updated`。
- 每次有效调用发出一个 `chat.plan.updated` event，并更新独立 renderer plan store。
- `update_plan` 不会向当前 assistant message 插入 `plan` block。
- `update_plan` 自身 tool call pill 不在默认消息视图中制造额外噪声。
- 浮层默认收起，展开 / 折叠有过渡动画。
- 浮层能渲染三种状态、长文本换行与空 plan。
- ACP 或历史 assistant message 的 plan block 仍可正常显示。
- 测试覆盖 validation、tool handler、dispatch/event、message block、floating panel、tool toggle。

## 非目标

- 不做 owner、deadline、priority、子任务层级。
- 不接入外部项目管理系统。
- 不做长期任务数据库或跨 session 任务看板。
- 不做自动任务拆解 planner。
- 不重做 Workspace 顶层布局。
- 不改变 ACP agent 已有 plan notification 映射，只在必要时复用 UI 组件。

## 约束

- 遵循 DeepChat 新 renderer-main typed route / typed event 模式，不新增 legacy IPC。
- 用户可见文案必须走 `src/renderer/src/i18n`。
- DeepChat agent 新能力优先放在 `src/main/presenter/toolPresenter/agentTools` 与 `agentRuntimePresenter` 现有链路中。
- 保持实现轻量，避免引入状态管理系统级复杂度。
- 不破坏现有 ACP `plan` block 兼容展示。

## 开放问题

无。
