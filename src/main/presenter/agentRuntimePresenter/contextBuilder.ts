import fs from 'fs'
import path from 'path'
import { approximateTokenSize } from 'tokenx'
import type { ChatMessage, ChatMessageProviderOptions } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type {
  ChatMessageRecord,
  AssistantMessageBlock,
  MessageFile,
  MessageMetadata,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { DeepChatMessageStore } from './messageStore'

const IMAGE_TOKEN_ESTIMATE = 512
const AUDIO_TOKEN_ESTIMATE = 512
const UNKNOWN_ASSISTANT_ERROR = 'Unknown error'
const KNOWN_ERROR_REASON_TEXT: Record<string, string> = {
  'common.error.userCanceledGeneration': 'User canceled generation',
  'common.error.sessionInterrupted':
    'Session was unexpectedly interrupted, generation is incomplete',
  'common.error.noModelResponse': 'Model did not return any content, it may have timed out'
}

export type ContextBuildOptions = {
  summaryCursorOrderSeq?: number
  historyRecords?: ChatMessageRecord[]
  fallbackProtectedTurnCount?: number
  preserveInterleavedReasoning?: boolean
  preserveEmptyInterleavedReasoning?: boolean
  extraReserveTokens?: number
  supportsAudioInput?: boolean
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

export type ContextIncludedReason = 'selected_history' | 'resume_target'
export type ContextExcludedReason = 'empty_after_formatting' | 'out_of_budget'

export type ContextIncludedRecord = {
  record: ChatMessageRecord
  reason: ContextIncludedReason
}

export type ContextExcludedRecord = {
  record: ChatMessageRecord
  reason: ContextExcludedReason
}

export type ContextSummaryCursorMetadata = {
  summaryCursorOrderSeq: number
  preCursorOrderSeqMin: number | null
  preCursorOrderSeqMax: number | null
  preCursorCount: number
}

export type ContextBuildMetadata = {
  includedRecords: ContextIncludedRecord[]
  excludedRecords: ContextExcludedRecord[]
  summaryCursor: ContextSummaryCursorMetadata
  includesSystemPrompt: boolean
}

export type ContextBuildResult = {
  messages: ChatMessage[]
  metadata: ContextBuildMetadata
}

function parseProviderOptionsJson(
  value: string | undefined
): ChatMessageProviderOptions | undefined {
  if (!value) {
    return undefined
  }

  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ChatMessageProviderOptions
    }
  } catch {}

  return undefined
}

function getBlockProviderOptions(
  block: AssistantMessageBlock
): ChatMessageProviderOptions | undefined {
  return parseProviderOptionsJson(
    typeof block.extra?.providerOptionsJson === 'string'
      ? block.extra.providerOptionsJson
      : undefined
  )
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

function inferAudioMimeTypeFromPath(filePath: string): string | null {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.flac':
      return 'audio/flac'
    case '.m4a':
      return 'audio/m4a'
    case '.mp4':
      return 'audio/mp4'
    case '.ogg':
      return 'audio/ogg'
    default:
      return null
  }
}

function resolveAudioMimeType(file: MessageFile): string {
  const mimeType = resolveFileMimeType(file)
  if (mimeType.startsWith('audio/')) {
    return mimeType
  }

  const fileSource =
    typeof file.path === 'string' && file.path.trim()
      ? file.path
      : typeof file.name === 'string'
        ? file.name
        : ''

  return inferAudioMimeTypeFromPath(fileSource) ?? mimeType
}

function isAudioFile(file: MessageFile): boolean {
  return resolveAudioMimeType(file).startsWith('audio/')
}

