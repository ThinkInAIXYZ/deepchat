import { approximateTokenSize } from 'tokenx'
import { presenter } from '@/presenter'
import {
  AssistantMessage,
  AssistantMessageBlock,
  Message,
  MessageFile,
  UserMessageContent
} from '@shared/chat'
import { ModelType } from '@shared/model'
import {
  CONVERSATION,
  ModelConfig,
  SearchResult,
  ChatMessage,
  ChatMessageContent
} from '@shared/presenter'
import type { MCPToolDefinition } from '@shared/presenter'
import { ContentEnricher } from './contentEnricher'
import { buildUserMessageContext } from './messageContent'
import { nanoid } from 'nanoid'
import { BrowserContextBuilder } from '../../browser/BrowserContextBuilder'
import { modelCapabilities } from '../../configPresenter/modelCapabilities'

export type PendingToolCall = {
  id: string
  name: string
  params: string
  serverName?: string
  serverIcons?: string
  serverDescription?: string
}
type VisionUserMessageContent = UserMessageContent & { images?: string[] }

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
  const chatMode =
    ((await presenter.configPresenter.getSetting('input_chatMode')) as
      | 'chat'
      | 'agent'
      | 'acp agent') || 'chat'
  const isAgentMode = chatMode === 'agent'

  const isImageGeneration = modelType === ModelType.ImageGeneration
  const enrichedUserMessage =
    !isImageGeneration && urlResults.length > 0
      ? '\n\n' + ContentEnricher.enrichUserMessageWithUrlContent(userContent, urlResults)
      : ''

  const finalSystemPrompt = enhanceSystemPromptWithDateTime(systemPrompt, isImageGeneration)
  const agentWorkspacePath = conversation.settings.agentWorkspacePath?.trim()
  const finalSystemPromptWithWorkspace =
    isAgentMode && agentWorkspacePath
      ? finalSystemPrompt
        ? `${finalSystemPrompt}\n\nCurrent working directory: ${agentWorkspacePath}`
        : `Current working directory: ${agentWorkspacePath}`
      : finalSystemPrompt

  let mcpTools: MCPToolDefinition[] = []
  if (!isImageGeneration) {
    try {
      const toolDefinitions = await presenter.mcpPresenter.getAllToolDefinitions(enabledMcpTools)
      if (Array.isArray(toolDefinitions)) {
        mcpTools = toolDefinitions
      }
    } catch (error) {
      console.warn('ThreadPresenter: Failed to load MCP tool definitions', error)
      mcpTools = []
    }
  }

  let browserContextPrompt = ''
  const { providerId, modelId } = conversation.settings
  if (!isImageGeneration && isAgentMode) {
    try {
      const supportsVision = modelCapabilities.supportsVision(providerId, modelId)
      const browserTools = await presenter.yoBrowserPresenter.getToolDefinitions(supportsVision)
      // console.log('browserTools', browserTools)
      mcpTools = [...mcpTools, ...browserTools]
      const browserContext = await presenter.yoBrowserPresenter.getBrowserContext()
      browserContextPrompt = BrowserContextBuilder.buildSystemPrompt(
        browserContext.tabs,
        browserContext.activeTabId
      )
    } catch (error) {
      console.warn('ThreadPresenter: Failed to load Yo Browser context/tools', error)
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
  const mcpToolsTokens = mcpTools.reduce((acc, tool) => {
    return acc + approximateTokenSize(JSON.stringify(tool))
  }, 0)

  const reservedTokens = systemPromptTokens + userMessageTokens + mcpToolsTokens
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
    content: finalUserContent
  })

  if (modelConfig.functionCall) {
    formattedMessages.push({
      role: 'assistant',
      tool_calls: [
        {
          id: pendingToolCall.id,
          type: 'function',
          function: {
            name: pendingToolCall.name,
            arguments: pendingToolCall.params
          }
        }
      ]
    })

    formattedMessages.push({
      role: 'user',
      content: `Permission granted to call ${pendingToolCall.name}. Proceed with execution.`
    })
  } else {
    formattedMessages.push({
      role: 'assistant',
      content: `I need to call the ${pendingToolCall.name} function with the following parameters: ${pendingToolCall.params}`
    })

    formattedMessages.push({
      role: 'user',
      content: `Permission has been granted for the ${pendingToolCall.name} function. Please proceed with the execution.`
    })
  }

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

  const assistantPreface = collectAssistantTextBeforePermission(currentAssistantMessage?.content)
  if (assistantPreface.trim().length > 0) {
    formattedMessages.push({
      role: 'assistant',
      content: assistantPreface
    })
  }

  if (modelConfig.functionCall) {
    formattedMessages.push({
      role: 'assistant',
      tool_calls: [
        {
          id: completedToolCall.id,
          type: 'function',
          function: {
            name: completedToolCall.name,
            arguments: completedToolCall.params
          }
        }
      ]
    })

    formattedMessages.push({
      role: 'tool',
      tool_call_id: completedToolCall.id,
      content: completedToolCall.response
    })
  } else {
    const formattedRecord = `<function_call>${JSON.stringify({
      function_call_record: {
        name: completedToolCall.name,
        arguments: completedToolCall.params,
        response: completedToolCall.response
      }
    })}</function_call>`

    formattedMessages.push({
      role: 'assistant',
      content: formattedRecord + '\n'
    })

    const userPromptText =
      '以上是你刚执行的工具调用及其响应信息，已帮你插入，请仔细阅读工具响应，并继续你的回答。'
    formattedMessages.push({
      role: 'user',
      content: [{ type: 'text', text: userPromptText }]
    })
  }

  return formattedMessages
}

