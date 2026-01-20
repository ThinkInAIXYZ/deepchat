import { approximateTokenSize } from 'tokenx'
import { presenter } from '@/presenter'
import { AssistantMessage, Message, MessageFile, UserMessageContent } from '@shared/chat'
import { ModelType } from '@shared/model'
import { CONVERSATION, ModelConfig, SearchResult, ChatMessage } from '@shared/presenter'
import type { MCPToolDefinition } from '@shared/presenter'

import { modelCapabilities } from '../../configPresenter/modelCapabilities'
import { enhanceSystemPromptWithDateTime } from '../utility/promptEnhancer'
import { ToolCallCenter } from '../tool/toolCallCenter'
import { nanoid } from 'nanoid'

import {
  addContextMessages,
  buildUserMessageContext,
  formatMessagesForCompletion,
  mergeConsecutiveMessages
} from './messageFormatter'
import { BrowserContextBuilder } from '../../browser/BrowserContextBuilder'
import { selectContextMessages } from './messageTruncator'
import {
  buildSkillsMetadataPrompt,
  buildSkillsPrompt,
  getSkillsAllowedTools
} from './skillsPromptBuilder'

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

function mergeToolSelections(base?: string[], extra?: string[]): string[] | undefined {
  const merged = new Set<string>()
  base?.forEach((tool) => merged.add(tool))
  extra?.forEach((tool) => merged.add(tool))
  if (merged.size === 0) {
    return undefined
  }
  return Array.from(merged)
}

function appendPromptSection(base: string, section: string): string {
  const trimmedSection = section.trim()
  if (!trimmedSection) {
    return base
  }
  if (!base) {
    return trimmedSection
  }
  return `${base}\n\n${trimmedSection}`
}

export async function preparePromptContent({
  conversation,
  userContent,
  contextMessages,
  searchResults: _searchResults,
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
  const storedChatMode = (await presenter.configPresenter.getSetting('input_chatMode')) as
    | 'chat'
    | 'agent'
    | 'acp agent'
    | undefined
  const normalizedChatMode = storedChatMode === 'chat' ? 'agent' : storedChatMode
  const chatMode: 'agent' | 'acp agent' =
    conversation.settings.chatMode ?? normalizedChatMode ?? 'agent'
  const isAgentMode = chatMode === 'agent'
  const isToolPromptMode = chatMode === 'agent' || chatMode === 'acp agent'

  const isImageGeneration = modelType === ModelType.ImageGeneration

  const finalSystemPrompt = enhanceSystemPromptWithDateTime(systemPrompt, {
    isImageGeneration,
    isAgentMode,
    agentWorkspacePath: conversation.settings.agentWorkspacePath?.trim() || null
  })

  const { providerId, modelId } = conversation.settings
  const supportsVision = modelCapabilities.supportsVision(providerId, modelId)
  const toolCallCenter = new ToolCallCenter(presenter.toolPresenter)
  let toolDefinitions: MCPToolDefinition[] = []
  let effectiveEnabledMcpTools = enabledMcpTools

  if (!isImageGeneration && isAgentMode) {
    const skillsAllowedTools = await getSkillsAllowedTools(conversation.id)
    effectiveEnabledMcpTools = mergeToolSelections(enabledMcpTools, skillsAllowedTools)
  }

  if (!isImageGeneration) {
    try {
      toolDefinitions = await toolCallCenter.getAllToolDefinitions({
        enabledMcpTools: effectiveEnabledMcpTools,
        chatMode,
        supportsVision,
        agentWorkspacePath: conversation.settings.agentWorkspacePath?.trim() || null,
        conversationId: conversation.id
      })
    } catch (error) {
      console.warn('AgentPresenter: Failed to load tool definitions', error)
      toolDefinitions = []
    }
  }

  let finalSystemPromptWithExtras = finalSystemPrompt

  if (!isImageGeneration && isAgentMode) {
    try {
      const browserContext = await presenter.yoBrowserPresenter.getBrowserContext()
      const browserContextPrompt = BrowserContextBuilder.buildSystemPrompt(
        browserContext.tabs,
        browserContext.activeTabId
      )
      finalSystemPromptWithExtras = appendPromptSection(
        finalSystemPromptWithExtras,
        browserContextPrompt
      )
    } catch (error) {
      console.warn('AgentPresenter: Failed to load Yo Browser context/tools', error)
    }
  }

  if (!isImageGeneration && isToolPromptMode && toolDefinitions.length > 0) {
    const toolPrompt = toolCallCenter.buildToolSystemPrompt({
      conversationId: conversation.id
    })
    finalSystemPromptWithExtras = appendPromptSection(finalSystemPromptWithExtras, toolPrompt)
  }

  if (!isImageGeneration && isAgentMode) {
    try {
      const skillsMetadataPrompt = await buildSkillsMetadataPrompt()
      finalSystemPromptWithExtras = appendPromptSection(
        finalSystemPromptWithExtras,
        skillsMetadataPrompt
      )

      const skillsPrompt = await buildSkillsPrompt(conversation.id)
      finalSystemPromptWithExtras = appendPromptSection(finalSystemPromptWithExtras, skillsPrompt)
    } catch (error) {
      console.warn('AgentPresenter: Failed to build skills prompt', error)
    }
  }

  const systemPromptTokens =
    !isImageGeneration && finalSystemPromptWithExtras
      ? approximateTokenSize(finalSystemPromptWithExtras)
      : 0
  const userMessageTokens = approximateTokenSize(userContent)
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
    isImageGeneration ? '' : finalSystemPromptWithExtras,
    artifacts,
    userContent,
    '',
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
    const finalSystemPrompt = enhanceSystemPromptWithDateTime(systemPrompt, {})
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
  const supportsFunctionCall = Boolean(modelConfig?.functionCall)

  if (systemPrompt) {
    const finalSystemPrompt = enhanceSystemPromptWithDateTime(systemPrompt, {})
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

  const assistantText = currentAssistantMessage.content
    .filter((block) => block.type === 'content')
    .map((block) => block.content || '')
    .join('\n')
    .trim()

  // OpenAI-compatible function-calling requires:
  // assistant(tool_calls: [...]) -> tool(tool_call_id=...) pairing.
  if (supportsFunctionCall) {
    const toolCallId = completedToolCall.id || nanoid(8)
    formattedMessages.push({
      role: 'assistant',
      content: assistantText || undefined,
      tool_calls: [
        {
          id: toolCallId,
          type: 'function',
          function: {
            name: completedToolCall.name,
            arguments: completedToolCall.params || ''
          }
        }
      ]
    })

    formattedMessages.push({
      role: 'tool',
      content: completedToolCall.response,
      tool_call_id: toolCallId
    })
  } else {
    const formattedToolRecordText =
      '<function_call>' +
      JSON.stringify({
        function_call_record: {
          name: completedToolCall.name,
          arguments: completedToolCall.params,
          response: completedToolCall.response
        }
      }) +
      '</function_call>'

    const combinedText = [assistantText, formattedToolRecordText].filter(Boolean).join('\n')
    formattedMessages.push({
      role: 'assistant',
      content: combinedText || undefined
    })

    const userPromptText =
      '以上是你刚执行的工具调用及其响应信息，已帮你插入，请仔细阅读工具响应，并继续你的回答。'
    formattedMessages.push({
      role: 'user',
      content: userPromptText
    })
  }

  return formattedMessages
}
