import { eventBus, SendTarget } from '@/eventbus'
import { STREAM_EVENTS } from '@/events'
import type {
  AssistantMessage,
  AssistantMessageBlock,
  Message,
  MessageFile,
  UserMessage,
  UserMessageContent
} from '@shared/chat'
import type { CONVERSATION, MCPToolResponse, SearchResult } from '@shared/presenter'
import { ContentEnricher } from '../enrichers/contentEnricher'
import {
  buildUserMessageContext,
  formatUserMessageContent,
  getNormalizedUserMessageText
} from '../utils/messageContent'
import { preparePromptContent } from '../builders/promptBuilder'
import type { GeneratingMessageState } from '../types'
import { presenter } from '@/presenter'
import type { SearchHandler } from './searchHandler'
import { BaseHandler, type ThreadHandlerContext } from './baseHandler'
import type { LLMEventHandler } from './llmEventHandler'

interface StreamGenerationHandlerDeps {
  searchHandler: SearchHandler
  generatingMessages: Map<string, GeneratingMessageState>
  llmEventHandler: LLMEventHandler
}

export class StreamGenerationHandler extends BaseHandler {
  private readonly searchHandler: SearchHandler
  private readonly generatingMessages: Map<string, GeneratingMessageState>
  private readonly llmEventHandler: LLMEventHandler

  constructor(context: ThreadHandlerContext, deps: StreamGenerationHandlerDeps) {
    super(context)
    this.searchHandler = deps.searchHandler
    this.generatingMessages = deps.generatingMessages
    this.llmEventHandler = deps.llmEventHandler
    this.assertDependencies()
  }

  private assertDependencies(): void {
    void this.searchHandler
    void this.generatingMessages
    void this.llmEventHandler
  }

