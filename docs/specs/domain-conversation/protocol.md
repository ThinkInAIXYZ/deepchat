# Conversation Domain Protocol

## 目标
定义 Conversation 域在渲染端与主进程之间的交互协议与事件边界。

## Presenter API

### Conversation APIs (IThreadPresenter, legacy name)
```ts
createConversation(
  title: string,
  settings: Partial<ConversationSettings>,
  tabId: number,
  options?: { forceNewAndActivate?: boolean }
): Promise<string>
getConversation(conversationId: string): Promise<Conversation>
getConversationList(
  page: number,
  pageSize: number
): Promise<{ total: number; list: Conversation[] }>
renameConversation(conversationId: string, title: string): Promise<Conversation>
updateConversationSettings(
  conversationId: string,
  settings: Partial<ConversationSettings>
): Promise<void>
deleteConversation(conversationId: string): Promise<void>
toggleConversationPinned(conversationId: string, isPinned: boolean): Promise<void>

forkConversation(
  targetConversationId: string,
  targetMessageId: string,
  newTitle: string,
  settings?: Partial<ConversationSettings>
): Promise<string>

setActiveConversation(conversationId: string, tabId: number): Promise<void>
getActiveConversation(tabId: number): Promise<Conversation | null>
getActiveConversationId(tabId: number): Promise<string | null>
findTabForConversation(conversationId: string): Promise<number | null>

getMessageThread(
  conversationId: string,
  page: number,
  pageSize: number
): Promise<{ total: number; messages: Message[] }>
getMessageIds(conversationId: string): Promise<string[]>
getMessage(messageId: string): Promise<Message>
editMessage(messageId: string, content: string): Promise<Message>
deleteMessage(messageId: string): Promise<void>
clearAllMessages(conversationId: string): Promise<void>
getContextMessages(conversationId: string): Promise<Message[]>
```

### Execution APIs (IAgentPresenter)
```ts
sendMessage(
  agentId: string,
  content: string,
  tabId?: number,
  selectedVariantsMap?: Record<string, string>
): Promise<AssistantMessage | null>
continueLoop(
  agentId: string,
  messageId: string,
  selectedVariantsMap?: Record<string, string>
): Promise<AssistantMessage | null>
retryMessage(
  messageId: string,
  selectedVariantsMap?: Record<string, string>
): Promise<AssistantMessage>
cancelLoop(messageId: string): Promise<void>
regenerateFromUserMessage(
  agentId: string,
  userMessageId: string,
  selectedVariantsMap?: Record<string, string>
): Promise<AssistantMessage>
```

### Export & NowledgeMem APIs (IConversationExporter)
```ts
exportConversation(
  conversationId: string,
  format: 'markdown' | 'html' | 'txt' | 'nowledge-mem'
): Promise<{ filename: string; content: string }>
exportToNowledgeMem(conversationId: string): Promise<{
  success: boolean
  errors?: string[]
  warnings?: string[]
}>
submitToNowledgeMem(conversationId: string): Promise<{
  success: boolean
  threadId?: string
  errors?: string[]
}>
testNowledgeMemConnection(): Promise<{
  success: boolean
  message?: string
  error?: string
}>
updateNowledgeMemConfig(config: {
  baseUrl?: string
  apiKey?: string
  timeout?: number
}): Promise<void>
getNowledgeMemConfig(): { baseUrl: string; apiKey?: string; timeout: number }
```

## Events (Main -> Renderer)
```ts
CONVERSATION_EVENTS.LIST_UPDATED
CONVERSATION_EVENTS.ACTIVATED
CONVERSATION_EVENTS.DEACTIVATED
CONVERSATION_EVENTS.MESSAGE_EDITED
CONVERSATION_EVENTS.SCROLL_TO_MESSAGE

STREAM_EVENTS.RESPONSE
STREAM_EVENTS.END
STREAM_EVENTS.ERROR

MCP_EVENTS.TOOL_CALL_RESULT
```

## 协议约束
- Conversation 域只消费事件结果，不直接执行工具或访问存储。
- ACP 运行态协议见 `docs/specs/domain-conversation/acp-runtime.md`。
- Export/NowledgeMem 为独立路径，不写入会话核心状态。
- Presenter 名称在代码中为 `exporter`，此处接口名仅用于协议说明。
