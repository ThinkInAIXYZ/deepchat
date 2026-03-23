import type {
  AssistantMessageBlock,
  Message,
  MessageFile,
  UserMessageCodeBlock,
  UserMessageContent,
  UserMessageMentionBlock,
  UserMessageTextBlock
} from '@shared/chat'
import type { ChatMessage, ChatMessageContent } from '@shared/presenter'
import { nanoid } from 'nanoid'

const FILE_CONTENT_MAX_CHARS = 8000
const FILE_CONTENT_TRUNCATION_SUFFIX = '…(truncated)'

type VisionUserMessageContent = UserMessageContent & { images?: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTextBlock(content: unknown): content is { type: 'text'; text: string } {
  return isRecord(content) && content.type === 'text' && typeof content.text === 'string'
}

function extractPromptMessageText(message: unknown): string {
  if (!isRecord(message)) {
    return ''
  }

  const content = message.content

  if (typeof content === 'string') {
    return content
  }

  if (isTextBlock(content)) {
    return content.text
  }

  if (isRecord(content) && typeof content.type === 'string') {
    return `[${content.type}]`
  }

  return '[content]'
}

function truncateFileContent(content: string): string {
  if (content.length <= FILE_CONTENT_MAX_CHARS) {
    return content
  }

  return `${content.slice(0, FILE_CONTENT_MAX_CHARS)}${FILE_CONTENT_TRUNCATION_SUFFIX}`
}

function escapeTagContent(value: string): string {
  /* eslint-disable no-control-regex */
  return String(value).replace(/[&<>\u0000-\u001F]/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '\n':
        return '&#10;'
      case '\r':
        return '&#13;'
      case '\t':
        return '&#9;'
      default:
        return ''
    }
  })
}

export type UserMessageRichBlock =
  | UserMessageTextBlock
  | UserMessageMentionBlock
  | UserMessageCodeBlock

export function formatUserMessageContent(msgContentBlock: UserMessageRichBlock[]): string {
  if (!Array.isArray(msgContentBlock)) {
    return ''
  }

  return msgContentBlock
    .map((block) => {
      if (block.type === 'mention') {
        if (block.category === 'resources') {
          return `@${block.content}`
        } else if (block.category === 'tools') {
          return `@${block.id}`
        } else if (block.category === 'files') {
          return `@${block.id}`
        } else if (block.category === 'context') {
          return block.content
        } else if (block.category === 'prompts') {
          try {
            const promptData = JSON.parse(block.content)
            if (isRecord(promptData) && Array.isArray(promptData.messages)) {
              const messageTexts = promptData.messages
                .map(extractPromptMessageText)
                .filter((text) => text)
              const escapedContent = messageTexts.length
                ? messageTexts.map(escapeTagContent).join('\n')
                : escapeTagContent(block.content ?? '')
              return `@${block.id} <prompts>${escapedContent}</prompts>`
            }
          } catch (e) {
            console.warn('Failed to parse prompt content:', e)
          }
          return `@${block.id} <prompts>${escapeTagContent(block.content ?? '')}</prompts>`
        }
        return `@${block.id}`
      } else if (block.type === 'text') {
        return block.content
      } else if (block.type === 'code') {
        return `\`\`\`${block.content}\`\`\``
      }
      return ''
    })
    .join('')
}

export function getFileContext(files?: MessageFile[]): string {
  if (!files || files.length === 0) {
    return ''
  }

  return `
  <files>
    ${files
      .map(
        (file) => `<file>
      <name>${file.name ?? ''}</name>
      <mimeType>${file.mimeType ?? ''}</mimeType>
      <size>${file.metadata?.fileSize ?? 0}</size>
      <content>${
        file.mimeType && !file.mimeType.startsWith('image')
          ? truncateFileContent(String(file.content ?? ''))
          : ''
      }</content>
    </file>`
      )
      .join('\n')}
  </files>
  `
}

export function getNormalizedUserMessageText(content: UserMessageContent | undefined): string {
  if (!content) {
    return ''
  }

  if (content.content && Array.isArray(content.content) && content.content.length > 0) {
    return formatUserMessageContent(content.content)
  }

  return content.text || ''
}

export function buildUserMessageContext(content: UserMessageContent | undefined): string {
  if (!content) {
    return ''
  }

  const messageText = getNormalizedUserMessageText(content)
  const fileContext = getFileContext(content.files)

  return `${messageText}${fileContext}`
}

export function formatMessagesForCompletion(
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

export function addContextMessages(
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
            if (block.tool_call.response) {
              const toolCallId = block.tool_call.id || nanoid(8)
              toolCalls.push({
                id: toolCallId,
                type: 'function',
                function: {
                  name: block.tool_call.name,
                  arguments: block.tool_call.params || ''
                }
              })
              toolResponses.push({
                id: toolCallId,
                response: block.tool_call.response
              })
            }
          } else if (block.type === 'content' && block.content) {
            messageContent.push({ type: 'text', text: block.content })
          }
        })

        if (toolCalls.length > 0) {
          const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: messageContent.length > 0 ? messageContent : undefined,
            tool_calls: toolCalls
          }
          resultMessages.push(assistantMessage)

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

      const legacyToolCalls = content
        .filter((block) => block.type === 'tool_call' && block.tool_call?.response)
        .map((block) => buildLegacyFunctionCallRecord(block.tool_call))

      const combinedText = [textContent, ...legacyToolCalls].filter(Boolean).join('\n')

      if (combinedText) {
        resultMessages.push({
          role: 'assistant',
          content: combinedText
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

export function mergeConsecutiveMessages(messages: ChatMessage[]): ChatMessage[] {
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

function addImageFiles(finalContent: string, imageFiles: MessageFile[]): ChatMessage {
  return {
    role: 'user',
    content: [
      ...imageFiles.flatMap((file) => [
        {
          type: 'text' as const,
          text: `File path for tool calls: ${file.path}`
        },
        {
          type: 'image_url' as const,
          image_url: { url: file.content, detail: 'auto' as const }
        }
      ]),
      { type: 'text' as const, text: finalContent.trim() }
    ]
  }
}

function buildLegacyFunctionCallRecord(toolCall: AssistantMessageBlock['tool_call']): string {
  const record = {
    function_call_record: {
      name: toolCall?.name || '',
      arguments: toolCall?.params || '',
      response: toolCall?.response || ''
    }
  }

  return `<function_call>${JSON.stringify(record)}</function_call>`
}
