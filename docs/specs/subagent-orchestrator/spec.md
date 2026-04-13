# Subagent Orchestrator V1 规格

## 背景

现有多工具式 subagent 方案把 child session 管理、等待、汇总拆散给模型，导致：

1. 工具暴露面过大，模型需要自己编排 `run / wait / cancel / list`
2. parent loop 会过早接触中间结果，增加 prompt 噪音
3. child session 与父会话的 UI 关联不够稳定，权限/提问桥接也不够直接

V1 目标是把能力收口为单一 agent tool `subagent_orchestrator`，由 tool 内部完成 child session 编排、监听和最终汇总。

## 用户故事

1. 作为 DeepChat regular session 用户，我希望模型只调用一个 subagent tool，就能并行或串行分派多个子任务。
2. 作为父会话用户，我希望看到 child 的实时进度卡片，但模型只在全部 child 结束后收到一次最终汇总。
3. 作为需要审批/回答问题的用户，我希望仍然只在父会话顶部 overlay 处理交互，不需要切到 child 才能继续。
4. 作为查看上下文的用户，我希望 child 是真实独立 session，能在右侧 workspace 的 `Subagents` 区查看、切换、回到父会话。

## 范围

### In

1. 单一公开 agent tool：`subagent_orchestrator`
2. 两种执行模式：`parallel`、`chain`
3. DeepChat agent 配置中的 subagent slot 管理
4. parent -> child 单层关联
5. main-process 内部 child 输出监听
6. 父会话 tool block 进度卡片、顶部 overlay 桥接、workspace 子会话列表

### Out

1. `expanded` 模式
2. child 再派生 child
3. 多层树状工作流
4. parent loop 消费 partial child tool result
5. card 内直接批准权限或直接回答问题

## 约束

1. 单次 `subagent_orchestrator` 最多 5 个 task
2. agent 配置 slot 最多 5 条
3. 只允许引用当前父会话 agent 配置里已启用的 slot
4. 只有 `sessionKind='regular'` 且 `agentType='deepchat'` 且 `subagentEnabled=true` 的父会话暴露该工具
5. ACP session 与 subagent child session 不暴露该工具

## 配置与数据模型

### Agent 配置

`DeepChatAgentConfig` 增加：

1. `subagentEnabled: boolean`
2. `subagents: DeepChatSubagentSlot[]`

`DeepChatSubagentSlot` 定义：

1. `id: string`
2. `targetType: 'self' | 'agent'`
3. `targetAgentId?: string`
4. `displayName: string`
5. `description: string`

规则：

1. 默认预置 1 条 `self` slot
2. `self` 表示继承父会话 agent 逻辑，但 child 使用独立上下文
3. 非法 `targetAgentId` 在读取配置和工具执行时都要过滤

### Session 输入

`CreateSessionInput` / `CreateDetachedSessionInput` 增加：

1. `subagentEnabled?: boolean`

### `new_sessions`

新增列：

1. `subagent_enabled INTEGER NOT NULL DEFAULT 0`
2. `session_kind TEXT NOT NULL DEFAULT 'regular'`
3. `parent_session_id TEXT`
4. `subagent_meta_json TEXT`

### Session 读取模型

`SessionRecord` / `SessionWithState` 增加：

1. `sessionKind: 'regular' | 'subagent'`
2. `parentSessionId?: string | null`
3. `subagentEnabled: boolean`
4. `subagentMeta?: { slotId: string; displayName: string; targetAgentId?: string | null } | null`

## Tool 接口

`subagent_orchestrator` 参数固定为：

```ts
{
  mode: 'parallel' | 'chain'
  tasks: Array<{
    id?: string
    slotId: string
    title: string
    prompt: string
    expectedOutput?: string
  }>
}
```

`IToolPresenter.callTool()` 增加可选参数：

1. `onProgress?: (update: AgentToolProgressUpdate) => void`
2. `signal?: AbortSignal`

`AgentToolProgressUpdate` V1 只定义：

```ts
{
  kind: 'subagent_orchestrator'
  toolCallId: string
  responseMarkdown: string
  progressJson: string
}
```

`AssistantMessageExtra` 增加：

1. `subagentProgress?: string`
2. `subagentFinal?: string`

## Child Session 生命周期

### 创建

tool 内部通过 runtime port 调 `AgentSessionPresenter` 创建 child session：

1. `self` slot 继承父 `agentId`
2. `agent` slot 使用 `slot.targetAgentId`
3. 继承父 `projectDir`
4. DeepChat target 继承父 session 的 `provider/model/permission/generationSettings/disabledAgentTools/activeSkills`
5. ACP target 强制使用 `providerId='acp'`、`modelId=targetAgentId`、`agentId=targetAgentId`
6. ACP target 只继承 `projectDir` 与 `permissionMode`，不继承本地 tools / skills / model preset
7. child session 写入 `session_kind='subagent'`
8. child session 写入 `parent_session_id=父 sessionId`
9. child session 写入 `subagent_meta_json`

