import { approximateTokenSize } from 'tokenx'
import { presenter } from '@/presenter'
import { AssistantMessage, Message, MessageFile, UserMessageContent } from '@shared/chat'
import { ModelType } from '@shared/model'
import { CONVERSATION, ModelConfig, SearchResult, ChatMessage } from '@shared/presenter'
import type { MCPToolDefinition } from '@shared/presenter'

// TODO: ContentEnricher is a shared utility from threadPresenter
// Consider moving to a shared location in future refactoring
import { ContentEnricher } from '../../threadPresenter/utils/contentEnricher'
import { BrowserContextBuilder } from '../../browser/BrowserContextBuilder'
import { modelCapabilities } from '../../configPresenter/modelCapabilities'
import { enhanceSystemPromptWithDateTime } from '../utility/promptEnhancer'
import { ToolCallCenter } from '../tool/toolCallCenter'
import {
  addContextMessages,
  buildUserMessageContext,
  formatMessagesForCompletion,
  mergeConsecutiveMessages
} from './messageFormatter'
import { selectContextMessages } from './messageTruncator'

export type PendingToolCall = {
  id: string
  name: string
  params: string
  serverName?: string
  serverIcons?: string
  serverDescription?: string
}

export interface PreparePromptContentParams {
  conversation: CONVERSATION
  userContent: string
  contextMessages: Message[]
  searchResults: SearchResult[] | null
  urlResults: SearchResult[]
  userMessage: Message
  vision: boolean
  imageFiles: MessageFile[]
  supportsFunctionCall: boolean
  modelType?: ModelType
}

export interface ContinueToolCallContextParams {
  conversation: CONVERSATION
  contextMessages: Message[]
  userMessage: Message
  pendingToolCall: PendingToolCall
  modelConfig: ModelConfig
}

export interface PostToolExecutionContextParams {
  conversation: CONVERSATION
  contextMessages: Message[]
  userMessage: Message
  currentAssistantMessage: AssistantMessage
  completedToolCall: PendingToolCall & { response: string }
  modelConfig: ModelConfig
}

export async function preparePromptContent({
  conversation,
  userContent,
  contextMessages,
  searchResults: _searchResults,
  urlResults,
  userMessage,
  vision,
  imageFiles,
  supportsFunctionCall,
  modelType
}: PreparePromptContentParams): Promise<{
  finalContent: ChatMessage[]
  promptTokens: number
}> {
  const { systemPrompt, contextLength, artifacts, enabledMcpTools } = conversation.settings
  const chatMode: 'chat' | 'agent' | 'acp agent' =
    conversation.settings.chatMode ??
    ((await presenter.configPresenter.getSetting('input_chatMode')) as
      | 'chat'
      | 'agent'
      | 'acp agent') ??
    'chat'
  const isAgentMode = chatMode === 'agent'

  const isImageGeneration = modelType === ModelType.ImageGeneration
  const enrichedUserMessage =
    !isImageGeneration && urlResults.length > 0
      ? '\n\n' + ContentEnricher.enrichUserMessageWithUrlContent(userContent, urlResults)
      : ''

  const finalSystemPrompt = enhanceSystemPromptWithDateTime(systemPrompt, isImageGeneration)
  const agentWorkspacePath = conversation.settings.agentWorkspacePath?.trim() || null
  const finalSystemPromptWithWorkspace =
    isAgentMode && agentWorkspacePath
      ? finalSystemPrompt
        ? `${finalSystemPrompt}\n\nCurrent working directory: ${agentWorkspacePath}`
        : `Current working directory: ${agentWorkspacePath}`
      : finalSystemPrompt

  let browserContextPrompt = ''
  const { providerId, modelId } = conversation.settings
  const supportsVision = modelCapabilities.supportsVision(providerId, modelId)
  let toolDefinitions: MCPToolDefinition[] = []

  if (!isImageGeneration) {
    const toolCallCenter = new ToolCallCenter(presenter.toolPresenter)
    try {
      toolDefinitions = await toolCallCenter.getAllToolDefinitions({
        enabledMcpTools,
        chatMode,
        supportsVision,
        agentWorkspacePath
      })
    } catch (error) {
      console.warn('AgentPresenter: Failed to load tool definitions', error)
      toolDefinitions = []
    }
  }

  if (!isImageGeneration && isAgentMode) {
    try {
      const browserContext = await presenter.yoBrowserPresenter.getBrowserContext()
      browserContextPrompt = BrowserContextBuilder.buildSystemPrompt(
        browserContext.tabs,
        browserContext.activeTabId
      )
    } catch (error) {
      console.warn('AgentPresenter: Failed to load Yo Browser context/tools', error)
    }
  }

  const finalSystemPromptWithBrowser = browserContextPrompt
    ? finalSystemPromptWithWorkspace
      ? `${finalSystemPromptWithWorkspace}\n${browserContextPrompt}`
      : browserContextPrompt
    : finalSystemPromptWithWorkspace

  const systemPromptTokens =
    !isImageGeneration && finalSystemPromptWithBrowser
      ? approximateTokenSize(finalSystemPromptWithBrowser)
      : 0
  const userMessageTokens = approximateTokenSize(userContent + enrichedUserMessage)
  const toolDefinitionsTokens = toolDefinitions.reduce((acc, tool) => {
    return acc + approximateTokenSize(JSON.stringify(tool))
  }, 0)

  const reservedTokens = systemPromptTokens + userMessageTokens + toolDefinitionsTokens
  const remainingContextLength = contextLength - reservedTokens

  const selectedContextMessages = selectContextMessages(
    contextMessages,
    userMessage,
    remainingContextLength,
    supportsFunctionCall,
    vision
  )

  const formattedMessages = formatMessagesForCompletion(
    selectedContextMessages,
    isImageGeneration ? '' : finalSystemPromptWithBrowser,
    artifacts,
    userContent,
    enrichedUserMessage,
    imageFiles,
    vision,
    supportsFunctionCall
  )

  const mergedMessages = mergeConsecutiveMessages(formattedMessages)

  let promptTokens = 0
  const imageTokenCost = imageFiles.reduce((acc, file) => acc + (file.token ?? 0), 0)
  for (let i = 0; i < mergedMessages.length; i++) {
    const msg = mergedMessages[i]

    if (typeof msg.content === 'string' || msg.content === undefined) {
      promptTokens += approximateTokenSize(msg.content || '')
      continue
    }

    const textContent =
      msg.content?.reduce((acc, item) => {
        if (item.type === 'text' && typeof item.text === 'string') {
          return acc + item.text
        }
        return acc
      }, '') ?? ''

    promptTokens += approximateTokenSize(textContent)

    const isFinalUserWithImages =
      i === mergedMessages.length - 1 &&
      msg.role === 'user' &&
      Array.isArray(msg.content) &&
      msg.content.some((block) => block.type === 'image_url')

    if (isFinalUserWithImages && imageTokenCost > 0) {
      promptTokens += imageTokenCost
    }
  }

  return { finalContent: mergedMessages, promptTokens }
}

