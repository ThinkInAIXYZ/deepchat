import type {
  ChatMessage,
  LLMAgentEventData,
  MCPToolDefinition,
  MESSAGE_METADATA,
  MODEL_META
} from '@shared/presenter'
import type { AssistantMessageBlock, Message, UserMessageContent } from '@shared/chat'
import { ModelType } from '@shared/model'
import { presenter } from '@/presenter'
import { BaseHandler, type ThreadHandlerContext } from './baseHandler'
import { buildUserMessageContext } from '../utils/messageContent'
import {
  buildConversationExportContent,
  generateExportFilename,
  type ConversationExportFormat
} from '../exporters/conversationExporter'
import { preparePromptContent } from '../utils/promptBuilder'
import type { ConversationManager } from '../managers/conversationManager'
import type { StreamGenerationHandler } from './streamGenerationHandler'

// Translation constants
const TRANSLATION_TEMPERATURE = 0.3
const TRANSLATION_TIMEOUT_MS = 1000

// Message length constant for context calculation
const DEFAULT_MESSAGE_LENGTH = 300

export interface UtilityHandlerOptions {
  conversationManager: ConversationManager
  streamGenerationHandler: StreamGenerationHandler
  getSearchAssistantModel: () => MODEL_META | null
  getSearchAssistantProviderId: () => string | null
}

export class UtilityHandler extends BaseHandler {
  private readonly conversationManager: ConversationManager
  private readonly streamGenerationHandler: StreamGenerationHandler
  private readonly getSearchAssistantModel: () => MODEL_META | null
  private readonly getSearchAssistantProviderId: () => string | null

  constructor(context: ThreadHandlerContext, options: UtilityHandlerOptions) {
    super(context)
    this.conversationManager = options.conversationManager
    this.streamGenerationHandler = options.streamGenerationHandler
    this.getSearchAssistantModel = options.getSearchAssistantModel
    this.getSearchAssistantProviderId = options.getSearchAssistantProviderId
  }

  async translateText(text: string, tabId: number): Promise<string> {
    try {
      let conversation = await this.conversationManager.getActiveConversation(tabId)
      if (!conversation) {
        // Create a temporary conversation for translation
        const defaultProvider = this.ctx.configPresenter.getDefaultProviders()[0]
        const models = await this.ctx.llmProviderPresenter.getModelList(defaultProvider.id)
        const defaultModel = models[0]
        const conversationId = await this.conversationManager.createConversation(
          'Temporary translation conversation',
          {
            modelId: defaultModel.id,
            providerId: defaultProvider.id
          },
          tabId
        )
        conversation = await this.conversationManager.getConversation(conversationId)
      }

      const { providerId, modelId } = conversation.settings
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content:
            'You are a translation assistant. Translate the user input to Chinese and return only the translated text without any additional content.'
        },
        {
          role: 'user',
          content: text
        }
      ]

      let translatedText = ''
      const stream = this.ctx.llmProviderPresenter.startStreamCompletion(
        providerId,
        messages,
        modelId,
        'translate-' + Date.now(),
        TRANSLATION_TEMPERATURE,
        TRANSLATION_TIMEOUT_MS
      )

      for await (const event of stream) {
        if (event.type === 'response') {
          const msg = event.data as LLMAgentEventData
          if (msg.content) {
            translatedText += msg.content
          }
        } else if (event.type === 'error') {
          const msg = event.data as { eventId: string; error: string }
          throw new Error(msg.error || 'Translation failed')
        }
      }

