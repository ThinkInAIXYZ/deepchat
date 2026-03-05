import { approximateTokenSize } from 'tokenx'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type {
  ChatMessageRecord,
  AssistantMessageBlock,
  MessageFile,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { DeepChatMessageStore } from './messageStore'

const IMAGE_TOKEN_ESTIMATE = 512

function resolveFileMimeType(file: MessageFile): string {
  if (typeof file.mimeType === 'string' && file.mimeType.trim()) {
    return file.mimeType
  }
  if (typeof file.type === 'string' && file.type.trim()) {
    return file.type
  }
  return 'application/octet-stream'
}

function isImageFile(file: MessageFile): boolean {
  return resolveFileMimeType(file).startsWith('image/')
}

function normalizeUserInput(input: string | SendMessageInput): SendMessageInput {
  if (typeof input === 'string') {
    return { text: input, files: [] }
  }
  if (!input || typeof input !== 'object') {
    return { text: '', files: [] }
  }
  return {
    text: typeof input.text === 'string' ? input.text : '',
    files: Array.isArray(input.files)
      ? (input.files.filter((file): file is MessageFile => Boolean(file)) as MessageFile[])
      : []
  }
}

function parseUserRecordContent(content: string): SendMessageInput {
  try {
    const parsed = JSON.parse(content) as SendMessageInput | string
    return normalizeUserInput(parsed)
  } catch {
    return { text: content, files: [] }
  }
}

function buildNonImageFileContext(files: MessageFile[]): string {
  const nonImageFiles = files.filter((file) => !isImageFile(file))
  if (nonImageFiles.length === 0) {
    return ''
  }

  const blocks = nonImageFiles.map((file, index) => {
    const fileName = typeof file.name === 'string' ? file.name : `file-${index + 1}`
    const filePath = typeof file.path === 'string' ? file.path : ''
    const mimeType = resolveFileMimeType(file)
    const fileContent = typeof file.content === 'string' ? file.content : ''
    const metadataLines = [
      `name: ${fileName}`,
      filePath ? `path: ${filePath}` : '',
      mimeType ? `mime: ${mimeType}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    if (!fileContent.trim()) {
      return `[Attached File ${index + 1}]\n${metadataLines}\ncontent: [empty]`
    }
    return `[Attached File ${index + 1}]\n${metadataLines}\ncontent:\n${fileContent}`
  })

  return blocks.join('\n\n')
}

function buildImageMetadataContext(files: MessageFile[]): string {
  const imageFiles = files.filter((file) => isImageFile(file))
  if (imageFiles.length === 0) {
    return ''
  }

  return imageFiles
    .map((file, index) => {
      const fileName = typeof file.name === 'string' ? file.name : `image-${index + 1}`
      const filePath = typeof file.path === 'string' ? file.path : ''
      const mimeType = resolveFileMimeType(file)
      return [
        `[Attached Image ${index + 1}]`,
        `name: ${fileName}`,
        filePath ? `path: ${filePath}` : '',
        `mime: ${mimeType}`
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}

function buildUserMessageContent(
  input: SendMessageInput,
  supportsVision: boolean
): ChatMessage['content'] {
  const text = input.text ?? ''
  const files = Array.isArray(input.files) ? input.files : []
  const nonImageContext = buildNonImageFileContext(files)
  const baseText = [text, nonImageContext].filter((value) => value.trim()).join('\n\n')

  const imageFiles = files.filter((file) => isImageFile(file))
  if (!supportsVision || imageFiles.length === 0) {
    const imageMetadata = buildImageMetadataContext(imageFiles)
    return [baseText, imageMetadata].filter((value) => value.trim()).join('\n\n')
  }

  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
  > = []
  const textPart = baseText || 'User attached images for analysis.'
  parts.push({ type: 'text', text: textPart })

  for (const file of imageFiles) {
    const primaryData = typeof file.content === 'string' ? file.content : ''
    const fallbackData = typeof file.thumbnail === 'string' ? file.thumbnail : ''
    const dataUrl = primaryData.startsWith('data:image/') ? primaryData : fallbackData
    if (!dataUrl) {
      continue
    }
    parts.push({
      type: 'image_url',
      image_url: { url: dataUrl, detail: 'auto' }
    })
  }

  if (parts.length === 1) {
    const imageMetadata = buildImageMetadataContext(imageFiles)
    return [textPart, imageMetadata].filter((value) => value.trim()).join('\n\n')
  }
  return parts
}

function estimateMessageTokens(message: ChatMessage): number {
  if (typeof message.content === 'string') {
    return approximateTokenSize(message.content)
  }
  if (!Array.isArray(message.content)) {
    return 0
  }
  let total = 0
  for (const part of message.content) {
    if (part.type === 'text') {
      total += approximateTokenSize(part.text)
    } else if (part.type === 'image_url') {
      total += IMAGE_TOKEN_ESTIMATE
    }
  }
  return total
}

/**
 * Convert a ChatMessageRecord from the DB into one or more ChatMessages for the LLM.
 * An assistant record with tool_call blocks expands into:
 *   assistant message (with text + tool_calls) + tool result messages
 */
function recordToChatMessages(record: ChatMessageRecord, supportsVision: boolean): ChatMessage[] {
  if (record.role === 'user') {
    const parsed = parseUserRecordContent(record.content)
    return [{ role: 'user', content: buildUserMessageContent(parsed, supportsVision) }]
  }

  // Assistant: extract text content and tool calls
  const blocks = JSON.parse(record.content) as AssistantMessageBlock[]
  const text = blocks
    .filter((b) => b.type === 'content' || b.type === 'reasoning_content')
    .map((b) => b.content)
    .join('')

  const toolCallBlocks = blocks.filter(
    (b) =>
      b.type === 'tool_call' &&
      b.tool_call &&
      typeof b.tool_call.id === 'string' &&
      typeof b.tool_call.name === 'string'
  )

  if (toolCallBlocks.length === 0) {
    return [{ role: 'assistant', content: text }]
  }

  // Build assistant message with tool_calls.
  // Note: reasoning_content is NOT included here — for interleaved thinking
  // models (DeepSeek Reasoner etc.), reasoning_content is only required on
  // assistant messages in the current agent loop exchange, which the agentLoop
  // handles directly. Historical messages just include reasoning in content.
  const toolCalls: NonNullable<ChatMessage['tool_calls']> = []
  for (const block of toolCallBlocks) {
    const toolCall = block.tool_call
    if (!toolCall?.id || !toolCall.name) {
      continue
    }
    toolCalls.push({
      id: toolCall.id,
      type: 'function',
      function: { name: toolCall.name, arguments: toolCall.params || '{}' }
    })
  }

  if (toolCalls.length === 0) {
    return [{ role: 'assistant', content: text }]
  }

  const assistantMsg: ChatMessage = {
    role: 'assistant',
    content: text,
    tool_calls: toolCalls
  }

  const result: ChatMessage[] = [assistantMsg]

  // Append tool result messages
  for (const b of toolCallBlocks) {
    result.push({
      role: 'tool',
      tool_call_id: b.tool_call!.id,
      content: b.tool_call!.response || ''
    })
  }

  return result
}

/**
 * Truncate history messages to fit within the available token budget.
 * Drops oldest messages from the front until the total fits.
 * Tool result messages (role: 'tool') are dropped together with the
 * preceding assistant message that contains their tool_calls to avoid
 * orphaned tool results.
 */
export function truncateContext(history: ChatMessage[], availableTokens: number): ChatMessage[] {
  let total = 0
  for (const msg of history) {
    total += estimateMessageTokens(msg)
  }

  if (total <= availableTokens) {
    return history
  }

  // Drop from the front (oldest) until we fit.
  // When dropping, skip past any tool result messages that follow an
  // assistant message with tool_calls so they're removed as a group.
  const result = [...history]
  while (result.length > 0 && total > availableTokens) {
    const removed = result.shift()!
    total -= estimateMessageTokens(removed)

    // If we just removed an assistant message with tool_calls, also remove the
    // subsequent tool result messages that belong to it
    if (removed.role === 'assistant' && removed.tool_calls && removed.tool_calls.length > 0) {
      const toolCallIds = new Set(removed.tool_calls.map((tc) => tc.id))
      while (
        result.length > 0 &&
        result[0].role === 'tool' &&
        toolCallIds.has(result[0].tool_call_id!)
      ) {
        const toolMsg = result.shift()!
        total -= estimateMessageTokens(toolMsg)
      }
    }
  }

  // If the result starts with orphaned tool messages (shouldn't happen after
  // the above, but guard defensively), drop them
  while (result.length > 0 && result[0].role === 'tool') {
    const removed = result.shift()!
    total -= estimateMessageTokens(removed)
  }

  return result
}

/**
 * Build the full ChatMessage[] array for an LLM call, including:
 * - System prompt (if non-empty)
 * - Conversation history (truncated to fit context window)
 * - The new user message
 */
export function buildContext(
  sessionId: string,
  newUserContent: string | SendMessageInput,
  systemPrompt: string,
  contextLength: number,
  maxTokens: number,
  messageStore: DeepChatMessageStore,
  supportsVision: boolean = false
): ChatMessage[] {
  // 1. Fetch all sent messages (excludes pending/error)
  const allMessages = messageStore.getMessages(sessionId)
  const sentMessages = allMessages.filter((m) => m.status === 'sent')

  // 2. Convert to ChatMessage format (tool_call records expand to multiple messages)
  const history: ChatMessage[] = sentMessages.flatMap((record) =>
    recordToChatMessages(record, supportsVision)
  )
  const normalizedInput = normalizeUserInput(newUserContent)
  const newUserMessage: ChatMessage = {
    role: 'user',
    content: buildUserMessageContent(normalizedInput, supportsVision)
  }

  // 3. Calculate available token budget
  const systemPromptTokens = systemPrompt ? approximateTokenSize(systemPrompt) : 0
  const newUserTokens = estimateMessageTokens(newUserMessage)
  const available = contextLength - systemPromptTokens - newUserTokens - maxTokens

  // 4. Truncate history to fit
  const truncatedHistory = available > 0 ? truncateContext(history, available) : []

  // 5. Assemble final messages
  const messages: ChatMessage[] = []

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }

  messages.push(...truncatedHistory)
  messages.push(newUserMessage)

  return messages
}

/**
 * Build context for resuming an assistant message that paused on tool interactions.
 * Includes:
 * - system prompt
 * - historical sent messages
 * - the target assistant message (even if still pending)
 */
export function buildResumeContext(
  sessionId: string,
  assistantMessageId: string,
  systemPrompt: string,
  contextLength: number,
  maxTokens: number,
  messageStore: DeepChatMessageStore,
  supportsVision: boolean = false
): ChatMessage[] {
  const allMessages = messageStore.getMessages(sessionId)
  const targetMessage = allMessages.find((message) => message.id === assistantMessageId)
  const targetOrderSeq = targetMessage?.orderSeq

  const historyRecords = allMessages.filter((message) => {
    if (targetOrderSeq !== undefined && message.orderSeq > targetOrderSeq) {
      return false
    }
    if (message.id === assistantMessageId) {
      return true
    }
    return message.status === 'sent'
  })

  const history = historyRecords.flatMap((record) => recordToChatMessages(record, supportsVision))
  const systemPromptTokens = systemPrompt ? approximateTokenSize(systemPrompt) : 0
  const available = contextLength - systemPromptTokens - maxTokens
  const truncatedHistory = available > 0 ? truncateContext(history, available) : []

  const messages: ChatMessage[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push(...truncatedHistory)
  return messages
}