### 首条 handoff

child 首条消息固定使用 structured handoff 模板，仅包含：

1. 父任务摘要
2. 当前子任务
3. 输出契约
4. 工作区路径
5. 固定规则（isolated child session / ask via normal tool flow）

明确不注入：

1. `Slot Description`
2. 完整父 transcript
3. DeepChat runtime capabilities / env / skills / tooling system prompt（ACP-backed child）

不复制完整父 transcript。

### 初始化失败重试

1. 只在 child session 创建早期失败时自动重试 1 次
2. 覆盖 ACP warmup / session init / createSubagentSession 早期失败
3. 重试必须用全新 child session / 全新 warmup
4. 若第二次仍失败，直接返回终态 error，并带可诊断错误文本

### 结束态

child terminal status 归一为：

1. `queued`
2. `running`
3. `waiting_permission`
4. `waiting_question`
5. `completed`
6. `error`
7. `cancelled`

## 执行语义

### `parallel`

1. 立即创建并启动全部 child
2. 并发等待全部 child 完成
3. child 结果先缓存在 orchestrator 内部 queue
4. 全部结束后按原 `tasks` 顺序聚合最终结果

### `chain`

1. 按 `tasks` 顺序逐个创建 child
2. 每个 child 结束后再启动下一个
3. 每个结果进入内部 queue
4. 最终仍按原 `tasks` 顺序聚合

### 共同行为

1. parent loop 不消费 partial child output
2. tool 完成前，父会话只写 progress，不把中间结果作为 tool message 喂给模型
3. 最终 `tool_call.response` 与 tool output 都使用同一份 markdown 汇总文本
4. ACP-backed child 不加载本地 tool definitions，也不拼 DeepChat tooling system prompt

## Progress Payload

`subagentProgress` / `subagentFinal` 使用统一 JSON 结构：

```ts
{
  runId: string
  mode: 'parallel' | 'chain'
  tasks: Array<{
    taskId: string
    title: string
    slotId: string
    sessionId: string | null
    targetAgentId: string | null
    targetAgentName: string
    status: 'queued' | 'running' | 'waiting_permission' | 'waiting_question' | 'completed' | 'error' | 'cancelled'
    previewMarkdown: string
    updatedAt: number
    waitingInteraction?: {
      messageId: string
      toolCallId: string
      actionType: 'tool_call_permission' | 'question_request'
      toolName: string
      toolArgs: string
    } | null
    resultSummary?: string
  }>
}
```

规则：

1. `previewMarkdown` 只保留最近 3 条非空展示行
2. 进度事件来自 main-process 内部 child 输出观察通道，不依赖 renderer，不轮询 DB

## 最终汇总

最终 markdown 文本按原 `tasks` 顺序输出，每项包含：

1. 序号
2. 标题
3. 子 agent 名称
4. child sessionId
5. 结果摘要

## UI 验收

### Agent Settings

`DeepChat Agents` 扩展 `Subagents` 分区：

1. 总开关
2. slot 列表
3. `+ Add Slot`
4. target agent 选择
5. 描述编辑
6. 5 条上限

### Session UI

1. 会话层只保留一个 `Subagents` toggle
2. 只在 DeepChat regular session 可见
3. ACP 与 child session 隐藏

### Tool Block

`MessageBlockToolCall` 对 `subagent_orchestrator` 特判：

1. 运行中自动展开
2. 完成后自动折叠
3. 详情区显示 subagent cards，不走普通 `pre`
4. summary 固定为 `parallel · N subagents` 或 `chain · N subagents`

### Overlay

父会话顶部 overlay 继续复用 `ChatToolInteractionOverlay`：

1. 同时扫描普通 action block 与 `subagent_orchestrator` 的 `extra.subagentProgress`
2. child 进入等待态时显示待处理项
3. 响应直接路由到 `respondToolInteraction(childSessionId, ...)`

### Workspace

父会话右侧 workspace 增加 `Subagents` section：

1. 列出当前父会话全部 child
2. 展示 `displayName / target agent / status / updatedAt`
3. 点击切换 child session
4. child 顶部有 `Back to Parent`

## 兼容与迁移

1. 旧库升级后，原有 session 默认 `session_kind='regular'`
2. 旧库升级后，原有 session 默认 `subagent_enabled=0`
3. 左侧 sidebar 默认仍只显示普通会话
4. 父删子级联；子单删不影响父

## 验收标准

1. 只有 DeepChat regular session 且 subagentEnabled 打开时，模型能看到 `subagent_orchestrator`
2. `parallel` 并发启动全部 child，`chain` 串行启动
3. parent tool block 能随 child 输出实时更新 card 预览
4. child 的 permission/question 会在父会话 overlay 中处理
5. child session 在 workspace `Subagents` 区可切换
6. 应用重启后，父子关联与 workspace 子会话列表仍可恢复
