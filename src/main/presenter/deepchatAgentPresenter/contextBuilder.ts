import { approximateTokenSize } from 'tokenx'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type {
  ChatMessageRecord,
  AssistantMessageBlock,
  MessageFile,
  MessageMetadata,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { DeepChatMessageStore } from './messageStore'

const IMAGE_TOKEN_ESTIMATE = 512

export type ContextBuildOptions = {
  summaryCursorOrderSeq?: number
  historyRecords?: ChatMessageRecord[]
  fallbackProtectedTurnCount?: number
  preserveInterleavedReasoning?: boolean
}

type TokenizedTurn = {
  messages: ChatMessage[]
  tokens: number
}

export type HistoryTurn = {
  records: ChatMessageRecord[]
  messages: ChatMessage[]
  tokens: number
}

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

export function normalizeUserInput(input: string | SendMessageInput): SendMessageInput {
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

function isCompactionRecord(record: ChatMessageRecord): boolean {
  try {
    const metadata = JSON.parse(record.metadata) as MessageMetadata
    return metadata.messageType === 'compaction'
  } catch {
    return false
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

export function buildUserMessageContent(
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

export function createUserChatMessage(
  input: string | SendMessageInput,
  supportsVision: boolean
): ChatMessage {
  const normalizedInput = normalizeUserInput(input)
  return {
    role: 'user',
    content: buildUserMessageContent(normalizedInput, supportsVision)
  }
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
  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      total += approximateTokenSize(toolCall.function.name)
      total += approximateTokenSize(toolCall.function.arguments)
    }
  }
  if (message.reasoning_content) {
    total += approximateTokenSize(message.reasoning_content)
  }
  return total
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
}

/**
 * Convert a ChatMessageRecord from the DB into one or more ChatMessages for the LLM.
 * Only settled tool calls (with a non-empty response) are included in history.
 */
export function recordToChatMessages(
  record: ChatMessageRecord,
  supportsVision: boolean,
  preserveInterleavedReasoning: boolean = false
): ChatMessage[] {
  if (isCompactionRecord(record)) {
    return []
  }

  if (record.role === 'user') {
    const parsed = parseUserRecordContent(record.content)
    return [{ role: 'user', content: buildUserMessageContent(parsed, supportsVision) }]
  }

  const blocks = JSON.parse(record.content) as AssistantMessageBlock[]
  const combinedText = blocks
    .filter((block) => block.type === 'content' || block.type === 'reasoning_content')
    .map((block) => block.content)
    .join('')
  const text = blocks
    .filter((block) => block.type === 'content')
    .map((block) => block.content)
    .join('')
  const reasoning = blocks
    .filter((block) => block.type === 'reasoning_content')
    .map((block) => block.content)
    .join('')

  const toolCallBlocks = blocks.filter(
    (block) =>
      block.type === 'tool_call' &&
      block.tool_call &&
      typeof block.tool_call.id === 'string' &&
      typeof block.tool_call.name === 'string' &&
      typeof block.tool_call.response === 'string' &&
      block.tool_call.response.length > 0
  )

  if (toolCallBlocks.length === 0) {
    return [{ role: 'assistant', content: combinedText }]
  }

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
    return [{ role: 'assistant', content: combinedText }]
  }

  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content: text,
    tool_calls: toolCalls
  }
  if (preserveInterleavedReasoning && reasoning) {
    assistantMessage.reasoning_content = reasoning
  }

  const result: ChatMessage[] = [assistantMessage]
  for (const block of toolCallBlocks) {
    result.push({
      role: 'tool',
      tool_call_id: block.tool_call!.id,
      content: block.tool_call!.response || ''
    })
  }

  return result
}

export function buildHistoryTurns(
  records: ChatMessageRecord[],
  supportsVision: boolean,
  preserveInterleavedReasoning: boolean = false
): HistoryTurn[] {
  const sortedRecords = [...records].sort((a, b) => a.orderSeq - b.orderSeq)
  const turns: ChatMessageRecord[][] = []
  let currentTurn: ChatMessageRecord[] = []

  for (const record of sortedRecords) {
    if (record.role === 'user' && currentTurn.length > 0) {
      turns.push(currentTurn)
      currentTurn = [record]
      continue
    }

    if (currentTurn.length === 0) {
      currentTurn = [record]
      continue
    }

    currentTurn.push(record)
  }

  if (currentTurn.length > 0) {
    turns.push(currentTurn)
  }

  return turns.map((turnRecords) => {
    const messages = turnRecords.flatMap((record) =>
      recordToChatMessages(record, supportsVision, preserveInterleavedReasoning)
    )
    return {
      records: turnRecords,
      messages,
      tokens: estimateMessagesTokens(messages)
    }
  })
}

function flattenTurns(turns: TokenizedTurn[]): ChatMessage[] {
  return turns.flatMap((turn) => turn.messages)
}

function buildChatMessageTurns(messages: ChatMessage[]): TokenizedTurn[] {
  const turns: ChatMessage[][] = []
  let currentTurn: ChatMessage[] = []

  for (const message of messages) {
    if (message.role === 'user' && currentTurn.length > 0) {
      turns.push(currentTurn)
      currentTurn = [message]
      continue
    }

    if (currentTurn.length === 0) {
      currentTurn = [message]
      continue
    }

    currentTurn.push(message)
  }

  if (currentTurn.length > 0) {
    turns.push(currentTurn)
  }

  return turns.map((turnMessages) => ({
    messages: turnMessages,
    tokens: estimateMessagesTokens(turnMessages)
  }))
}

/**
 * Emergency fallback that drops full turns first and only then falls back to
 * message-level truncation to keep the prompt valid.
 */
export function truncateContext(history: ChatMessage[], availableTokens: number): ChatMessage[] {
  let total = estimateMessagesTokens(history)
  if (total <= availableTokens) {
    return history
  }

  const result = [...history]
  while (result.length > 0 && total > availableTokens) {
    const removed = result.shift()!
    total -= estimateMessageTokens(removed)

    if (removed.role === 'assistant' && removed.tool_calls && removed.tool_calls.length > 0) {
      const toolCallIds = new Set(removed.tool_calls.map((toolCall) => toolCall.id))
      while (
        result.length > 0 &&
        result[0].role === 'tool' &&
        toolCallIds.has(result[0].tool_call_id!)
      ) {
        const toolMessage = result.shift()!
        total -= estimateMessageTokens(toolMessage)
      }
    }
  }

  while (result.length > 0 && result[0].role === 'tool') {
    total -= estimateMessageTokens(result[0])
    result.shift()
  }

  return result
}

function selectTurnHistory(
  turns: TokenizedTurn[],
  availableTokens: number,
  fallbackProtectedTurnCount: number
): ChatMessage[] {
  if (availableTokens <= 0 || turns.length === 0) {
    return []
  }

  let total = turns.reduce((sum, turn) => sum + turn.tokens, 0)
  if (total <= availableTokens) {
    return flattenTurns(turns)
  }

  const remainingTurns = [...turns]
  const protectedCount = Math.max(0, Math.min(fallbackProtectedTurnCount, remainingTurns.length))

  while (remainingTurns.length > protectedCount && total > availableTokens) {
    const removedTurn = remainingTurns.shift()
    total -= removedTurn?.tokens ?? 0
  }

  const flattened = flattenTurns(remainingTurns)
  if (estimateMessagesTokens(flattened) <= availableTokens) {
    return flattened
  }

  return truncateContext(flattened, availableTokens)
}

function filterRecordsFromCursor(
  records: ChatMessageRecord[],
  summaryCursorOrderSeq: number
): ChatMessageRecord[] {
  const cursor = Math.max(1, summaryCursorOrderSeq)
  return records.filter((record) => record.orderSeq >= cursor)
}

export function buildContext(
  sessionId: string,
  newUserContent: string | SendMessageInput,
  systemPrompt: string,
  contextLength: number,
  reserveTokens: number,
  messageStore: DeepChatMessageStore,
  supportsVision: boolean = false,
  options: ContextBuildOptions = {}
): ChatMessage[] {
  const sentRecords =
    options.historyRecords ??
    messageStore.getMessages(sessionId).filter((message) => message.status === 'sent')
  const historyRecords = filterRecordsFromCursor(sentRecords, options.summaryCursorOrderSeq ?? 1)
  const historyTurns = buildHistoryTurns(
    historyRecords,
    supportsVision,
    options.preserveInterleavedReasoning ?? false
  )

  const newUserMessage = createUserChatMessage(newUserContent, supportsVision)
  const systemPromptTokens = systemPrompt ? approximateTokenSize(systemPrompt) : 0
  const newUserTokens = estimateMessageTokens(newUserMessage)
  const available = contextLength - systemPromptTokens - newUserTokens - reserveTokens
  const selectedHistory = selectTurnHistory(
    historyTurns,
    available,
    options.fallbackProtectedTurnCount ?? 0
  )

  const messages: ChatMessage[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push(...selectedHistory)
  messages.push(newUserMessage)
  return messages
}

export function fitMessagesToContextWindow(
  messages: ChatMessage[],
  contextLength: number,
  reserveTokens: number,
  protectedTailCount: number = 0
): ChatMessage[] {
  if (messages.length === 0) {
    return []
  }

  const leadingSystemMessage = messages[0]?.role === 'system' ? messages[0] : null
  const conversationMessages = leadingSystemMessage ? messages.slice(1) : [...messages]
  const clampedProtectedTailCount = Math.max(
    0,
    Math.min(protectedTailCount, conversationMessages.length)
  )
  const protectedTail =
    clampedProtectedTailCount > 0 ? conversationMessages.slice(-clampedProtectedTailCount) : []
  const historyPrefix =
    clampedProtectedTailCount > 0
      ? conversationMessages.slice(0, -clampedProtectedTailCount)
      : conversationMessages

  const systemTokens = leadingSystemMessage ? estimateMessagesTokens([leadingSystemMessage]) : 0
  const protectedTailTokens = protectedTail.length > 0 ? estimateMessagesTokens(protectedTail) : 0
  const availableHistoryTokens = contextLength - systemTokens - protectedTailTokens - reserveTokens
  const selectedHistory = selectTurnHistory(
    buildChatMessageTurns(historyPrefix),
    availableHistoryTokens,
    0
  )

  const result: ChatMessage[] = []
  if (leadingSystemMessage) {
    result.push(leadingSystemMessage)
  }
  result.push(...selectedHistory)
  result.push(...protectedTail)
  return result
}

export function buildResumeContext(
  sessionId: string,
  assistantMessageId: string,
  systemPrompt: string,
  contextLength: number,
  reserveTokens: number,
  messageStore: DeepChatMessageStore,
  supportsVision: boolean = false,
  options: ContextBuildOptions = {}
): ChatMessage[] {
  const allMessages = messageStore.getMessages(sessionId)
  const targetMessage = allMessages.find((message) => message.id === assistantMessageId)
  const targetOrderSeq = targetMessage?.orderSeq
  const cursor = Math.max(1, options.summaryCursorOrderSeq ?? 1)

  const historyRecords = allMessages.filter((message) => {
    if (targetOrderSeq !== undefined && message.orderSeq > targetOrderSeq) {
      return false
    }
    if (message.id === assistantMessageId) {
      return true
    }
    if (message.status !== 'sent') {
      return false
    }
    return message.orderSeq >= cursor
  })

  const historyTurns = buildHistoryTurns(
    historyRecords,
    supportsVision,
    options.preserveInterleavedReasoning ?? false
  )
  const systemPromptTokens = systemPrompt ? approximateTokenSize(systemPrompt) : 0
  const available = contextLength - systemPromptTokens - reserveTokens
  const selectedHistory = selectTurnHistory(
    historyTurns,
    available,
    options.fallbackProtectedTurnCount ?? 1
  )

  const messages: ChatMessage[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push(...selectedHistory)
  return messages
}