function collectAssistantTextBeforePermission(blocks: AssistantMessageBlock[] | undefined): string {
  if (!blocks?.length) {
    return ''
  }

  const parts: string[] = []

  for (const block of blocks) {
    if (block.type === 'action' && block.action_type === 'tool_call_permission') {
      break
    }

    if (block.type === 'content' && typeof block.content === 'string') {
      parts.push(block.content)
    }

    if (block.type === 'reasoning_content' && typeof block.content === 'string') {
      parts.push(block.content)
    }
  }

  return parts.join('')
}

function calculateToolCallTokens(toolCall: NonNullable<ChatMessage['tool_calls']>[number]): number {
  const nameTokens = approximateTokenSize(toolCall.function?.name || '')
  const argumentsTokens = approximateTokenSize(toolCall.function?.arguments || '')
  return nameTokens + argumentsTokens
}

function calculateMessageTokens(message: ChatMessage): number {
  let tokens = 0

  if (typeof message.content === 'string') {
    tokens += approximateTokenSize(message.content)
  } else if (Array.isArray(message.content)) {
    const textContent = message.content.reduce((acc, item) => {
      if (item.type === 'text' && typeof item.text === 'string') {
        return acc + item.text
      }
      return acc
    }, '')
    tokens += approximateTokenSize(textContent)
  }

  if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
    message.tool_calls.forEach((toolCall) => {
      tokens += calculateToolCallTokens(toolCall)
    })
  }

  return tokens
}

function calculateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((acc, message) => acc + calculateMessageTokens(message), 0)
}

function calculateToolCallBlockTokens(block: AssistantMessageBlock): number {
  if (block.type !== 'tool_call' || !block.tool_call?.response) {
    return 0
  }

  const nameTokens = approximateTokenSize(block.tool_call.name || '')
  const paramsTokens = approximateTokenSize(block.tool_call.params || '')
  const responseTokens = approximateTokenSize(block.tool_call.response || '')

  return nameTokens + paramsTokens + responseTokens
}

function cloneMessageWithContent(message: Message): Message {
  const cloned: Message = { ...message }

  if (Array.isArray(message.content)) {
    cloned.content = message.content.map((block) => {
      const clonedBlock: AssistantMessageBlock = { ...(block as AssistantMessageBlock) }
      if (block.type === 'tool_call' && block.tool_call) {
        clonedBlock.tool_call = { ...block.tool_call }
      }
      return clonedBlock
    })
  } else if (message.content && typeof message.content === 'object') {
    cloned.content = JSON.parse(JSON.stringify(message.content))
  } else {
    cloned.content = message.content
  }

  return cloned
}

function removeToolCallsFromAssistant(message: Message): {
  updatedMessage: Message
  removedTokens: number
  removedToolCalls: number
} {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) {
    return { updatedMessage: message, removedTokens: 0, removedToolCalls: 0 }
  }

  const clonedMessage = cloneMessageWithContent(message)
  const clonedContent = clonedMessage.content as AssistantMessageBlock[]

  let removedTokens = 0
  let removedToolCalls = 0

  const filteredBlocks = clonedContent.filter((block) => {
    if (block.type !== 'tool_call' || !block.tool_call) {
      return true
    }

    removedTokens += calculateToolCallBlockTokens(block)
    removedToolCalls += 1
    return false
  })

  clonedMessage.content = filteredBlocks

  return { updatedMessage: clonedMessage, removedTokens, removedToolCalls }
}

