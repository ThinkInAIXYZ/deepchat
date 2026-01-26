import type {
  ChatMessage,
  CONVERSATION,
  CONVERSATION_SETTINGS,
  LLMAgentEventData,
  MCPToolDefinition,
  MESSAGE_METADATA
} from '@shared/presenter'
import type { AssistantMessageBlock, UserMessageContent } from '@shared/chat'
import { ModelType } from '@shared/model'
import { presenter } from '@/presenter'
import { BaseHandler, type ThreadHandlerContext } from '../baseHandler'
import { buildUserMessageContext } from '../message/messageFormatter'
import {
  buildConversationExportContent,
  generateExportFilename,
  type ConversationExportFormat
} from '../../exporter/formats/conversationExporter'
import { preparePromptContent } from '../message/messageBuilder'
import type { StreamGenerationHandler } from '../streaming/streamGenerationHandler'
import { getRuntimeConfig } from '../runtimeConfig'

// Translation constants
const TRANSLATION_TEMPERATURE = 0.3
const TRANSLATION_TIMEOUT_MS = 1000

// Message length constant for context calculation
const DEFAULT_MESSAGE_LENGTH = 300

export interface UtilityHandlerOptions {
  getActiveConversation: (tabId: number) => Promise<CONVERSATION | null>
  getActiveConversationId: (tabId: number) => Promise<string | null>
  getConversation: (conversationId: string) => Promise<CONVERSATION>
  createConversation: (
    title: string,
    settings: Partial<CONVERSATION_SETTINGS>,
    tabId: number
  ) => Promise<string>
  streamGenerationHandler: StreamGenerationHandler
}

export class UtilityHandler extends BaseHandler {
  private readonly getActiveConversation: (tabId: number) => Promise<CONVERSATION | null>
  private readonly getActiveConversationId: (tabId: number) => Promise<string | null>
  private readonly getConversation: (conversationId: string) => Promise<CONVERSATION>
  private readonly createConversation: (
    title: string,
    settings: Partial<CONVERSATION_SETTINGS>,
    tabId: number
  ) => Promise<string>
  private readonly streamGenerationHandler: StreamGenerationHandler

  constructor(context: ThreadHandlerContext, options: UtilityHandlerOptions) {
    super(context)
    this.getActiveConversation = options.getActiveConversation
    this.getActiveConversationId = options.getActiveConversationId
    this.getConversation = options.getConversation
    this.createConversation = options.createConversation
    this.streamGenerationHandler = options.streamGenerationHandler
  }

  async translateText(text: string, tabId: number): Promise<string> {
    try {
      let conversation = await this.getActiveConversation(tabId)
      if (!conversation) {
        // Create a temporary conversation for translation
        const defaultProvider = this.ctx.configPresenter.getDefaultProviders()[0]
        const models = await this.ctx.llmProviderPresenter.getModelList(defaultProvider.id)
        const defaultModel = models[0]
        const conversationId = await this.createConversation(
          'Temporary translation conversation',
          {
            modelId: defaultModel.id,
            providerId: defaultProvider.id
          },
          tabId
        )
        conversation = await this.getConversation(conversationId)
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
      let conversation = await this.getActiveConversation(tabId)
      if (!conversation) {
        // Create a temporary conversation for AI query
        const defaultProvider = this.ctx.configPresenter.getDefaultProviders()[0]
        const models = await this.ctx.llmProviderPresenter.getModelList(defaultProvider.id)
        const defaultModel = models[0]
        const conversationId = await this.createConversation(
          '临时AI对话',
          {
            modelId: defaultModel.id,
            providerId: defaultProvider.id
          },
          tabId
        )
        conversation = await this.getConversation(conversationId)
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
      const conversation = await this.getConversation(conversationId)
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

      // Phase 6: Variant management removed - use messages directly
      // Generate filename
      const filename = generateExportFilename(format)
      const content = await buildConversationExportContent(conversation, validMessages, format)

      return { filename, content }
    } catch (error) {
      console.error('Failed to export conversation:', error)
      throw error
    }
  }

  async summaryTitles(tabId?: number, conversationId?: string): Promise<string> {
    const activeId = tabId !== undefined ? await this.getActiveConversationId(tabId) : null
    const targetConversationId = conversationId ?? activeId ?? undefined
    if (!targetConversationId) {
      throw new Error('Conversation not found')
    }
    const conversation = await this.getConversation(targetConversationId)
    if (!conversation) {
      throw new Error('Conversation not found')
    }
    const { providerId, modelId } = conversation.settings

    // Phase 6: Get context length from runtime config
    const runtimeConfig = await getRuntimeConfig(conversation)
    let messageCount = Math.ceil(runtimeConfig.contextLength / DEFAULT_MESSAGE_LENGTH)
    if (messageCount < 2) {
      messageCount = 2
    }
    const messages = await this.ctx.messageManager.getContextMessages(conversation.id, messageCount)

    // Phase 6: Variant management removed - use messages directly
    const messagesWithLength = messages
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
      providerId,
      modelId
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
      // Phase 6: Get runtime config instead of reading from settings
      const runtimeConfig = await getRuntimeConfig(conversation)
      const {
        providerId: defaultProviderId,
        modelId: defaultModelId,
        temperature,
        maxTokens,
        enabledMcpTools
      } = runtimeConfig

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
      // Phase 6: Use context length from runtime config
      const contextMessages = await this.streamGenerationHandler.getMessageHistory(
        userMessage.id,
        runtimeConfig.contextLength
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
      const provider =
        this.ctx.llmProviderPresenter.getProviderInstance?.(effectiveProviderId) ?? null
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
}
// Phase 6: applyVariantSelection method removed - variant management feature removed
