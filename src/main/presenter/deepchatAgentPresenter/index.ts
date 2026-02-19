import type {
  IAgentImplementation,
  DeepChatSessionState,
  ChatMessageRecord,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { IConfigPresenter, ILlmProviderPresenter, ModelConfig } from '@shared/presenter'
import type { SQLitePresenter } from '../sqlitePresenter'
import type { ChatMessage } from '@shared/types/core/chat-message'
import { DeepChatSessionStore } from './sessionStore'
import { DeepChatMessageStore } from './messageStore'
import { handleStream } from './streamHandler'
import { eventBus, SendTarget } from '@/eventbus'
import { SESSION_EVENTS } from '@/events'

export class DeepChatAgentPresenter implements IAgentImplementation {
  private llmProviderPresenter: ILlmProviderPresenter
  private configPresenter: IConfigPresenter
  private sessionStore: DeepChatSessionStore
  private messageStore: DeepChatMessageStore
  private runtimeState: Map<string, DeepChatSessionState> = new Map()
  private abortControllers: Map<string, AbortController> = new Map()

  constructor(
    llmProviderPresenter: ILlmProviderPresenter,
    configPresenter: IConfigPresenter,
    sqlitePresenter: SQLitePresenter
  ) {
    this.llmProviderPresenter = llmProviderPresenter
    this.configPresenter = configPresenter
    this.sessionStore = new DeepChatSessionStore(sqlitePresenter)
    this.messageStore = new DeepChatMessageStore(sqlitePresenter)

    // Crash recovery: mark any pending messages as error
    const recovered = this.messageStore.recoverPendingMessages()
    if (recovered > 0) {
      console.log(`DeepChatAgent: recovered ${recovered} pending messages to error status`)
    }
  }

  async initSession(
    sessionId: string,
    config: { providerId: string; modelId: string }
  ): Promise<void> {
    console.log(
      `[DeepChatAgent] initSession id=${sessionId} provider=${config.providerId} model=${config.modelId}`
    )
    this.sessionStore.create(sessionId, config.providerId, config.modelId)
    this.runtimeState.set(sessionId, {
      status: 'idle',
      providerId: config.providerId,
      modelId: config.modelId
    })
  }

  async destroySession(sessionId: string): Promise<void> {
    // Cancel any in-progress generation
    const controller = this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(sessionId)
    }

    this.messageStore.deleteBySession(sessionId)
    this.sessionStore.delete(sessionId)
    this.runtimeState.delete(sessionId)
  }

  async getSessionState(sessionId: string): Promise<DeepChatSessionState | null> {
    const state = this.runtimeState.get(sessionId)
    if (state) return state

    // Fallback: rebuild from DB
    const dbSession = this.sessionStore.get(sessionId)
    if (!dbSession) return null

    const rebuilt: DeepChatSessionState = {
      status: 'idle',
      providerId: dbSession.provider_id,
      modelId: dbSession.model_id
    }
    this.runtimeState.set(sessionId, rebuilt)
    return rebuilt
  }

  async processMessage(sessionId: string, content: string): Promise<void> {
    const state = this.runtimeState.get(sessionId)
    if (!state) throw new Error(`Session ${sessionId} not found`)

    console.log(
      `[DeepChatAgent] processMessage session=${sessionId} content="${content.slice(0, 60)}"`
    )

    // Update status to generating
    state.status = 'generating'
    eventBus.sendToRenderer(SESSION_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
      sessionId,
      status: 'generating'
    })

    try {
      // 1. Persist user message
      const userOrderSeq = this.messageStore.getNextOrderSeq(sessionId)
      const userContent: UserMessageContent = {
        text: content,
        files: [],
        links: [],
        search: false,
        think: false
      }
      const userMsgId = this.messageStore.createUserMessage(sessionId, userOrderSeq, userContent)
      console.log(`[DeepChatAgent] user message created id=${userMsgId} seq=${userOrderSeq}`)

      // 2. Create pending assistant message
      const assistantOrderSeq = this.messageStore.getNextOrderSeq(sessionId)
      const assistantMessageId = this.messageStore.createAssistantMessage(
        sessionId,
        assistantOrderSeq
      )
      console.log(
        `[DeepChatAgent] assistant message created id=${assistantMessageId} seq=${assistantOrderSeq}`
      )

      // 3. Build messages for LLM (v0: single user message, no context)
      const messages: ChatMessage[] = [{ role: 'user', content }]

      // 4. Get provider and model config
      console.log(`[DeepChatAgent] getting provider instance for "${state.providerId}"`)
      const provider = (
        this.llmProviderPresenter as unknown as {
          getProviderInstance: (id: string) => {
            coreStream: (
              messages: ChatMessage[],
              modelId: string,
              modelConfig: ModelConfig,
              temperature: number,
              maxTokens: number,
              tools: unknown[]
            ) => AsyncGenerator<import('@shared/types/core/llm-events').LLMCoreStreamEvent>
          }
        }
      ).getProviderInstance(state.providerId)

      const modelConfig = this.configPresenter.getModelConfig(state.modelId, state.providerId)
      const temperature = modelConfig.temperature ?? 0.7
      const maxTokens = modelConfig.maxTokens ?? 4096
      console.log(
        `[DeepChatAgent] calling coreStream model=${state.modelId} temp=${temperature} maxTokens=${maxTokens}`
      )

      // 5. Call LLM coreStream
      const abortController = new AbortController()
      this.abortControllers.set(sessionId, abortController)

      const stream = provider.coreStream(
        messages,
        state.modelId,
        modelConfig,
        temperature,
        maxTokens,
        []
      )

      // 6. Handle the stream
      console.log(`[DeepChatAgent] stream started, entering handleStream`)
      await handleStream(stream, {
        sessionId,
        messageId: assistantMessageId,
        messageStore: this.messageStore,
        abortSignal: abortController.signal
      })

      // 7. Update status to idle
      console.log(`[DeepChatAgent] stream completed, status → idle`)
      state.status = 'idle'
      this.abortControllers.delete(sessionId)
      eventBus.sendToRenderer(SESSION_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
        sessionId,
        status: 'idle'
      })
    } catch (err) {
      console.error('[DeepChatAgent] processMessage error:', err)
      state.status = 'error'
      this.abortControllers.delete(sessionId)
      eventBus.sendToRenderer(SESSION_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
        sessionId,
        status: 'error'
      })
    }
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(sessionId)
    }

    const state = this.runtimeState.get(sessionId)
    if (state) {
      state.status = 'idle'
      eventBus.sendToRenderer(SESSION_EVENTS.STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
        sessionId,
        status: 'idle'
      })
    }
  }

  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    return this.messageStore.getMessages(sessionId)
  }

  async getMessageIds(sessionId: string): Promise<string[]> {
    return this.messageStore.getMessageIds(sessionId)
  }

  async getMessage(messageId: string): Promise<ChatMessageRecord | null> {
    return this.messageStore.getMessage(messageId)
  }
}