function compressToolCallsFromContext(
  messages: Message[],
  excessTokens: number,
  supportsFunctionCall: boolean
): { compressedMessages: Message[]; removedTokens: number } {
  if (!supportsFunctionCall || excessTokens <= 0) {
    return { compressedMessages: messages, removedTokens: 0 }
  }

  const lastUserIndex = messages.findLastIndex((message) => message.role === 'user')
  let removedTokens = 0

  for (let i = 0; i < messages.length; i++) {
    if (lastUserIndex !== -1 && i >= lastUserIndex) {
      break
    }

    const message = messages[i]
    if (message.role !== 'assistant') {
      continue
    }

    const {
      updatedMessage,
      removedTokens: toolCallTokens,
      removedToolCalls
    } = removeToolCallsFromAssistant(message)

    if (removedToolCalls > 0) {
      messages[i] = updatedMessage
      console.debug(
        `PromptBuilder: removed ${removedToolCalls} tool call block(s) (${toolCallTokens} tokens) from context`
      )
    }

    removedTokens += toolCallTokens

    if (removedTokens >= excessTokens) {
      break
    }
  }

  return { compressedMessages: messages, removedTokens }
}

export function selectContextMessages(
  contextMessages: Message[],
  userMessage: Message,
  remainingContextLength: number,
  supportsFunctionCall: boolean,
  vision: boolean
): Message[] {
  if (remainingContextLength <= 0) {
    return []
  }

  const messages = contextMessages
    .filter((msg) => msg.id !== userMessage?.id)
    .map((msg) => cloneMessageWithContent(msg))
    .reverse()
  let selectedMessages = messages.filter((msg) => msg.status === 'sent')

  if (selectedMessages.length === 0) {
    return []
  }

  let chatMessages = addContextMessages(selectedMessages, vision, supportsFunctionCall)
  let totalTokens = calculateMessagesTokens(chatMessages)
  console.log('totalTokens', totalTokens, 'remainingContextLength', remainingContextLength)
  if (totalTokens > remainingContextLength) {
    let excessTokens = totalTokens - remainingContextLength

    if (supportsFunctionCall) {
      const { removedTokens } = compressToolCallsFromContext(
        selectedMessages,
        excessTokens,
        supportsFunctionCall
      )

      totalTokens = Math.max(0, totalTokens - removedTokens)
      chatMessages = addContextMessages(selectedMessages, vision, supportsFunctionCall)
      totalTokens = calculateMessagesTokens(chatMessages)
    }

    if (totalTokens > remainingContextLength) {
      excessTokens = totalTokens - remainingContextLength
      let removedTokens = 0

      while (removedTokens < excessTokens && selectedMessages.length > 0) {
        const userIndex = selectedMessages.findIndex((msg) => msg.role === 'user')
        if (userIndex === -1) {
          break
        }

        const lastUserIndex = selectedMessages.findLastIndex((msg) => msg.role === 'user')
        if (userIndex === lastUserIndex) {
          break
        }

        const userMsg = selectedMessages[userIndex]
        // Find the assistant message that corresponds to this user message by parentId
        // Since messages are reversed (newest first), the assistant might be before or after the user
        // Prefer non-variant messages (is_variant = 0) if multiple assistants match
        const matchingAssistants = selectedMessages
          .map((msg, idx) => ({ msg, idx }))
          .filter(({ msg }) => msg.role === 'assistant' && msg.parentId === userMsg.id)
          .sort((a, b) => a.msg.is_variant - b.msg.is_variant) // Non-variant (0) comes first

        if (matchingAssistants.length === 0) {
          // If no matching assistant found, remove the user message alone
          selectedMessages.splice(userIndex, 1)
          continue
        }

        const assistantIndex = matchingAssistants[0].idx

        // Determine the range to remove: from min(userIndex, assistantIndex) to max(userIndex, assistantIndex) + 1
        const startIndex = Math.min(userIndex, assistantIndex)
        const endIndex = Math.max(userIndex, assistantIndex)

        const pairMessages = selectedMessages.slice(startIndex, endIndex + 1)
        const pairTokens = calculateMessagesTokens(
          addContextMessages(pairMessages, vision, supportsFunctionCall)
        )

        console.log(
          `PromptBuilder: removing one user/assistant pair from context (${pairTokens} tokens)`
        )

        selectedMessages.splice(startIndex, endIndex - startIndex + 1)
        removedTokens += pairTokens
        totalTokens = Math.max(0, totalTokens - pairTokens)
      }
    }

    chatMessages = addContextMessages(selectedMessages, vision, supportsFunctionCall)
    totalTokens = calculateMessagesTokens(chatMessages)
  }

  // Remove orphaned assistant messages (assistants without a corresponding user message)
  // Since messages are reversed (newest first), we need to check if each assistant has a user
  // that appears later in the list (earlier in chronological order)
  const userIds = new Set(
    selectedMessages.filter((msg) => msg.role === 'user').map((msg) => msg.id)
  )
  selectedMessages = selectedMessages.filter((msg) => {
    if (msg.role === 'assistant') {
      // Keep assistant only if its parentId corresponds to a user in the list
      return msg.parentId && userIds.has(msg.parentId)
    }
    return true
  })

  // Reverse back to chronological order for downstream consumers
  return selectedMessages.reverse()
}

