# ACP Runtime Protocol

## 目标
定义 ACP 运行态在渲染端与主进程之间的交互协议与事件边界，避免污染 Conversation 域。

## Presenter API (ISessionPresenter, provider internal)
```ts
getAcpWorkdir(conversationId: string, agentId: string): Promise<AcpWorkdirInfo>
setAcpWorkdir(conversationId: string, agentId: string, workdir: string | null): Promise<void>

warmupAcpProcess(agentId: string, workdir: string): Promise<void>
ensureAcpWarmup(agentId: string, workdir: string | null): Promise<void>
getAcpProcessModes(
  agentId: string,
  workdir: string
): Promise<{ availableModes?: any; currentModeId?: string } | undefined>
getAcpProcessModels(
  agentId: string,
  workdir: string
): Promise<{
  availableModels?: Array<{ id: string; name: string; description?: string }>
  currentModelId?: string
} | undefined>

getAcpSessionModes(
  conversationId: string
): Promise<{ current: string; available: any[] } | null>
setAcpSessionMode(conversationId: string, modeId: string): Promise<void>
getAcpSessionModels(
  conversationId: string
): Promise<{
  current: string
  available: Array<{ id: string; name: string; description?: string }>
} | null>
setAcpSessionModel(conversationId: string, modelId: string): Promise<void>

setAcpPreferredProcessMode(agentId: string, workdir: string, modeId: string): Promise<void>
setAcpPreferredProcessModel(agentId: string, workdir: string, modelId: string): Promise<void>
```

## Events (Main -> Renderer)
```ts
ACP_WORKSPACE_EVENTS.SESSION_MODES_READY
ACP_WORKSPACE_EVENTS.SESSION_MODELS_READY
ACP_WORKSPACE_EVENTS.COMMANDS_UPDATE
```

## 约束
- ACP 运行态不持久化为 Conversation 数据。
- UI 只通过本协议查询/设置运行态，不直接访问进程层实现细节。
- `setAcpPreferredProcessMode/Model` 为进程级偏好，`setAcpSessionMode/Model` 为会话级覆盖。
