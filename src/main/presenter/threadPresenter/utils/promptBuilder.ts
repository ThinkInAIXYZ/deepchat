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
import { buildUserMessageContext, getNormalizedUserMessageText } from './messageContent'
import { generateSearchPrompt } from '../managers/searchManager'
import { nanoid } from 'nanoid'

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
  searchResults,
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

  const isImageGeneration = modelType === ModelType.ImageGeneration
  const searchPrompt =
    !isImageGeneration && searchResults ? generateSearchPrompt(userContent, searchResults) : ''

  const enrichedUserMessage =
    !isImageGeneration && urlResults.length > 0
      ? '\n\n' + ContentEnricher.enrichUserMessageWithUrlContent(userContent, urlResults)
      : ''

  const finalSystemPrompt = enhanceSystemPromptWithDateTime(systemPrompt, isImageGeneration)

  const searchPromptTokens = searchPrompt ? approximateTokenSize(searchPrompt) : 0
  const systemPromptTokens =
    !isImageGeneration && finalSystemPrompt ? approximateTokenSize(finalSystemPrompt) : 0
  const userMessageTokens = approximateTokenSize(userContent + enrichedUserMessage)

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
  const mcpToolsTokens = mcpTools.reduce(
    (acc, tool) => acc + approximateTokenSize(JSON.stringify(tool)),
    0
  )

  const reservedTokens =
    searchPromptTokens + systemPromptTokens + userMessageTokens + mcpToolsTokens
  const remainingContextLength = contextLength - reservedTokens

  const selectedContextMessages = selectContextMessages(
    contextMessages,
    userMessage,
    remainingContextLength
  )

  const formattedMessages = formatMessagesForCompletion(
    selectedContextMessages,
    isImageGeneration ? '' : finalSystemPrompt,
    artifacts,
    searchPrompt,
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

function selectContextMessages(
  contextMessages: Message[],
  userMessage: Message,
  remainingContextLength: number
): Message[] {
  if (remainingContextLength <= 0) {
    return []
  }

  const messages = contextMessages.filter((msg) => msg.id !== userMessage?.id).reverse()

  let currentLength = 0
  const selectedMessages: Message[] = []

  for (const msg of messages) {
    if (msg.status !== 'sent') {
      continue
    }

    const msgContent = msg.role === 'user' ? (msg.content as UserMessageContent) : null
    const msgTokens = approximateTokenSize(
      msgContent ? getNormalizedUserMessageText(msgContent) : JSON.stringify(msg.content)
    )

    if (currentLength + msgTokens <= remainingContextLength) {
      selectedMessages.unshift(msg)
      currentLength += msgTokens
    } else {
      break
    }
  }

  while (selectedMessages.length > 0 && selectedMessages[0].role !== 'user') {
    selectedMessages.shift()
  }

  return selectedMessages
}

function formatMessagesForCompletion(
  contextMessages: Message[],
  systemPrompt: string,
  artifacts: number,
  searchPrompt: string,
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

  let finalContent = searchPrompt || userContent
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
        const normalizedText = getNormalizedUserMessageText(msgContent)
        if (vision && msgContent.images && msgContent.images.length > 0) {
          resultMessages.push({
            role: 'user',
            content: [
              ...msgContent.images.map((image) => ({
                type: 'image_url' as const,
                image_url: { url: image, detail: 'auto' as const }
              })),
              { type: 'text' as const, text: normalizedText }
            ]
          })
        } else {
          resultMessages.push({
            role: 'user',
            content: normalizedText
          })
        }
      } else if (msg.role === 'assistant') {
        const content = msg.content as AssistantMessageBlock[]
        const messageContent: ChatMessageContent[] = []
        const toolCalls: ChatMessage['tool_calls'] = []
        const toolResponses: { id: string; response: string }[] = []

        content.forEach((block) => {
          if (block.type === 'tool_call' && block.tool_call) {
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
            if (block.tool_call.response) {
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
          resultMessages.push({
            role: 'assistant',
            content: messageContent.length > 0 ? messageContent : undefined,
            tool_calls: toolCalls
          })

          // Add separate role:tool messages for each tool response
          toolResponses.forEach((toolResp) => {
            resultMessages.push({
              role: 'tool',
              content: toolResp.response,
              tool_call_id: toolResp.id
            })
          })
        } else if (messageContent.length > 0) {
          resultMessages.push({
            role: 'assistant',
            content: messageContent
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

  contextMessages.forEach((msg) => {
    if (msg.role === 'user') {
      const msgContent = msg.content as VisionUserMessageContent
      const normalizedText = getNormalizedUserMessageText(msgContent)
      if (vision && msgContent.images && msgContent.images.length > 0) {
        resultMessages.push({
          role: 'user',
          content: [
            ...msgContent.images.map((image) => ({
              type: 'image_url' as const,
              image_url: { url: image, detail: 'auto' as const }
            })),
            { type: 'text' as const, text: normalizedText }
          ]
        })
      } else {
        resultMessages.push({
          role: 'user',
          content: normalizedText
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
      if (currentMessage.role === 'assistant') {
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

  return `${systemPrompt}\nToday's date and time is ${currentDateTime}`
}
