# Subagent Orchestrator V1 任务拆分

## 1. Shared / Schema

1. 扩展 `DeepChatAgentConfig`、`DeepChatSubagentSlot`、session record、tool progress 类型
2. 扩展 `INewAgentPresenter` / `IToolPresenter`
3. 为 `new_sessions` 增加 subagent 相关列与迁移测试

## 2. Main Session Layer

1. 更新 `NewSessionsTable` / `NewSessionManager` create-get-list-update
2. 更新 `NewAgentPresenter`：
   - create session / detached session 支持 `subagentEnabled`
   - `getSessionList()` 支持 `includeSubagents` / `parentSessionId`
   - `setSessionSubagentEnabled()`
   - 父删子级联
3. 增加 runtime port 的 subagent session helper

## 3. Tool Runtime

1. 在 `AgentToolManager` 增加 `subagent_orchestrator` tool schema / definition / gating
2. 实现 slot 校验与 `self` slot 继承逻辑
3. 实现 child session 创建、handoff、parallel / chain 调度
4. 生成 progress payload 与 final markdown
5. 接入 abort signal

## 4. DeepChat Bridge

1. 定义 main-only subagent runtime events
2. `dispatch` 发 child block update event
3. `DeepChatAgentPresenter` 发 child status / refresh event
4. `dispatch.executeTools()` / `executeDeferredToolCall()` 接 `onProgress`
5. 把 `subagentProgress` / `subagentFinal` 写回 assistant block extra

## 5. Renderer

1. `draftStore` / `NewThreadPage` / `ChatStatusBar` 增加 session-level subagent toggle
2. `DeepChatAgentsSettings` 增加 subagent settings UI
3. `MessageBlockToolCall` 渲染 subagent cards
4. `ChatPage` overlay bridge 扫描 child waiting interaction
5. `WorkspacePanel` 增加 `Subagents` section
6. `ChatTopBar` 增加 `Back to Parent`

## 6. Tests & Validation

1. main：migration / presenter / tool execution / progress
2. renderer：tool cards / overlay / workspace / settings
3. 运行 `pnpm run format`
4. 运行 `pnpm run i18n`
5. 运行 `pnpm run lint`
