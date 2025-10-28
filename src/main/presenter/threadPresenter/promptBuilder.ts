import { approximateTokenSize } from 'tokenx'
import { presenter } from '@/presenter'
import { AssistantMessageBlock, Message, MessageFile, UserMessageContent } from '@shared/chat'
import { ModelType } from '@shared/model'
import {
  CONVERSATION,
  ModelConfig,
  SearchResult,
  ChatMessage,
  ChatMessageContent
} from '../../../shared/presenter'
import { ContentEnricher } from './contentEnricher'
import { buildUserMessageContext, getNormalizedUserMessageText } from './messageContent'
import { generateSearchPrompt } from './searchManager'

type PendingToolCall = { id: string; name: string; params: string }
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

  const mcpTools = !isImageGeneration
    ? await presenter.mcpPresenter.getAllToolDefinitions(enabledMcpTools)
    : []
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
  for (const msg of mergedMessages) {
    if (typeof msg.content === 'string') {
      promptTokens += approximateTokenSize(msg.content)
    } else {
      const textContent = msg.content?.map((item) => item.text).join('') || ''
      promptTokens +=
        approximateTokenSize(textContent) + imageFiles.reduce((acc, file) => acc + file.token, 0)
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
      role: 'tool',
      tool_call_id: pendingToolCall.id,
      content: `Permission granted. Please proceed with executing the ${pendingToolCall.name} function.`
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
      msgContent ? buildUserMessageContext(msgContent) : JSON.stringify(msg.content)
    )

    if (currentLength + msgTokens <= remainingContextLength) {
      if (msg.role === 'user') {
        const userMsgContent = msg.content as UserMessageContent
        if (userMsgContent.content && !userMsgContent.text) {
          userMsgContent.text = getNormalizedUserMessageText(userMsgContent)
        }
      }

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
    console.log('artifacts目前由mcp提供，此处为兼容性保留')
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
        const userContext = buildUserMessageContext(msgContent)
        if (vision && msgContent.images && msgContent.images.length > 0) {
          resultMessages.push({
            role: 'user',
            content: [
              ...msgContent.images.map((image) => ({
                type: 'image_url' as const,
                image_url: { url: image, detail: 'auto' as const }
              })),
              { type: 'text' as const, text: userContext }
            ]
          })
        } else {
          resultMessages.push({
            role: 'user',
            content: userContext
          })
        }
      } else if (msg.role === 'assistant') {
        const content = msg.content as AssistantMessageBlock[]
        const messageContent: ChatMessageContent[] = []
        const toolCalls: ChatMessage['tool_calls'] = []

        content.forEach((block) => {
          if (block.type === 'tool_call' && block.tool_call) {
            toolCalls.push({
              id: block.tool_call.id,
              type: 'function',
              function: {
                name: block.tool_call.name,
                arguments: block.tool_call.params || ''
              }
            })
            if (block.tool_call.response) {
              messageContent.push({ type: 'text', text: block.tool_call.response })
            }
          } else if (block.type === 'content' && block.content) {
            messageContent.push({ type: 'text', text: block.content })
          }
        })

        if (toolCalls.length > 0) {
          resultMessages.push({
            role: 'assistant',
            content: messageContent.length > 0 ? messageContent : undefined,
            tool_calls: toolCalls
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
      const userContext = buildUserMessageContext(msgContent)
      if (vision && msgContent.images && msgContent.images.length > 0) {
        resultMessages.push({
          role: 'user',
          content: [
            ...msgContent.images.map((image) => ({
              type: 'image_url' as const,
              image_url: { url: image, detail: 'auto' as const }
            })),
            { type: 'text' as const, text: userContext }
          ]
        })
      } else {
        resultMessages.push({
          role: 'user',
          content: userContext
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