function formatMessagesForCompletion(
  contextMessages: Message[],
  systemPrompt: string,
  artifacts: number,
  userContent: string,
  enrichedUserMessage: string,
  imageFiles: MessageFile[],
  vision: boolean,
  supportsFunctionCall: boolean
): ChatMessage[] {
  const formattedMessages: ChatMessage[] = []

  formattedMessages.push(...addContextMessages(contextMessages, vision, supportsFunctionCall))

  if (systemPrompt) {
    formattedMessages.unshift({
      role: 'system',
      content: systemPrompt
    })
  }

  let finalContent = userContent
  if (enrichedUserMessage) {
    finalContent += enrichedUserMessage
  }

  if (artifacts === 1) {
    console.debug('Artifacts are provided by MCP; this is a backward-compatibility placeholder')
  }

  if (vision && imageFiles.length > 0) {
    formattedMessages.push(addImageFiles(finalContent, imageFiles))
  } else {
    formattedMessages.push({
      role: 'user',
      content: finalContent.trim()
    })
  }

  return formattedMessages
}

function addImageFiles(finalContent: string, imageFiles: MessageFile[]): ChatMessage {
  return {
    role: 'user',
    content: [
      ...imageFiles.map((file) => ({
        type: 'image_url' as const,
        image_url: { url: file.content, detail: 'auto' as const }
      })),
      { type: 'text' as const, text: finalContent.trim() }
    ]
  }
}

function addContextMessages(
  contextMessages: Message[],
  vision: boolean,
  supportsFunctionCall: boolean
): ChatMessage[] {
  const resultMessages: ChatMessage[] = []

  if (supportsFunctionCall) {
    contextMessages.forEach((msg) => {
      if (msg.role === 'user') {
        const msgContent = msg.content as VisionUserMessageContent
        const finalUserContext = buildUserMessageContext(msgContent)
        if (vision && msgContent.images && msgContent.images.length > 0) {
          resultMessages.push({
            role: 'user',
            content: [
              ...msgContent.images.map((image) => ({
                type: 'image_url' as const,
                image_url: { url: image, detail: 'auto' as const }
              })),
              { type: 'text' as const, text: finalUserContext }
            ]
          })
        } else {
          resultMessages.push({
            role: 'user',
            content: finalUserContext
          })
        }
      } else if (msg.role === 'assistant') {
        const content = msg.content as AssistantMessageBlock[]
        const messageContent: ChatMessageContent[] = []
        const toolCalls: ChatMessage['tool_calls'] = []
        const toolResponses: { id: string; response: string }[] = []

        content.forEach((block) => {
          if (block.type === 'tool_call' && block.tool_call) {
            // Only add tool_call if it has a response (completed successfully)
            // This ensures that every tool_call in the message has a corresponding tool response
            if (block.tool_call.response) {
              let toolCallId = block.tool_call.id || nanoid(8)
              toolCalls.push({
                id: toolCallId,
                type: 'function',
                function: {
                  name: block.tool_call.name,
                  arguments: block.tool_call.params || ''
                }
              })
              // Store tool response separately to create role:tool messages
              toolResponses.push({
                id: toolCallId,
                response: block.tool_call.response
              })
            }
          } else if (block.type === 'content' && block.content) {
            messageContent.push({ type: 'text', text: block.content })
          }
        })

        // Add assistant message with tool_calls (without responses in content)
        if (toolCalls.length > 0) {
          const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: messageContent.length > 0 ? messageContent : undefined,
            tool_calls: toolCalls
          }
          resultMessages.push(assistantMessage)

          // Add separate role:tool messages for each tool response
          toolResponses.forEach((toolResp) => {
            resultMessages.push({
              role: 'tool',
              content: toolResp.response,
              tool_call_id: toolResp.id
            })
          })
        } else if (messageContent.length > 0) {
          const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: messageContent
          }
          resultMessages.push(assistantMessage)
        }
      } else {
        resultMessages.push({
          role: msg.role,
          content: JSON.stringify(msg.content)
        })
      }
    })

    return resultMessages
  }

  contextMessages.forEach((msg) => {
    if (msg.role === 'user') {
      const msgContent = msg.content as VisionUserMessageContent
      const finalUserContext = buildUserMessageContext(msgContent)
      if (vision && msgContent.images && msgContent.images.length > 0) {
        resultMessages.push({
          role: 'user',
          content: [
            ...msgContent.images.map((image) => ({
              type: 'image_url' as const,
              image_url: { url: image, detail: 'auto' as const }
            })),
            { type: 'text' as const, text: finalUserContext }
          ]
        })
      } else {
        resultMessages.push({
          role: 'user',
          content: finalUserContext
        })
      }
    } else if (msg.role === 'assistant') {
      const content = msg.content as AssistantMessageBlock[]
      const textContent = content
        .filter((block) => block.type === 'content' && block.content)
        .map((block) => block.content)
        .join('\n')

      if (textContent) {
        resultMessages.push({
          role: 'assistant',
          content: textContent
        })
      }
    } else {
      resultMessages.push({
        role: msg.role,
        content: JSON.stringify(msg.content)
      })
    }
  })

  return resultMessages
}