export function normalizeUserInput(input: string | SendMessageInput): SendMessageInput {
  if (typeof input === 'string') {
    return { text: input, files: [] }
  }
  if (!input || typeof input !== 'object') {
    return { text: '', files: [] }
  }
  const activeSkills = Array.isArray(input.activeSkills)
    ? Array.from(
        new Set(
          input.activeSkills
            .map((skillName) => (typeof skillName === 'string' ? skillName.trim() : ''))
            .filter((skillName) => skillName.length > 0)
        )
      )
    : []
  return {
    text: typeof input.text === 'string' ? input.text : '',
    files: Array.isArray(input.files)
      ? (input.files.filter((file): file is MessageFile => Boolean(file)) as MessageFile[])
      : [],
    ...(activeSkills.length > 0 ? { activeSkills } : {})
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

export function isCompactionRecord(record: ChatMessageRecord): boolean {
  try {
    const metadata = JSON.parse(record.metadata) as MessageMetadata
    return metadata.messageType === 'compaction'
  } catch {
    return false
  }
}

export function isContextHistoryRecord(record: ChatMessageRecord): boolean {
  if (isCompactionRecord(record)) {
    return false
  }
  if (record.status === 'sent') {
    return true
  }
  return record.role === 'assistant' && record.status === 'error'
}

function buildNonImageFileContext(files: MessageFile[], excludeAudio: boolean = false): string {
  const nonImageFiles = files.filter(
    (file) => !isImageFile(file) && (!excludeAudio || !isAudioFile(file))
  )
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

function buildAudioMetadataContext(files: MessageFile[]): string {
  const audioFiles = files.filter((file) => isAudioFile(file))
  if (audioFiles.length === 0) {
    return ''
  }

  return audioFiles
    .map((file, index) => {
      const fileName = typeof file.name === 'string' ? file.name : `audio-${index + 1}`
      const filePath = typeof file.path === 'string' ? file.path : ''
      const mimeType = resolveAudioMimeType(file)
      return [
        `[Attached Audio ${index + 1}]`,
        `name: ${fileName}`,
        filePath ? `path: ${filePath}` : '',
        `mime: ${mimeType}`
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}

function parseAudioDataUrl(value: string): { data: string; mediaType: string } | null {
  const match = value.match(/^data:([^;,]+);base64,([\s\S]+)$/i)
  if (!match?.[1] || !match[2]) {
    return null
  }

  const mediaType = match[1].trim().toLowerCase()
  if (!mediaType.startsWith('audio/')) {
    return null
  }

  return {
    data: match[2],
    mediaType
  }
}

function resolveFileByteSize(file: MessageFile): number | undefined {
  if (typeof file.size === 'number' && Number.isFinite(file.size) && file.size > 0) {
    return file.size
  }

  if (
    typeof file.metadata?.fileSize === 'number' &&
    Number.isFinite(file.metadata.fileSize) &&
    file.metadata.fileSize > 0
  ) {
    return file.metadata.fileSize
  }

  return undefined
}

type AudioAttachmentPayload = {
  data: string
  mediaType: string
  byteLength: number
}

function resolveAudioAttachmentPayload(file: MessageFile): AudioAttachmentPayload | null {
  const inlineContent = typeof file.content === 'string' ? file.content.trim() : ''
  const inlineDataUrl = parseAudioDataUrl(inlineContent)
  if (inlineDataUrl) {
    try {
      const byteLength = Buffer.from(inlineDataUrl.data, 'base64').byteLength
      return {
        data: inlineDataUrl.data,
        mediaType: inlineDataUrl.mediaType,
        byteLength
      }
    } catch {
      return null
    }
  }

  const filePath = typeof file.path === 'string' ? file.path.trim() : ''
  if (!filePath) {
    return null
  }

  try {
    const buffer = fs.readFileSync(filePath)
    return {
      data: buffer.toString('base64'),
      mediaType: resolveAudioMimeType(file),
      byteLength: buffer.byteLength
    }
  } catch {
    return null
  }
}

function estimateAudioInputTokens(file: MessageFile, byteLength: number): number {
  const storedTokens =
    typeof file.token === 'number' && Number.isFinite(file.token) ? Math.ceil(file.token) : 0
  const fileSize = resolveFileByteSize(file) ?? byteLength
  const sizeBasedEstimate = fileSize > 0 ? Math.ceil(fileSize / 1024) : 0

  return Math.max(AUDIO_TOKEN_ESTIMATE, storedTokens, sizeBasedEstimate)
}

function buildStructuredAttachmentText(imageCount: number, audioCount: number): string {
  if (imageCount > 0 && audioCount > 0) {
    return 'User attached media for analysis.'
  }

  if (imageCount > 0) {
    return 'User attached images for analysis.'
  }

  if (audioCount > 0) {
    return 'User attached audio for analysis.'
  }

  return 'User attached files for analysis.'
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
  supportsVision: boolean,
  supportsAudioInput: boolean = false
): ChatMessage['content'] {
  const text = input.text ?? ''
  const files = Array.isArray(input.files) ? input.files : []

  const imageFiles = files.filter((file) => isImageFile(file))
  const audioFiles = files.filter((file) => isAudioFile(file))
  const audioParts: Array<{
    type: 'input_audio'
    input_audio: {
      data: string
      media_type: string
      filename?: string
      estimated_tokens?: number
    }
  }> = supportsAudioInput
    ? audioFiles.flatMap((file) => {
        const payload = resolveAudioAttachmentPayload(file)
        if (!payload) {
          return []
        }

        return [
          {
            type: 'input_audio' as const,
            input_audio: {
              data: payload.data,
              media_type: payload.mediaType,
              ...(typeof file.name === 'string' && file.name.trim() ? { filename: file.name } : {}),
              estimated_tokens: estimateAudioInputTokens(file, payload.byteLength)
            }
          }
        ]
      })
    : []

  const excludeAudioFromFallback = supportsAudioInput && audioParts.length > 0
  const nonImageContext = buildNonImageFileContext(files, excludeAudioFromFallback)
  const audioMetadata = excludeAudioFromFallback ? buildAudioMetadataContext(audioFiles) : ''
  const baseText = [text, nonImageContext, audioMetadata]
    .filter((value) => value.trim())
    .join('\n\n')

  if ((!supportsVision || imageFiles.length === 0) && audioParts.length === 0) {
    const imageMetadata = buildImageMetadataContext(imageFiles)
    return [baseText, imageMetadata].filter((value) => value.trim()).join('\n\n')
  }

  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
    | {
        type: 'input_audio'
        input_audio: {
          data: string
          media_type: string
          filename?: string
          estimated_tokens?: number
        }
      }
  > = []

  const imageParts: Array<{
    type: 'image_url'
    image_url: { url: string; detail?: 'auto' | 'low' | 'high' }
  }> = []

  if (supportsVision) {
    for (const file of imageFiles) {
      const primaryData = typeof file.content === 'string' ? file.content : ''
      const fallbackData = typeof file.thumbnail === 'string' ? file.thumbnail : ''
      const dataUrl = primaryData.startsWith('data:image/') ? primaryData : fallbackData
      if (!dataUrl) {
        continue
      }
      imageParts.push({
        type: 'image_url',
        image_url: { url: dataUrl, detail: 'auto' }
      })
    }
  }

  const hasStructuredParts = imageParts.length > 0 || audioParts.length > 0
  if (!hasStructuredParts) {
    const imageMetadata = buildImageMetadataContext(imageFiles)
    return [baseText, imageMetadata].filter((value) => value.trim()).join('\n\n')
  }

  const textPart = baseText || buildStructuredAttachmentText(imageParts.length, audioParts.length)
  parts.push({ type: 'text', text: textPart })
  parts.push(...imageParts, ...audioParts)

  return parts
}

export function createUserChatMessage(
  input: string | SendMessageInput,
  supportsVision: boolean,
  supportsAudioInput: boolean = false
): ChatMessage {
  const normalizedInput = normalizeUserInput(input)
  return {
    role: 'user',
    content: buildUserMessageContent(normalizedInput, supportsVision, supportsAudioInput)
  }
}

function hasPromptMessageContent(message: ChatMessage): boolean {
  if (typeof message.content === 'string' && message.content.trim().length > 0) {
    return true
  }

  if (Array.isArray(message.content)) {
    return message.content.some((part) => {
      if (part.type === 'text') {
        return part.text.trim().length > 0
      }
      if (part.type === 'image_url') {
        return part.image_url.url.trim().length > 0
      }
      if (part.type === 'input_audio') {
        return part.input_audio.data.trim().length > 0
      }
      return false
    })
  }

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return true
  }

  return typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0
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
    } else if (part.type === 'input_audio') {
      total += part.input_audio.estimated_tokens ?? AUDIO_TOKEN_ESTIMATE
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

export function estimateToolDefinitionTokens(toolDefinitions: MCPToolDefinition[]): number {
  return toolDefinitions.reduce(
    (total, tool) => total + approximateTokenSize(JSON.stringify(tool)),
    0
  )
}

export function normalizeAssistantErrorReason(value: string): string {
  const trimmed = value.trim()
  return KNOWN_ERROR_REASON_TEXT[trimmed] ?? trimmed
}

export function formatAssistantErrorSummary(errorMessages: string[]): string | null {
  const reasons = errorMessages
    .map(normalizeAssistantErrorReason)
    .filter((message) => message.length > 0)

  if (reasons.length === 0) {
    return null
  }

  const uniqueReasons = [...new Set(reasons)]
  const onlyUserCanceled =
    uniqueReasons.length === 1 &&
    uniqueReasons[0] === KNOWN_ERROR_REASON_TEXT['common.error.userCanceledGeneration']
  const label = onlyUserCanceled ? 'Generation canceled' : 'Generation failed'
  return `[${label}]\nReason: ${uniqueReasons.join('\n')}`
}

function buildAssistantErrorSummary(
  blocks: AssistantMessageBlock[],
  record: ChatMessageRecord
): string | null {
  const errorMessages = blocks
    .filter(
      (block): block is AssistantMessageBlock & { content: string } =>
        block.type === 'error' &&
        typeof block.content === 'string' &&
        block.content.trim().length > 0
    )
    .map((block) => block.content)

  if (errorMessages.length > 0) {
    return formatAssistantErrorSummary(errorMessages)
  }

  if (record.status === 'error') {
    return formatAssistantErrorSummary([UNKNOWN_ASSISTANT_ERROR])
  }

  return null
}

function appendAssistantTextContent(
  content: ChatMessage['content'],
  extraText: string | null
): ChatMessage['content'] {
  if (!extraText) {
    return content
  }

  if (Array.isArray(content)) {
    return [...content, { type: 'text', text: extraText }]
  }

  return [typeof content === 'string' ? content : '', extraText]
    .filter((value) => value.trim().length > 0)
    .join('\n\n')
}

/**
 * Convert a ChatMessageRecord from the DB into one or more ChatMessages for the LLM.
 * Only settled tool calls (with a non-empty response) are included in history.
 */
export function recordToChatMessages(
  record: ChatMessageRecord,
  supportsVision: boolean,
  preserveInterleavedReasoning: boolean = false,
  preserveEmptyInterleavedReasoning: boolean = false,
  supportsAudioInput: boolean = false
): ChatMessage[] {
  if (isCompactionRecord(record)) {
    return []
  }

  if (record.role === 'user') {
    const parsed = parseUserRecordContent(record.content)
    const message: ChatMessage = {
      role: 'user',
      content: buildUserMessageContent(parsed, supportsVision, supportsAudioInput)
    }
    return hasPromptMessageContent(message) ? [message] : []
  }

  const blocks = JSON.parse(record.content) as AssistantMessageBlock[]
  const errorSummary = buildAssistantErrorSummary(blocks, record)
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
  const shouldPreserveReasoning = preserveInterleavedReasoning && Boolean(reasoning)
  const shouldPreserveEmptyReasoning =
    preserveInterleavedReasoning && preserveEmptyInterleavedReasoning
  const contentParts = blocks
    .filter(
      (block): block is AssistantMessageBlock & { content: string } =>
        block.type === 'content' && typeof block.content === 'string' && block.content.length > 0
    )
    .map((block) => {
      const providerOptions = getBlockProviderOptions(block)
      return {
        type: 'text' as const,
        text: block.content,
        ...(providerOptions ? { provider_options: providerOptions } : {})
      }
    })
  const assistantContent = contentParts.some((part) => part.provider_options) ? contentParts : text
  const applyReasoningContent = (
    assistantMessage: ChatMessage,
    allowEmptyReasoning: boolean = false
  ): ChatMessage => {
    if (shouldPreserveReasoning || (allowEmptyReasoning && shouldPreserveEmptyReasoning)) {
      assistantMessage.reasoning_content = reasoning
      const reasoningProviderOptions = blocks
        .filter((block) => block.type === 'reasoning_content')
        .map((block) => getBlockProviderOptions(block))
        .find(Boolean)
      if (reasoningProviderOptions) {
        assistantMessage.reasoning_provider_options = reasoningProviderOptions
      }
    }
    return assistantMessage
  }

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
    const contentWithErrorSummary = appendAssistantTextContent(
      preserveEmptyInterleavedReasoning || shouldPreserveReasoning
        ? assistantContent
        : combinedText,
      errorSummary
    )
    if (shouldPreserveReasoning) {
      const message = applyReasoningContent({ role: 'assistant', content: contentWithErrorSummary })
      return hasPromptMessageContent(message) ? [message] : []
    }
    if (preserveEmptyInterleavedReasoning) {
      const message: ChatMessage = { role: 'assistant', content: contentWithErrorSummary }
      return hasPromptMessageContent(message) ? [message] : []
    }
    const message: ChatMessage = { role: 'assistant', content: contentWithErrorSummary }
    return hasPromptMessageContent(message) ? [message] : []
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
      function: { name: toolCall.name, arguments: toolCall.params || '{}' },
      ...(getBlockProviderOptions(block)
        ? { provider_options: getBlockProviderOptions(block) }
        : {})
    })
  }

  if (toolCalls.length === 0) {
    const contentWithErrorSummary = appendAssistantTextContent(
      preserveEmptyInterleavedReasoning || shouldPreserveReasoning
        ? assistantContent
        : combinedText,
      errorSummary
    )
    if (shouldPreserveReasoning) {
      const message = applyReasoningContent({ role: 'assistant', content: contentWithErrorSummary })
      return hasPromptMessageContent(message) ? [message] : []
    }
    if (preserveEmptyInterleavedReasoning) {
      const message: ChatMessage = { role: 'assistant', content: contentWithErrorSummary }
      return hasPromptMessageContent(message) ? [message] : []
    }
    const message: ChatMessage = { role: 'assistant', content: contentWithErrorSummary }
    return hasPromptMessageContent(message) ? [message] : []
  }

  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content: assistantContent,
    tool_calls: toolCalls
  }
  applyReasoningContent(assistantMessage, true)

  const result: ChatMessage[] = [assistantMessage]
  for (const block of toolCallBlocks) {
    result.push({
      role: 'tool',
      tool_call_id: block.tool_call!.id,
      content: block.tool_call!.response || ''
    })
  }
  if (errorSummary) {
    result.push({ role: 'assistant', content: errorSummary })
  }

  return result
}

export function buildHistoryTurns(
  records: ChatMessageRecord[],
  supportsVision: boolean,
  preserveInterleavedReasoning: boolean = false,
  preserveEmptyInterleavedReasoning: boolean = false,
  supportsAudioInput: boolean = false
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

  return turns
    .map((turnRecords) => {
      const messages = turnRecords.flatMap((record) =>
        recordToChatMessages(
          record,
          supportsVision,
          preserveInterleavedReasoning,
          preserveEmptyInterleavedReasoning,
          supportsAudioInput
        )
      )
      return {
        records: turnRecords,
        messages,
        tokens: estimateMessagesTokens(messages)
      }
    })
    .filter((turn) => turn.messages.length > 0)
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
  return flattenTurns(selectTurnHistoryTurns(turns, availableTokens, fallbackProtectedTurnCount))
}

function selectTurnHistoryTurns<T extends TokenizedTurn>(
  turns: T[],
  availableTokens: number,
  fallbackProtectedTurnCount: number
): T[] {
  if (turns.length === 0) {
    return []
  }

  const protectedCount = Math.max(0, Math.min(fallbackProtectedTurnCount, turns.length))
  if (availableTokens <= 0) {
    return protectedCount > 0 ? turns.slice(-protectedCount) : []
  }

  let total = turns.reduce((sum, turn) => sum + turn.tokens, 0)
  if (total <= availableTokens) {
    return turns
  }

  const remainingTurns = [...turns]

  while (remainingTurns.length > protectedCount && total > availableTokens) {
    const removedTurn = remainingTurns.shift()
    total -= removedTurn?.tokens ?? 0
  }

  const flattened = flattenTurns(remainingTurns)
  if (
    estimateMessagesTokens(flattened) <= availableTokens ||
    remainingTurns.length <= protectedCount
  ) {
    return remainingTurns
  }

  const truncatedMessages = truncateContext(flattened, availableTokens)
  if (truncatedMessages.length === 0) {
    return []
  }

  let droppedPrefixCount = flattened.length - truncatedMessages.length
  const rebuiltTurns: T[] = []

  for (const turn of remainingTurns) {
    if (droppedPrefixCount >= turn.messages.length) {
      droppedPrefixCount -= turn.messages.length
      continue
    }

    if (droppedPrefixCount > 0) {
      const keptMessages = turn.messages.slice(droppedPrefixCount)
      droppedPrefixCount = 0
      rebuiltTurns.push({
        ...turn,
        messages: keptMessages,
        tokens: estimateMessagesTokens(keptMessages)
      })
      continue
    }

    rebuiltTurns.push(turn)
  }

  return rebuiltTurns
}

function filterRecordsFromCursor(
  records: ChatMessageRecord[],
  summaryCursorOrderSeq: number
): ChatMessageRecord[] {
  const cursor = Math.max(1, summaryCursorOrderSeq)
  return records.filter((record) => record.orderSeq >= cursor)
}

function buildSummaryCursorMetadata(
  preCursorRecords: ChatMessageRecord[],
  cursor: number
): ContextSummaryCursorMetadata {
  if (preCursorRecords.length === 0) {
    return {
      summaryCursorOrderSeq: cursor,
      preCursorOrderSeqMin: null,
      preCursorOrderSeqMax: null,
      preCursorCount: 0
    }
  }
  let min = preCursorRecords[0].orderSeq
  let max = preCursorRecords[0].orderSeq
  for (const record of preCursorRecords) {
    if (record.orderSeq < min) min = record.orderSeq
    if (record.orderSeq > max) max = record.orderSeq
  }
  return {
    summaryCursorOrderSeq: cursor,
    preCursorOrderSeqMin: min,
    preCursorOrderSeqMax: max,
    preCursorCount: preCursorRecords.length
  }
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
  return buildContextWithMetadata(
    sessionId,
    newUserContent,
    systemPrompt,
    contextLength,
    reserveTokens,
    messageStore,
    supportsVision,
    options
  ).messages
}

export function buildContextWithMetadata(
  sessionId: string,
  newUserContent: string | SendMessageInput,
  systemPrompt: string,
  contextLength: number,
  reserveTokens: number,
  messageStore: DeepChatMessageStore,
  supportsVision: boolean = false,
  options: ContextBuildOptions = {}
): ContextBuildResult {
  const supportsAudioInput = options.supportsAudioInput === true
  const candidateRecords = options.historyRecords ?? messageStore.getMessages(sessionId)
  const contextCandidateRecords = candidateRecords.filter(isContextHistoryRecord)
  const cursor = Math.max(1, options.summaryCursorOrderSeq ?? 1)
  const historyRecords = filterRecordsFromCursor(contextCandidateRecords, cursor)
  const historyTurns = buildHistoryTurns(
    historyRecords,
    supportsVision,
    options.preserveInterleavedReasoning ?? false,
    options.preserveEmptyInterleavedReasoning ?? false,
    supportsAudioInput
  )

  const newUserMessage = createUserChatMessage(newUserContent, supportsVision, supportsAudioInput)
  const systemPromptTokens = systemPrompt ? approximateTokenSize(systemPrompt) : 0
  const newUserTokens = estimateMessageTokens(newUserMessage)
  const available =
    contextLength -
    systemPromptTokens -
    newUserTokens -
    reserveTokens -
    (options.extraReserveTokens ?? 0)
  const selectedTurns = selectTurnHistoryTurns(
    historyTurns,
    available,
    options.fallbackProtectedTurnCount ?? 0
  )
  const selectedHistory = flattenTurns(selectedTurns)
  const selectedRecordIds = new Set(
    selectedTurns.flatMap((turn) => turn.records.map((record) => record.id))
  )
  const emittedRecordIds = new Set(
    historyTurns.flatMap((turn) => turn.records.map((record) => record.id))
  )

  const messages: ChatMessage[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push(...selectedHistory)
  if (hasPromptMessageContent(newUserMessage)) {
    messages.push(newUserMessage)
  }
  const preCursorRecords = contextCandidateRecords.filter((record) => record.orderSeq < cursor)
  const excludedRecords: ContextExcludedRecord[] = [
    ...historyRecords
      .filter((record) => !emittedRecordIds.has(record.id))
      .map((record) => ({
        record,
        reason: 'empty_after_formatting' as const
      })),
    ...historyRecords
      .filter((record) => emittedRecordIds.has(record.id) && !selectedRecordIds.has(record.id))
      .map((record) => ({
        record,
        reason: 'out_of_budget' as const
      }))
  ]

  return {
    messages,
    metadata: {
      includedRecords: selectedTurns.flatMap((turn) =>
        turn.records.map((record) => ({
          record,
          reason: 'selected_history' as const
        }))
      ),
      excludedRecords,
      summaryCursor: buildSummaryCursorMetadata(preCursorRecords, cursor),
      includesSystemPrompt: Boolean(systemPrompt)
    }
  }
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
  return buildResumeContextWithMetadata(
    sessionId,
    assistantMessageId,
    systemPrompt,
    contextLength,
    reserveTokens,
    messageStore,
    supportsVision,
    options
  ).messages
}

export function buildResumeContextWithMetadata(
  sessionId: string,
  assistantMessageId: string,
  systemPrompt: string,
  contextLength: number,
  reserveTokens: number,
  messageStore: DeepChatMessageStore,
  supportsVision: boolean = false,
  options: ContextBuildOptions = {}
): ContextBuildResult {
  const supportsAudioInput = options.supportsAudioInput === true
  const allMessages = options.historyRecords ?? messageStore.getMessages(sessionId)
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
    if (!isContextHistoryRecord(message)) {
      return false
    }
    return message.orderSeq >= cursor
  })

  const historyTurns = buildHistoryTurns(
    historyRecords,
    supportsVision,
    options.preserveInterleavedReasoning ?? false,
    options.preserveEmptyInterleavedReasoning ?? false,
    supportsAudioInput
  )
  const systemPromptTokens = systemPrompt ? approximateTokenSize(systemPrompt) : 0
  const available =
    contextLength - systemPromptTokens - reserveTokens - (options.extraReserveTokens ?? 0)
  const selectedTurns = selectTurnHistoryTurns(
    historyTurns,
    available,
    options.fallbackProtectedTurnCount ?? 1
  )
  const selectedHistory = flattenTurns(selectedTurns)
  const selectedRecordIds = new Set(
    selectedTurns.flatMap((turn) => turn.records.map((record) => record.id))
  )
  const emittedRecordIds = new Set(
    historyTurns.flatMap((turn) => turn.records.map((record) => record.id))
  )

  const messages: ChatMessage[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push(...selectedHistory)
  const preCursorRecords = allMessages.filter(
    (record) =>
      record.id !== assistantMessageId &&
      isContextHistoryRecord(record) &&
      record.orderSeq < cursor &&
      (targetOrderSeq === undefined || record.orderSeq <= targetOrderSeq)
  )
  const excludedRecords: ContextExcludedRecord[] = [
    ...historyRecords
      .filter((record) => !emittedRecordIds.has(record.id))
      .map((record) => ({
        record,
        reason: 'empty_after_formatting' as const
      })),
    ...historyRecords
      .filter((record) => emittedRecordIds.has(record.id) && !selectedRecordIds.has(record.id))
      .map((record) => ({
        record,
        reason: 'out_of_budget' as const
      }))
  ]

  return {
    messages,
    metadata: {
      includedRecords: selectedTurns.flatMap((turn) =>
        turn.records.map((record) => ({
          record,
          reason:
            record.id === assistantMessageId
              ? ('resume_target' as const)
              : ('selected_history' as const)
        }))
      ),
      excludedRecords,
      summaryCursor: buildSummaryCursorMetadata(preCursorRecords, cursor),
      includesSystemPrompt: Boolean(systemPrompt)
    }
  }
}