      return translatedText.trim()
    } catch (error) {
      console.error('Translation failed:', error)
      if (error instanceof Error) {
        error.message = 'Translation failed'
        throw error
      }
      throw new Error('Translation failed')
    }
  }

  async askAI(text: string, tabId: number): Promise<string> {
    try {
      let conversation = await this.conversationManager.getActiveConversation(tabId)
      if (!conversation) {
        // Create a temporary conversation for AI query
        const defaultProvider = this.ctx.configPresenter.getDefaultProviders()[0]
        const models = await this.ctx.llmProviderPresenter.getModelList(defaultProvider.id)
        const defaultModel = models[0]
        const conversationId = await this.conversationManager.createConversation(
          '临时AI对话',
          {
            modelId: defaultModel.id,
            providerId: defaultProvider.id
          },
          tabId
        )
        conversation = await this.conversationManager.getConversation(conversationId)
      }

      const { providerId, modelId } = conversation.settings
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: '你是一个AI助手。请简洁地回答用户的问题。'
        },
        {
          role: 'user',
          content: text
        }
      ]

      let aiAnswer = ''
      const stream = this.ctx.llmProviderPresenter.startStreamCompletion(
        providerId,
        messages,
        modelId,
        'ask-ai-' + Date.now(),
        0.7,
        1000
      )

      for await (const event of stream) {
        if (event.type === 'response') {
          const msg = event.data as LLMAgentEventData
          if (msg.content) {
            aiAnswer += msg.content
          }
        } else if (event.type === 'error') {
          const msg = event.data as { eventId: string; error: string }
          throw new Error(msg.error || 'AI回答失败')
        }
      }

      return aiAnswer.trim()
    } catch (error) {
      console.error('AI query failed:', error)
      throw error
    }
  }

  async exportConversation(
    conversationId: string,
    format: ConversationExportFormat = 'markdown'
  ): Promise<{ filename: string; content: string }> {
    try {
      // Get conversation
      const conversation = await this.conversationManager.getConversation(conversationId)
      if (!conversation) {
        throw new Error('Conversation not found')
      }

      // Get all messages
      const { list: messages } = await this.ctx.messageManager.getMessageThread(
        conversationId,
        1,
        10000
      )

      // Filter out unsent messages
      const validMessages = messages.filter((msg) => msg.status === 'sent')

      // Apply variant selection
      const selectedVariantsMap = conversation.settings.selectedVariantsMap || {}
      const variantAwareMessages = this.applyVariantSelection(validMessages, selectedVariantsMap)

      // Generate filename
      const filename = generateExportFilename(format)
      const content = buildConversationExportContent(conversation, variantAwareMessages, format)

      return { filename, content }
    } catch (error) {
      console.error('Failed to export conversation:', error)
      throw error
    }
  }

  async summaryTitles(tabId?: number, conversationId?: string): Promise<string> {
    const activeId =
      tabId !== undefined ? this.conversationManager.getActiveConversationIdSync(tabId) : null
    const targetConversationId = conversationId ?? activeId ?? undefined
    if (!targetConversationId) {
      throw new Error('Conversation not found')
    }
    const conversation = await this.conversationManager.getConversation(targetConversationId)
    if (!conversation) {
      throw new Error('Conversation not found')
    }
    let summaryProviderId = conversation.settings.providerId
    const modelId = this.getSearchAssistantModel()?.id
    summaryProviderId = this.getSearchAssistantProviderId() || conversation.settings.providerId

    // Get context messages
    let messageCount = Math.ceil(conversation.settings.contextLength / DEFAULT_MESSAGE_LENGTH)
    if (messageCount < 2) {
      messageCount = 2
    }
    const messages = await this.ctx.messageManager.getContextMessages(conversation.id, messageCount)

    const selectedVariantsMap = conversation.settings.selectedVariantsMap || {}
    const variantAwareMessages = this.applyVariantSelection(messages, selectedVariantsMap)
    const messagesWithLength = variantAwareMessages
      .map((msg) => {
        if (msg.role === 'user') {
          const userContent = msg.content as UserMessageContent
          const serializedContent = buildUserMessageContext(userContent)
          return {
            message: msg,
            length: serializedContent.length,
            formattedMessage: {
              role: 'user' as const,
              content: serializedContent
            }
          }
        } else {
          const content = (msg.content as AssistantMessageBlock[])
            .filter((block) => block.type === 'content')
            .map((block) => block.content)
            .join('\n')
          return {
            message: msg,
            length: content.length,
            formattedMessage: {
              role: 'assistant' as const,
              content: content
            }
          }
        }
      })
      .filter((item) => item.formattedMessage.content.length > 0)
    const title = await this.ctx.llmProviderPresenter.summaryTitles(
      messagesWithLength.map((item) => item.formattedMessage),
      summaryProviderId || conversation.settings.providerId,
      modelId || conversation.settings.modelId
    )
    let cleanedTitle = title.replace(/<think>.*?<\/think>/g, '').trim()
    cleanedTitle = cleanedTitle.replace(/^<think>/, '').trim()
    return cleanedTitle
  }

  async getMessageRequestPreview(messageId: string): Promise<unknown> {
    try {
      // Get message and conversation
      const message = await this.ctx.sqlitePresenter.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        throw new Error('Message not found or not an assistant message')
      }

      const conversation = await this.ctx.sqlitePresenter.getConversation(message.conversation_id)
      const {
        providerId: defaultProviderId,
        modelId: defaultModelId,
        temperature,
        maxTokens,
        enabledMcpTools
      } = conversation.settings

      // Parse metadata to get model_provider and model_id
      let messageMetadata: MESSAGE_METADATA | null = null
      try {
        messageMetadata = JSON.parse(message.metadata) as MESSAGE_METADATA
      } catch (e) {
        console.warn('Failed to parse message metadata:', e)
      }

      const effectiveProviderId = messageMetadata?.provider || defaultProviderId
      const effectiveModelId = messageMetadata?.model || defaultModelId

      // Get user message (parent of assistant message)
      const userMessageSqlite = await this.ctx.sqlitePresenter.getMessage(message.parent_id || '')
      if (!userMessageSqlite) {
        throw new Error('User message not found')
      }

      // Convert SQLITE_MESSAGE to Message type
      const userMessage = this.ctx.messageManager['convertToMessage'](userMessageSqlite)

      // Get context messages using getMessageHistory
      const contextMessages = await this.streamGenerationHandler.getMessageHistory(
        userMessage.id,
        conversation.settings.contextLength
      )

      // Prepare prompt content (reconstruct what was sent)
      let modelConfig = this.ctx.configPresenter.getModelConfig(
        effectiveModelId,
        effectiveProviderId
      )
      if (!modelConfig) {
        modelConfig = this.ctx.configPresenter.getModelConfig(defaultModelId, defaultProviderId)
      }

      if (!modelConfig) {
        throw new Error(
          `Model config not found for provider ${effectiveProviderId} and model ${effectiveModelId}`
        )
      }

      const supportsFunctionCall = modelConfig?.functionCall ?? false
      const visionEnabled = modelConfig?.vision ?? false

      // Extract user content from userMessage
      let userContent = ''
      if (typeof userMessage.content === 'string') {
        userContent = userMessage.content
      } else if (
        userMessage.content &&
        typeof userMessage.content === 'object' &&
        'text' in userMessage.content
      ) {
        userContent = userMessage.content.text || ''
      }

      const { finalContent } = await preparePromptContent({
        conversation,
        userContent,
        contextMessages,
        searchResults: null,
        urlResults: [],
        userMessage,
        vision: visionEnabled,
        imageFiles: [],
        supportsFunctionCall,
        modelType: ModelType.Chat
      })

      // Get MCP tools
      let mcpTools: MCPToolDefinition[] = []
      try {
        const toolDefinitions = await presenter.mcpPresenter.getAllToolDefinitions(enabledMcpTools)
        if (Array.isArray(toolDefinitions)) {
          mcpTools = toolDefinitions
        }
      } catch (error) {
        console.warn('Failed to load MCP tool definitions for preview', error)
      }

      // Get provider and request preview
      const provider = this.ctx.llmProviderPresenter.getProviderInstance(effectiveProviderId)
      if (!provider) {
        throw new Error(`Provider ${effectiveProviderId} not found`)
      }

      // Type assertion for provider instance
      const providerInstance = provider as {
        getRequestPreview: (
          messages: ChatMessage[],
          modelId: string,
          modelConfig: unknown,
          temperature: number,
          maxTokens: number,
          mcpTools: MCPToolDefinition[]
        ) => Promise<{
          endpoint: string
          headers: Record<string, string>
          body: unknown
        }>
      }

      try {
        const preview = await providerInstance.getRequestPreview(
          finalContent,
          effectiveModelId,
          modelConfig,
          temperature,
          maxTokens,
          mcpTools
        )

        // Redact sensitive information
        const { redactRequestPreview } = await import('@/lib/redact')
        const redacted = redactRequestPreview({
          headers: preview.headers,
          body: preview.body
        })

        return {
          providerId: effectiveProviderId,
          modelId: effectiveModelId,
          endpoint: preview.endpoint,
          headers: redacted.headers,
          body: redacted.body,
          mayNotMatch: true // Always mark as potentially inconsistent since we're reconstructing
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('not implemented')) {
          return {
            notImplemented: true,
            providerId: effectiveProviderId,
            modelId: effectiveModelId
          }
        }
        throw error
      }
    } catch (error) {
      console.error('[UtilityHandler] getMessageRequestPreview failed:', error)
      throw error
    }
  }

  /**
   * Applies variant selection to messages based on selectedVariantsMap.
   * Returns messages with selected variant fields applied when a variant is selected.
   */
  private applyVariantSelection(
    messages: Message[],
    selectedVariantsMap: Record<string, string>
  ): Message[] {
    return messages.map((msg) => {
      if (msg.role === 'assistant' && selectedVariantsMap[msg.id] && msg.variants) {
        const selectedVariantId = selectedVariantsMap[msg.id]
        const selectedVariant = msg.variants.find((v) => v.id === selectedVariantId)

        if (selectedVariant) {
          const newMsg = JSON.parse(JSON.stringify(msg))
          newMsg.content = selectedVariant.content
          newMsg.usage = selectedVariant.usage
          newMsg.model_id = selectedVariant.model_id
          newMsg.model_provider = selectedVariant.model_provider
          newMsg.model_name = selectedVariant.model_name
          return newMsg
        }
      }
      return msg
    })
  }
}
