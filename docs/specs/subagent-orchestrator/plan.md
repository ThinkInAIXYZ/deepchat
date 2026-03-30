# Subagent Orchestrator V1 实施计划

## 1. 基线

当前代码已经具备：

1. `new_sessions` + `deepchat_sessions` 的新会话栈
2. `NewAgentPresenter` 负责 session 生命周期与 renderer IPC
3. `ToolPresenter -> AgentToolManager` 的 agent tool 路由
4. `DeepChatAgentPresenter` 的 tool call / permission / question / resume 流
5. renderer 的 `MessageBlockToolCall`、`ChatToolInteractionOverlay`、`WorkspacePanel`

缺的部分是：

1. session 级 subagent 元数据
2. orchestrator tool 和 child session runtime bridge
3. child 输出到 parent tool block 的 main-only progress 通道
4. renderer 对 subagent cards / workspace child list / back link 的展示

## 2. 设计决策

### 2.1 数据层

在 `new_sessions` 保存 parent/child 关系，而不是新建额外表：

1. child session 已经是完整真实 session
2. 删除、恢复、状态读取都能沿用现有 session 生命周期
3. workspace 列表和 `getSessionList()` 只需增加过滤

### 2.2 Runtime Port 扩展

不让 `AgentToolManager` 直接依赖 presenter 实例，继续通过 `AgentToolRuntimePort` 间接访问：

1. 查询当前会话是否允许 subagent tool
2. 创建 child session
3. 发送 child handoff message
4. 读取 parent/child session 信息

### 2.3 进度桥接

采用 main-only event：

1. `dispatch.flushBlocksToRenderer()` 在 child assistant block 流式刷新时，同时发 main-only event
2. `DeepChatAgentPresenter.setSessionStatus()` 和 `emitMessageRefresh()` 也发 main-only event
3. orchestrator 订阅这些事件，维护自己的内存态 queue

这样避免：

1. renderer 反向回传
2. 轮询数据库
3. 额外的 child polling loop

### 2.4 Tool Progress 写回

tool 执行时通过 `IToolPresenter.callTool(..., { onProgress })` 回调：

1. `dispatch.executeTools()` 收到 progress 时直接更新当前 tool_call block 的 `extra.subagentProgress`
2. tool 完成时写 `extra.subagentFinal`
3. `tool_call.response` 始终保留最终 markdown 汇总文本

### 2.5 Renderer Session 状态

`sessionStore.sessions` 继续只存 sidebar 可见的 regular sessions；另增 `activeSessionRecord`：

1. sidebar 默认不显示 child
2. 当当前激活的是 child 时，`activeSession` 仍能拿到完整会话记录
3. workspace 和 top bar 都能正确读取 child 的 parent metadata

### 2.6 Workspace 子会话列表

在 `WorkspacePanel` 左侧导航追加 `Subagents` section，而不是新建独立侧栏：

1. 信息层级与 artifacts/files/git 一致
2. 与 parent workspace 语义自然贴近
3. 避免引入新的 sidepanel store 结构

## 3. 分层改造

### Phase 1：Shared & Storage

1. 扩展 `DeepChatAgentConfig`、session record、tool progress、presenter interface
2. 更新 `new_sessions` schema / migration / table accessors
3. 扩展 `NewSessionManager` 与 `NewAgentPresenter` 的 create/list/delete API

### Phase 2：Tool Runtime

1. 扩展 `AgentToolRuntimePort`
2. 在 `AgentToolManager` 中新增 `subagent_orchestrator` schema、definition、gating
3. 实现 orchestrator 执行器：
   - slot 校验
   - child session 创建
   - structured handoff
   - parallel / chain 调度
   - progress snapshot 生成
   - final markdown 汇总

### Phase 3：DeepChat Progress Bridge

1. 增加 main-only subagent runtime event 常量
2. `dispatch` 在 child assistant block streaming 时发 event
3. `DeepChatAgentPresenter` 在 message refresh / session status change 时发 event
4. `dispatch.executeTools()` 与 `executeDeferredToolCall()` 透传 `onProgress` / `signal`

### Phase 4：Renderer

1. `DeepChatAgentsSettings` 增加 subagent settings UI
2. `draftStore` / `NewThreadPage` / `ChatStatusBar` 支持 session-level subagent toggle
3. `MessageBlockToolCall` 对 `subagent_orchestrator` 渲染 card 视图
4. `ChatPage` 扩展 pending interaction 扫描到 child progress
5. `WorkspacePanel` 增加 `Subagents` section
6. `ChatTopBar` 在 child session 显示 `Back to Parent`

## 4. 关键实现细节

### 4.1 child handoff 模板

模板字段固定：

1. Parent summary
2. Slot role
3. Task title
4. Task prompt
5. Expected output
6. Workspace path

模板输出必须英文，避免模型在 child 里混杂工具协议与 UI 本地化文案。

### 4.2 preview 行提取

从 child 最近一次 assistant blocks 中提取展示行：

1. `content`
2. `reasoning_content`
3. `action.content`
4. `tool_call.response`

做法：

1. 按 block 顺序拼平为文本行
2. 去空白行
3. 仅保留最近 3 行

### 4.3 waiting 状态判断

优先级：

1. 当前存在 pending `tool_call_permission` -> `waiting_permission`
2. 当前存在 pending `question_request` -> `waiting_question`
3. runtime status=`generating` -> `running`
4. aborted by signal -> `cancelled`
5. runtime status=`error` -> `error`
6. 否则 `completed`

### 4.4 父删子级联

在 `NewAgentPresenter.deleteSession()` 递归查 child：

1. 父删除时先深度删除所有 child
2. child 单独删除不反查父
3. 删除 child 时不删除 parent

## 5. 测试策略

### Main

1. SQLite migration / default columns
2. `NewSessionManager` 读写新字段
3. `NewAgentPresenter.getSessionList()` 过滤与级联删除
4. `AgentToolManager` tool gating
5. `subagent_orchestrator` 的 parallel / chain 执行顺序
6. progress snapshot 与 preview 裁剪

### Renderer

1. `MessageBlockToolCall` subagent card 渲染与自动折叠
2. `ChatPage` overlay 从 `subagentProgress` 提取 child interaction
3. `WorkspacePanel` 子会话列表点击切换
4. `ChatTopBar` child session back-to-parent
5. `DeepChatAgentsSettings` slot 默认值、上限和保存载入

## 6. 风险与缓解

1. 风险：active child session 不在 sidebar sessions 中，导致顶部/状态栏读不到 session。
   缓解：session store 维护独立 `activeSessionRecord`。

2. 风险：tool progress 写回过于频繁，造成 renderer 抖动。
   缓解：只在 child blocks/status 真变化时发 progress；preview 只保留 3 行。

3. 风险：父会话取消时 child 仍继续跑。
   缓解：`signal` 中断 orchestrator；对子 session 调 `cancelGeneration()` 并标记 `cancelled`。

4. 风险：slot 指向 ACP 或禁用 agent。
   缓解：tool gating 与执行前双重过滤，无效 slot 不暴露、不执行。

## 7. 验证门槛

1. `pnpm run format`
2. `pnpm run i18n`
3. `pnpm run lint`
4. 关键 main / renderer 测试通过
