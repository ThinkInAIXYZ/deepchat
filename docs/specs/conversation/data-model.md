# Conversation Domain Data Model

## 目标
给出 Conversation 域的核心对象与字段边界，保持“持久化记录”和“运行态绑定”的清晰分工。

## 核心对象
```ts
type ConversationId = string

type MessageId = string

type ConversationSettings = {
  providerId: string
  modelId: string
  systemPrompt: string
  temperature: number
  contextLength: number
  maxTokens: number
  enabledMcpTools?: string[]
  activeSkills?: string[]
  thinkingBudget?: number
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  verbosity?: 'low' | 'medium' | 'high'
  chatMode?: 'agent' | 'acp agent'
  acpWorkdirMap?: Record<string, string | null>
  agentWorkspacePath?: string | null
}

type Conversation = {
  id: ConversationId
  title: string
  settings: ConversationSettings
  createdAt: number
  updatedAt: number
  isPinned?: boolean
  parentConversationId?: ConversationId | null
  parentMessageId?: MessageId | null
}

type SessionStatus = 'idle' | 'generating' | 'paused' | 'waiting_permission' | 'error'

type SessionBindings = {
  tabId: number | null
  windowId: number | null
  windowType: 'main' | 'floating' | 'browser' | null
}

type WorkspaceContext = {
  resolvedChatMode: 'chat' | 'agent' | 'acp agent'
  agentWorkspacePath: string | null
  acpWorkdirMap?: Record<string, string | null>
}

type Session = {
  conversationId: ConversationId
  status: SessionStatus
  bindings: SessionBindings
  context: WorkspaceContext
  updatedAt: number
}
```

## 关系与约束
- Conversation 为持久化记录；Session 仅代表运行态绑定，不写回存储。
- 允许多个 Session 同时绑定同一 Conversation（多窗口/多标签场景）。
- Conversation 的分支仅产生新 Conversation，不维护子会话关系，但保留派生来源记录。

## 消息结构
- 消息结构以 `src/shared/types/presenters/thread.presenter.d.ts` 与 `src/shared/types/core/chat-message.ts` 为准。
- Conversation 域只消费消息流结果，不重定义消息 schema。

## 兼容字段（现存但不在本域）
- `ConversationSettings.enableSearch` / `forcedSearch` / `searchStrategy`
- `ConversationSettings.artifacts`
- `ConversationSettings.selectedVariantsMap`
 - `ConversationSettings.enabledMcpTools` / `activeSkills` 为既有命名，暂不重命名

## 说明
- `WorkspaceContext.resolvedChatMode` 是运行态推导值，默认可能为 `chat`，不要求存储层显式持久化。