export async function buildContinueToolCallContext({
  conversation,
  contextMessages,
  userMessage,
  pendingToolCall,
  modelConfig
}: ContinueToolCallContextParams): Promise<ChatMessage[]> {
  const { systemPrompt } = conversation.settings
  const formattedMessages: ChatMessage[] = []

  if (systemPrompt) {
    const finalSystemPrompt = enhanceSystemPromptWithDateTime(systemPrompt)
    formattedMessages.push({
      role: 'system',
      content: finalSystemPrompt
    })
  }

  const contextChatMessages = addContextMessages(contextMessages, false, modelConfig.functionCall)
  formattedMessages.push(...contextChatMessages)

  const userContent = userMessage.content as UserMessageContent
  const finalUserContent = buildUserMessageContext(userContent)

  formattedMessages.push({
    role: 'user',
    content: `${finalUserContent}\n\nTool call interrupted: ${pendingToolCall.name}`
  })

  return formattedMessages
}

export async function buildPostToolExecutionContext({
  conversation,
  contextMessages,
  userMessage,
  currentAssistantMessage,
  completedToolCall,
  modelConfig
}: PostToolExecutionContextParams): Promise<ChatMessage[]> {
  const { systemPrompt } = conversation.settings
  const formattedMessages: ChatMessage[] = []

  if (systemPrompt) {
    const finalSystemPrompt = enhanceSystemPromptWithDateTime(systemPrompt)
    formattedMessages.push({
      role: 'system',
      content: finalSystemPrompt
    })
  }

  const contextChatMessages = addContextMessages(contextMessages, false, modelConfig.functionCall)
  formattedMessages.push(...contextChatMessages)

  const userContent = userMessage.content as UserMessageContent
  const finalUserContent = buildUserMessageContext(userContent)

  formattedMessages.push({
    role: 'user',
    content: finalUserContent
  })

  formattedMessages.push({
    role: 'assistant',
    content: currentAssistantMessage.content
      .filter((block) => block.type === 'content')
      .map((block) => block.content || '')
      .join('\n')
  })

  formattedMessages.push({
    role: 'tool',
    content: completedToolCall.response,
    tool_call_id: completedToolCall.id
  })

  return formattedMessages
}