function mergeConsecutiveMessages(messages: ChatMessage[]): ChatMessage[] {
  if (!messages || messages.length === 0) {
    return []
  }

  const mergedResult: ChatMessage[] = []
  mergedResult.push(JSON.parse(JSON.stringify(messages[0])))

  for (let i = 1; i < messages.length; i++) {
    const currentMessage = JSON.parse(JSON.stringify(messages[i])) as ChatMessage
    const lastPushedMessage = mergedResult[mergedResult.length - 1]

    let allowMessagePropertiesMerge = false

    if (lastPushedMessage.role === currentMessage.role) {
      // Never merge tool messages - each tool message must correspond to a specific tool_call_id
      if (currentMessage.role === 'tool') {
        allowMessagePropertiesMerge = false
      } else if (currentMessage.role === 'assistant') {
        if (!lastPushedMessage.tool_calls && !currentMessage.tool_calls) {
          allowMessagePropertiesMerge = true
        }
      } else {
        allowMessagePropertiesMerge = true
      }
    }

    if (allowMessagePropertiesMerge) {
      const lastContent = lastPushedMessage.content
      const currentContent = currentMessage.content

      let newCombinedContent: string | ChatMessageContent[] | undefined = undefined
      let contentTypesCompatible = false

      if (lastContent === undefined && currentContent === undefined) {
        newCombinedContent = undefined
        contentTypesCompatible = true
      } else if (
        typeof lastContent === 'string' &&
        (typeof currentContent === 'string' || currentContent === undefined)
      ) {
        const previous = lastContent || ''
        const current = currentContent || ''
        if (previous && current) {
          newCombinedContent = `${previous}\n${current}`
        } else {
          newCombinedContent = previous || current
        }
        if (newCombinedContent === '') {
          newCombinedContent = undefined
        }
        contentTypesCompatible = true
      } else if (
        Array.isArray(lastContent) &&
        (Array.isArray(currentContent) || currentContent === undefined)
      ) {
        const prevArray = lastContent
        const currArray = currentContent || []
        newCombinedContent = [...prevArray, ...currArray]
        if (newCombinedContent.length === 0) {
          newCombinedContent = undefined
        }
        contentTypesCompatible = true
      } else if (lastContent === undefined && currentContent !== undefined) {
        newCombinedContent = currentContent
        contentTypesCompatible = true
      } else if (lastContent !== undefined && currentContent === undefined) {
        newCombinedContent = lastContent
        contentTypesCompatible = true
      }

      if (contentTypesCompatible) {
        lastPushedMessage.content = newCombinedContent
      } else {
        mergedResult.push(currentMessage)
      }
    } else {
      mergedResult.push(currentMessage)
    }
  }

  return mergedResult
}

function enhanceSystemPromptWithDateTime(
  systemPrompt: string,
  isImageGeneration: boolean = false
): string {
  if (isImageGeneration || !systemPrompt || !systemPrompt.trim()) {
    return systemPrompt
  }

  const currentDateTime = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    hour12: false
  })

  return `${systemPrompt}\nToday is ${currentDateTime}`
}