  async startStreamCompletion(
    conversationId: string,
    queryMsgId?: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<void> {
    const state = this.findGeneratingState(conversationId)
    if (!state) {
      console.warn('[StreamGenerationHandler] State not found, conversationId:', conversationId)
      return
    }

    try {
      state.isCancelled = false

      const { conversation, userMessage, contextMessages } = await this.prepareConversationContext(
        conversationId,
        queryMsgId,
        selectedVariantsMap
      )

      const { providerId, modelId } = conversation.settings
      const modelConfig = this.ctx.configPresenter.getModelConfig(modelId, providerId)
      if (!modelConfig) {
        throw new Error(`Model config not found for provider ${providerId} and model ${modelId}`)
      }

      this.throwIfCancelled(state.message.id)

      const { userContent, urlResults, imageFiles } = await this.processUserMessageContent(
        userMessage as UserMessage
      )

      this.throwIfCancelled(state.message.id)

      let searchResults: SearchResult[] | null = null
      if ((userMessage.content as UserMessageContent).search) {
        try {
          searchResults = await this.searchHandler.startStreamSearch(
            conversationId,
            state.message.id,
            userContent
          )
          this.throwIfCancelled(state.message.id)
        } catch (error) {
          if (String(error).includes('userCanceledGeneration')) {
            return
          }
          console.error('[StreamGenerationHandler] Error during search:', error)
        }
      }

      this.throwIfCancelled(state.message.id)

      const { finalContent, promptTokens } = await preparePromptContent({
        conversation,
        userContent,
        contextMessages,
        searchResults,
        urlResults,
        userMessage,
        vision: Boolean(modelConfig?.vision),
        imageFiles: modelConfig?.vision ? imageFiles : [],
        supportsFunctionCall: modelConfig.functionCall,
        modelType: modelConfig.type
      })

      this.throwIfCancelled(state.message.id)

      await this.updateGenerationState(state, promptTokens)

      this.throwIfCancelled(state.message.id)

      const currentConversation = await this.getConversation(conversationId)
      const {
        providerId: currentProviderId,
        modelId: currentModelId,
        temperature: currentTemperature,
        maxTokens: currentMaxTokens,
        enabledMcpTools: currentEnabledMcpTools,
        thinkingBudget: currentThinkingBudget,
        reasoningEffort: currentReasoningEffort,
        verbosity: currentVerbosity,
        enableSearch: currentEnableSearch,
        forcedSearch: currentForcedSearch,
        searchStrategy: currentSearchStrategy
      } = currentConversation.settings

      const stream = this.ctx.llmProviderPresenter.startStreamCompletion(
        currentProviderId,
        finalContent,
        currentModelId,
        state.message.id,
        currentTemperature,
        currentMaxTokens,
        currentEnabledMcpTools,
        currentThinkingBudget,
        currentReasoningEffort,
        currentVerbosity,
        currentEnableSearch,
        currentForcedSearch,
        currentSearchStrategy
      )

      for await (const event of stream) {
        const msg = event.data
        if (event.type === 'response') {
          await this.llmEventHandler.handleLLMAgentResponse(msg)
        } else if (event.type === 'error') {
          await this.llmEventHandler.handleLLMAgentError(msg)
        } else if (event.type === 'end') {
          await this.llmEventHandler.handleLLMAgentEnd(msg)
        }
      }
    } catch (error) {
      if (String(error).includes('userCanceledGeneration')) {
        console.log('[StreamGenerationHandler] Message generation cancelled by user')
        return
      }

      console.error('[StreamGenerationHandler] Error during streaming generation:', error)
      await this.ctx.messageManager.handleMessageError(state.message.id, String(error))
      throw error
    }
  }

  async continueStreamCompletion(
    conversationId: string,
    queryMsgId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<void> {
    const state = this.findGeneratingState(conversationId)
    if (!state) {
      console.warn('[StreamGenerationHandler] State not found, conversationId:', conversationId)
      return
    }

    try {
      state.isCancelled = false

      const queryMessage = await this.ctx.messageManager.getMessage(queryMsgId)
      if (!queryMessage) {
        throw new Error('Message not found')
      }

      const content = queryMessage.content as AssistantMessageBlock[]
      const lastActionBlock = content.filter((block) => block.type === 'action').pop()

      if (!lastActionBlock || lastActionBlock.type !== 'action') {
        throw new Error('Last action block not found')
      }

      let toolCallResponse: { content: string; rawData: MCPToolResponse } | null = null
      const toolCall = lastActionBlock.tool_call

      if (lastActionBlock.action_type === 'maximum_tool_calls_reached' && toolCall) {
        if (lastActionBlock.extra) {
          lastActionBlock.extra = {
            ...lastActionBlock.extra,
            needContinue: false
          }
        }
        await this.ctx.messageManager.editMessage(queryMsgId, JSON.stringify(content))

        if (!toolCall.id || !toolCall.name || !toolCall.params) {
          console.warn('[StreamGenerationHandler] Tool call parameters incomplete')
        } else {
          toolCallResponse = await presenter.mcpPresenter.callTool({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: toolCall.params
            },
            server: {
              name: toolCall.server_name || '',
              icons: toolCall.server_icons || '',
              description: toolCall.server_description || ''
            }
          })
        }
      }

      this.throwIfCancelled(state.message.id)

      const { conversation, contextMessages, userMessage } = await this.prepareConversationContext(
        conversationId,
        state.message.id,
        selectedVariantsMap
      )

      this.throwIfCancelled(state.message.id)

      const {
        providerId,
        modelId,
        temperature,
        maxTokens,
        enabledMcpTools,
        thinkingBudget,
        reasoningEffort,
        verbosity,
        enableSearch,
        forcedSearch,
        searchStrategy
      } = conversation.settings
      const modelConfig = this.ctx.configPresenter.getModelConfig(modelId, providerId)
      if (!modelConfig) {
        throw new Error(`Model config not found for ${providerId}/${modelId}`)
      }

      const { finalContent, promptTokens } = await preparePromptContent({
        conversation,
        userContent: 'continue',
        contextMessages,
        searchResults: null,
        urlResults: [],
        userMessage,
        vision: false,
        imageFiles: [],
        supportsFunctionCall: modelConfig.functionCall,
        modelType: modelConfig.type
      })

      await this.updateGenerationState(state, promptTokens)

      if (toolCallResponse && toolCall) {
        eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
          eventId: state.message.id,
          content: '',
          tool_call: 'start',
          tool_call_id: toolCall.id,
          tool_call_name: toolCall.name,
          tool_call_params: toolCall.params,
          tool_call_response: toolCallResponse.content,
          tool_call_server_name: toolCall.server_name,
          tool_call_server_icons: toolCall.server_icons,
          tool_call_server_description: toolCall.server_description
        })
        eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
          eventId: state.message.id,
          content: '',
          tool_call: 'running',
          tool_call_id: toolCall.id,
          tool_call_name: toolCall.name,
          tool_call_params: toolCall.params,
          tool_call_response: toolCallResponse.content,
          tool_call_server_name: toolCall.server_name,
          tool_call_server_icons: toolCall.server_icons,
          tool_call_server_description: toolCall.server_description
        })
        eventBus.sendToRenderer(STREAM_EVENTS.RESPONSE, SendTarget.ALL_WINDOWS, {
          eventId: state.message.id,
          content: '',
          tool_call: 'end',
          tool_call_id: toolCall.id,
          tool_call_response: toolCallResponse.content,
          tool_call_name: toolCall.name,
          tool_call_params: toolCall.params,
          tool_call_server_name: toolCall.server_name,
          tool_call_server_icons: toolCall.server_icons,
          tool_call_server_description: toolCall.server_description,
          tool_call_response_raw: toolCallResponse.rawData
        })
      }

      const stream = this.ctx.llmProviderPresenter.startStreamCompletion(
        providerId,
        finalContent,
        modelId,
        state.message.id,
        temperature,
        maxTokens,
        enabledMcpTools,
        thinkingBudget,
        reasoningEffort,
        verbosity,
        enableSearch,
        forcedSearch,
        searchStrategy
      )

      for await (const event of stream) {
        const msg = event.data
        if (event.type === 'response') {
          await this.llmEventHandler.handleLLMAgentResponse(msg)
        } else if (event.type === 'error') {
          await this.llmEventHandler.handleLLMAgentError(msg)
        } else if (event.type === 'end') {
          await this.llmEventHandler.handleLLMAgentEnd(msg)
        }
      }
    } catch (error) {
      if (String(error).includes('userCanceledGeneration')) {
        console.log('[StreamGenerationHandler] Message generation cancelled by user')
        return
      }

      console.error('[StreamGenerationHandler] Error during continue generation:', error)
      await this.ctx.messageManager.handleMessageError(state.message.id, String(error))
      throw error
    }
  }

  async prepareConversationContext(
    conversationId: string,
    queryMsgId?: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<{
    conversation: CONVERSATION
    userMessage: Message
    contextMessages: Message[]
  }> {
    const conversation = await this.getConversation(conversationId)
    let contextMessages: Message[] = []
    let userMessage: Message | null = null

    if (queryMsgId) {
      const queryMessage = await this.ctx.messageManager.getMessage(queryMsgId)
      if (!queryMessage) {
        throw new Error('Message not found')
      }

      if (queryMessage.role === 'user') {
        userMessage = queryMessage
      } else if (queryMessage.role === 'assistant') {
        if (!queryMessage.parentId) {
          throw new Error('Assistant message missing parentId')
        }
        userMessage = await this.ctx.messageManager.getMessage(queryMessage.parentId)
        if (!userMessage) {
          throw new Error('Trigger message not found')
        }
      } else {
        throw new Error('Unsupported message type')
      }

      contextMessages = await this.ctx.messageManager.getMessageHistory(
        userMessage.id,
        conversation.settings.contextLength
      )
    } else {
      userMessage = await this.ctx.messageManager.getLastUserMessage(conversationId)
      if (!userMessage) {
        throw new Error('User message not found')
      }
      contextMessages = await this.getContextMessages(conversation)
    }

    if (selectedVariantsMap && Object.keys(selectedVariantsMap).length > 0) {
      contextMessages = contextMessages.map((msg) => {
        if (msg.role === 'assistant' && selectedVariantsMap[msg.id] && msg.variants) {
          const selectedVariantId = selectedVariantsMap[msg.id]
          const selectedVariant = msg.variants.find((v) => v.id === selectedVariantId)

          if (selectedVariant) {
            const newMsg = JSON.parse(JSON.stringify(msg))
            newMsg.content = selectedVariant.content
            newMsg.usage = selectedVariant.usage
            newMsg.model_id = selectedVariant.model_id
            newMsg.model_provider = selectedVariant.model_provider
            return newMsg
          }
        }
        return msg
      })
    }

    if (userMessage.role === 'user') {
      const msgContent = userMessage.content as UserMessageContent
      if (msgContent.content && !msgContent.text) {
        msgContent.text = formatUserMessageContent(msgContent.content)
      }
    }

    const webSearchEnabled = this.ctx.configPresenter.getSetting('input_webSearch') as boolean
    const thinkEnabled = this.ctx.configPresenter.getSetting('input_deepThinking') as boolean
    ;(userMessage.content as UserMessageContent).search = webSearchEnabled
    ;(userMessage.content as UserMessageContent).think = thinkEnabled

    return { conversation, userMessage, contextMessages }
  }

  async processUserMessageContent(
    userMessage: UserMessage
  ): Promise<{ userContent: string; urlResults: SearchResult[]; imageFiles: MessageFile[] }> {
    const userContent = buildUserMessageContext(userMessage.content)
    const normalizedText = getNormalizedUserMessageText(userMessage.content)
    const urlResults = await ContentEnricher.extractAndEnrichUrls(normalizedText)

    const imageFiles =
      userMessage.content.files?.filter((file) => {
        const isImage =
          file.mimeType.startsWith('data:image') ||
          /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(file.name || '')
        return isImage
      }) || []

    return { userContent, urlResults, imageFiles }
  }

  async updateGenerationState(state: GeneratingMessageState, promptTokens: number): Promise<void> {
    this.generatingMessages.set(state.message.id, {
      ...state,
      startTime: Date.now(),
      firstTokenTime: null,
      promptTokens
    })

    await this.ctx.messageManager.updateMessageMetadata(state.message.id, {
      totalTokens: promptTokens,
      generationTime: 0,
      firstTokenTime: 0,
      tokensPerSecond: 0
    })
  }

  findGeneratingState(conversationId: string): GeneratingMessageState | null {
    return (
      Array.from(this.generatingMessages.values()).find(
        (state) => state.conversationId === conversationId
      ) || null
    )
  }

  async regenerateFromUserMessage(
    conversationId: string,
    userMessageId: string,
    selectedVariantsMap?: Record<string, string>
  ): Promise<AssistantMessage> {
    const userMessage = await this.ctx.messageManager.getMessage(userMessageId)
    if (!userMessage || userMessage.role !== 'user') {
      throw new Error('Can only regenerate based on user messages.')
    }

    const conversation = await this.getConversation(conversationId)
    const { providerId, modelId } = conversation.settings

    const assistantMessage = (await this.ctx.messageManager.sendMessage(
      conversationId,
      JSON.stringify([]),
      'assistant',
      userMessageId,
      false,
      {
        totalTokens: 0,
        generationTime: 0,
        firstTokenTime: 0,
        tokensPerSecond: 0,
        contextUsage: 0,
        inputTokens: 0,
        outputTokens: 0,
        model: modelId,
        provider: providerId
      }
    )) as AssistantMessage

    this.generatingMessages.set(assistantMessage.id, {
      message: assistantMessage,
      conversationId,
      startTime: Date.now(),
      firstTokenTime: null,
      promptTokens: 0,
      reasoningStartTime: null,
      reasoningEndTime: null,
      lastReasoningTime: null
    })

    this.startStreamCompletion(conversationId, userMessageId, selectedVariantsMap).catch(
      (error) => {
        console.error(
          '[StreamGenerationHandler] Failed to start regeneration from user message:',
          error
        )
      }
    )

    return assistantMessage
  }

  async generateAIResponse(
    conversationId: string,
    userMessageId: string
  ): Promise<AssistantMessage> {
    try {
      const triggerMessage = await this.ctx.messageManager.getMessage(userMessageId)
      if (!triggerMessage) {
        throw new Error('Trigger message not found')
      }

      await this.ctx.messageManager.updateMessageStatus(userMessageId, 'sent')

      const conversation = await this.getConversation(conversationId)
      const { providerId, modelId } = conversation.settings
      const assistantMessage = (await this.ctx.messageManager.sendMessage(
        conversationId,
        JSON.stringify([]),
        'assistant',
        userMessageId,
        false,
        {
          contextUsage: 0,
          totalTokens: 0,
          generationTime: 0,
          firstTokenTime: 0,
          tokensPerSecond: 0,
          inputTokens: 0,
          outputTokens: 0,
          model: modelId,
          provider: providerId
        }
      )) as AssistantMessage

      return assistantMessage
    } catch (error) {
      await this.ctx.messageManager.updateMessageStatus(userMessageId, 'error')
      console.error('[StreamGenerationHandler] Failed to generate AI response:', error)
      throw error
    }
  }

  async getMessageHistory(messageId: string, limit: number = 100): Promise<Message[]> {
    return this.ctx.messageManager.getMessageHistory(messageId, limit)
  }

  private async getConversation(conversationId: string): Promise<CONVERSATION> {
    const conversation = await this.ctx.sqlitePresenter.getConversation(conversationId)
    if (!conversation) {
      throw new Error('conversation not found')
    }
    return conversation
  }

  private async getContextMessages(conversation: CONVERSATION): Promise<Message[]> {
    let messageCount = Math.ceil(conversation.settings.contextLength / 300)
    if (messageCount < 2) {
      messageCount = 2
    }
    return this.ctx.messageManager.getContextMessages(conversation.id, messageCount)
  }

  private throwIfCancelled(messageId: string): void {
    if (this.isMessageCancelled(messageId)) {
      throw new Error('common.error.userCanceledGeneration')
    }
  }

  private isMessageCancelled(messageId: string): boolean {
    const state = this.generatingMessages.get(messageId)
    return !state || state.isCancelled === true
  }
}
