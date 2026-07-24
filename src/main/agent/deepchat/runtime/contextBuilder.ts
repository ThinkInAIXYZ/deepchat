import fs from 'fs'
import path from 'path'
import { approximateTokenSize } from 'tokenx'
import type { ChatMessage, ChatMessageProviderOptions } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type {
  ChatMessageRecord,
  AssistantMessageBlock,
  MessageFile,
  SendMessageInput
} from '@shared/types/agent-interface'
import type { SessionTranscript } from '@/session/data/transcript'
import type { DeepChatTapeViewSyntheticContribution } from '@shared/types/tape-view-manifest'
import {
  getContextSyntheticContributions,
  type ContextRuntimeContributions
} from './contextContributions'
import {
  estimateMessageTokens,
  estimateMessagesTokens
} from '@shared/utils/messageTokens'
import { isCompactionRecord } from '@/tape/domain/viewManifest'
import {
  getAttachmentResolvedRepresentation,
  isImageAttachment
} from '@shared/utils/attachmentRepresentation'

export { estimateMessagesTokens } from '@shared/utils/messageTokens'

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

export type CacheAwareContextBuildOptions = ContextBuildOptions & {
  contextContributions: ContextRuntimeContributions
}

type TokenizedTurn = {
  messages: ChatMessage[]
  tokens: number
}

type UserMessageContentBuildOptions = {
  includeFileContent?: boolean
  includeImageData?: boolean
  includeAudioData?: boolean
  leadingContext?: string | null
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
  syntheticContributions?: DeepChatTapeViewSyntheticContribution[]
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
  const inlineItems = Array.isArray(input.inlineItems) ? input.inlineItems : []
  return {
    text: typeof input.text === 'string' ? input.text : '',
    files: Array.isArray(input.files)
      ? (input.files.filter((file): file is MessageFile => Boolean(file)) as MessageFile[])
      : [],
    ...(activeSkills.length > 0 ? { activeSkills } : {}),
    ...(inlineItems.length > 0 ? { inlineItems } : {}),
    ...(input.attachmentFallbackPolicy === 'auto' ||
    input.attachmentFallbackPolicy === 'send_without_image_content'
      ? { attachmentFallbackPolicy: input.attachmentFallbackPolicy }
      : {})
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

export function isContextHistoryRecord(record: ChatMessageRecord): boolean {
  if (isCompactionRecord(record)) {
    return false
  }
  if (record.status === 'sent') {
    return true
  }
  return record.role === 'assistant' && record.status === 'error'
}

function buildNonImageFileContext(
  files: MessageFile[],
  options: {
    excludeAudio?: boolean
    includeFileContent?: boolean
  } = {}
): string {
  const nonImageFiles = files.filter(
    (file) => !isImageAttachment(file) && (!options.excludeAudio || !isAudioFile(file))
  )
  if (nonImageFiles.length === 0) {
    return ''
  }

  const blocks = nonImageFiles.map((file, index) => {
    const isAudio = isAudioFile(file)
    const fileName = typeof file.name === 'string' ? file.name : `file-${index + 1}`
    const filePath = typeof file.path === 'string' ? file.path : ''
    const mimeType = resolveFileMimeType(file)
    const fileContent = typeof file.content === 'string' ? file.content : ''
    const shouldIncludeContent =
      options.includeFileContent === true ||
      (isAudio && !fileContent.trim().toLowerCase().startsWith('data:audio/'))
    const byteSize = resolveFileByteSize(file)
    const metadataLines = [
      `name: ${fileName}`,
      filePath ? `path: ${filePath}` : '',
      mimeType ? `mime: ${mimeType}` : '',
      byteSize ? `size: ${byteSize}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    if (!fileContent.trim()) {
      const placeholder = filePath ? '[omitted; use read if needed]' : '[empty]'
      return `[Attached File ${index + 1}]\n${metadataLines}\ncontent: ${placeholder}`
    }
    if (!shouldIncludeContent) {
      return `[Attached File ${index + 1}]\n${metadataLines}\ncontent: [omitted; use read if needed]`
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
  const imageFiles = files.filter((file) => isImageAttachment(file))
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

function buildResolvedImageRepresentationContext(files: MessageFile[]): string {
  const imageFiles = files.filter((file) => isImageAttachment(file))
  return imageFiles
    .flatMap((file, index) => {
      const resolved = getAttachmentResolvedRepresentation(file)
      if (!resolved || resolved.kind === 'image') return []
      const fileName = typeof file.name === 'string' ? file.name : `image-${index + 1}`
      const mimeType = resolveFileMimeType(file)
      const metadata = [`name: ${fileName}`, `mime: ${mimeType}`].join('\n')
      if (resolved.kind === 'unavailable') {
        return [
          `[Attached Image ${index + 1} - content unavailable]\n${metadata}\nreason: ${resolved.reason}`
        ]
      }

      const escapedText = escapeUntrustedOcrText(resolved.text)
      const truncationNotice = resolved.truncated
        ? '\ntruncated: true\nnote: OCR text was truncated to the attachment limits; omitted text is not available in this message.'
        : ''
      return [
        `[Attached Image ${index + 1} - OCR text; untrusted attachment data]\n${metadata}${truncationNotice}\n<untrusted_ocr_data>\n${escapedText || '[empty]'}\n</untrusted_ocr_data>`
      ]
    })
    .join('\n\n')
}

function escapeUntrustedOcrText(value: string): string {
  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildInlineDisplayText(input: SendMessageInput): string {
  const text = input.text ?? ''
  const inlineItems = Array.isArray(input.inlineItems) ? input.inlineItems : []
  if (inlineItems.length === 0) {
    return text
  }

  const validItems = inlineItems
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) => Number.isInteger(item.offset) && item.offset >= 0 && item.offset <= text.length
    )
    .sort((left, right) => left.item.offset - right.item.offset || left.index - right.index)
  if (validItems.length === 0) {
    return text
  }

  const parts: string[] = []
  let cursor = 0
  for (const { item } of validItems) {
    if (item.offset > cursor) {
      parts.push(text.slice(cursor, item.offset))
    }
    parts.push(item.type === 'skill' ? `[Skill: ${item.skillName}]` : `[File: ${item.fileName}]`)
    cursor = item.offset
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }
  return parts.join('')
}

export function buildUserMessageContent(
  input: SendMessageInput,
  supportsVision: boolean,
  supportsAudioInput: boolean = false,
  options: UserMessageContentBuildOptions = {}
): ChatMessage['content'] {
  const text = buildInlineDisplayText(input)
  const files = Array.isArray(input.files) ? input.files : []
  const includeImageData = options.includeImageData !== false
  const includeAudioData = options.includeAudioData !== false

  const imageFiles = files.filter((file) => isImageAttachment(file))
  const imagePayloadFiles = imageFiles.filter((file) => {
    const resolved = getAttachmentResolvedRepresentation(file)
    return !resolved || resolved.kind === 'image'
  })
  const audioFiles = files.filter((file) => isAudioFile(file))
  const audioParts: Array<{
    type: 'input_audio'
    input_audio: {
      data: string
      media_type: string
      filename?: string
      estimated_tokens?: number
    }
  }> =
    supportsAudioInput && includeAudioData
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
                ...(typeof file.name === 'string' && file.name.trim()
                  ? { filename: file.name }
                  : {}),
                estimated_tokens: estimateAudioInputTokens(file, payload.byteLength)
              }
            }
          ]
        })
      : []

  const excludeAudioFromFallback = supportsAudioInput && audioParts.length > 0
  const nonImageContext = buildNonImageFileContext(files, {
    excludeAudio: excludeAudioFromFallback,
    includeFileContent: options.includeFileContent === true
  })
  const audioMetadata = excludeAudioFromFallback ? buildAudioMetadataContext(audioFiles) : ''
  const shouldBuildImageParts =
    supportsVision && includeImageData && imagePayloadFiles.length > 0
  const imageMetadata = shouldBuildImageParts ? '' : buildImageMetadataContext(imagePayloadFiles)
  const resolvedImageContext = buildResolvedImageRepresentationContext(imageFiles)
  const leadingContext = options.leadingContext?.trim() ?? ''
  const baseText = (
    leadingContext
      ? [leadingContext, nonImageContext, audioMetadata, imageMetadata, resolvedImageContext, text]
      : [text, nonImageContext, audioMetadata, imageMetadata, resolvedImageContext]
  )
    .filter((value) => value.trim())
    .join('\n\n')

  if ((!supportsVision || imageFiles.length === 0) && audioParts.length === 0) {
    return baseText
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

  if (supportsVision && includeImageData) {
    for (const file of imagePayloadFiles) {
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
  const structuredText = [
    baseText,
    shouldBuildImageParts && imageParts.length === 0
      ? buildImageMetadataContext(imagePayloadFiles)
      : ''
  ]
    .filter((value) => value.trim())
    .join('\n\n')
  if (!hasStructuredParts) {
    return structuredText
  }

  const textPart =
    structuredText || buildStructuredAttachmentText(imageParts.length, audioParts.length)
  parts.push({ type: 'text', text: textPart })
  parts.push(...imageParts, ...audioParts)

  return parts
}

export function createUserChatMessage(
  input: SendMessageInput,
  supportsVision: boolean,
  supportsAudioInput: boolean = false,
  leadingContext?: string | null
): ChatMessage {
  return {
    role: 'user',
    content: buildUserMessageContent(input, supportsVision, supportsAudioInput, {
      includeImageData: true,
      includeAudioData: true,
      includeFileContent: false,
      leadingContext
    })
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
  supportsAudioInput: boolean = false,
  userLeadingContext?: string | null
): ChatMessage[] {
  if (isCompactionRecord(record)) {
    return []
  }

  if (record.role === 'user') {
    const parsed = parseUserRecordContent(record.content)
    const message: ChatMessage = {
      role: 'user',
      content: buildUserMessageContent(parsed, supportsVision, supportsAudioInput, {
        includeImageData: false,
        includeAudioData: true,
        includeFileContent: false,
        leadingContext: userLeadingContext
      })
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
  supportsAudioInput: boolean = false,
  userLeadingContextByRecordId?: ReadonlyMap<string, string>
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
          supportsAudioInput,
          userLeadingContextByRecordId?.get(record.id)
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

function selectCompleteTailTurns<T extends TokenizedTurn>(
  turns: T[],
  availableTokens: number
): T[] {
  if (turns.length === 0 || availableTokens <= 0) {
    return []
  }

  const selected = [...turns]
  let total = selected.reduce((sum, turn) => sum + turn.tokens, 0)
  while (selected.length > 0 && total > availableTokens) {
    total -= selected.shift()?.tokens ?? 0
  }
  return selected
}

function buildCacheAwareLeadingMessages(
  systemPrompt: string,
  context: ContextRuntimeContributions
): ChatMessage[] {
  const messages: ChatMessage[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  if (context.checkpoint.message) {
    messages.push(context.checkpoint.message)
  }
  return messages
}

function resolveFiniteInputBudget(
  contextLength: number,
  reserveTokens: number,
  extraReserveTokens: number
): number {
  if (!Number.isFinite(contextLength) || contextLength <= 0) {
    return Number.POSITIVE_INFINITY
  }
  return Math.max(0, contextLength - Math.max(0, reserveTokens) - Math.max(0, extraReserveTokens))
}

function resolvePhysicalInputBudget(contextLength: number, extraReserveTokens: number): number {
  if (!Number.isFinite(contextLength) || contextLength <= 0) {
    return Number.POSITIVE_INFINITY
  }
  return Math.max(0, contextLength - Math.max(0, extraReserveTokens) - 1)
}

function buildCacheAwareOverflowError(input: {
  contextLength: number
  fixedTokens: number
  reserveTokens: number
  extraReserveTokens: number
}): Error {
  return new Error(
    [
      'Request was not sent because it cannot fit within the model context window without dropping the base system prompt, conversation checkpoint, or active turn.',
      `Budget: usable context ${Math.floor(input.contextLength)} tokens, fixed prompt ${input.fixedTokens} tokens, output reserve ${Math.max(0, input.reserveTokens)} tokens, extra reserve ${Math.max(0, input.extraReserveTokens)} tokens.`,
      'Shorten the current input or attachments, reduce active tools or system instructions, lower max output tokens, or increase the model context length.'
    ].join(' ')
  )
}

function stripLeadingUserContext(
  message: ChatMessage,
  leadingContext: string
): { message: ChatMessage; removed: boolean } {
  if (message.role !== 'user' || !leadingContext) {
    return { message, removed: false }
  }

  const stripText = (text: string): { text: string; removed: boolean } => {
    if (text === leadingContext) {
      return { text: '', removed: true }
    }
    const prefix = `${leadingContext}\n\n`
    return text.startsWith(prefix)
      ? { text: text.slice(prefix.length), removed: true }
      : { text, removed: false }
  }

  if (typeof message.content === 'string') {
    const stripped = stripText(message.content)
    return stripped.removed
      ? { message: { ...message, content: stripped.text }, removed: true }
      : { message, removed: false }
  }

  if (!Array.isArray(message.content)) {
    return { message, removed: false }
  }

  const imageCount = message.content.filter((part) => part.type === 'image_url').length
  const audioCount = message.content.filter((part) => part.type === 'input_audio').length
  let removed = false
  const content = message.content.map((part) => {
    if (removed || part.type !== 'text') return part
    const stripped = stripText(part.text)
    if (!stripped.removed) return part
    removed = true
    return {
      ...part,
      text:
        stripped.text ||
        (imageCount > 0 || audioCount > 0
          ? buildStructuredAttachmentText(imageCount, audioCount)
          : '')
    }
  })
  return removed ? { message: { ...message, content }, removed: true } : { message, removed: false }
}

function omitMemoryFromActiveTurn(
  activeTurn: ChatMessage[],
  context: ContextRuntimeContributions
): ChatMessage[] {
  if (!context.memoryIncluded || !context.memory.content) {
    return activeTurn
  }

  let removed = false
  const messages = activeTurn.map((message) => {
    if (removed) return message
    const stripped = stripLeadingUserContext(message, context.memory.content!)
    removed = stripped.removed
    return stripped.message
  })
  if (removed) {
    context.memoryIncluded = false
  }
  return messages
}

function activeTurnContainsMemory(
  activeTurn: ChatMessage[],
  memoryContent: string
): boolean {
  const prefix = `${memoryContent}\n\n`
  return activeTurn.some((message) => {
    if (message.role !== 'user') return false
    if (typeof message.content === 'string') {
      return message.content === memoryContent || message.content.startsWith(prefix)
    }
    return (
      Array.isArray(message.content) &&
      message.content.some(
        (part) =>
          part.type === 'text' &&
          (part.text === memoryContent || part.text.startsWith(prefix))
      )
    )
  })
}

function buildCacheAwareMetadata(input: {
  allCandidateRecords: ChatMessageRecord[]
  cursorRecords: ChatMessageRecord[]
  selectedTurns: HistoryTurn[]
  emittedTurns: HistoryTurn[]
  cursor: number
  context: ContextRuntimeContributions
  resumeTargetId?: string
  includesSystemPrompt: boolean
}): ContextBuildMetadata {
  const selectedRecordIds = new Set(
    input.selectedTurns.flatMap((turn) => turn.records.map((record) => record.id))
  )
  const emittedRecordIds = new Set(
    input.emittedTurns.flatMap((turn) => turn.records.map((record) => record.id))
  )
  const preCursorRecords = input.allCandidateRecords.filter(
    (record) => record.orderSeq < input.cursor && !selectedRecordIds.has(record.id)
  )

  return {
    includedRecords: input.selectedTurns.flatMap((turn) =>
      turn.records.map((record) => ({
        record,
        reason:
          record.id === input.resumeTargetId
            ? ('resume_target' as const)
            : ('selected_history' as const)
      }))
    ),
    excludedRecords: [
      ...input.cursorRecords
        .filter((record) => !emittedRecordIds.has(record.id))
        .map((record) => ({
          record,
          reason: 'empty_after_formatting' as const
        })),
      ...input.cursorRecords
        .filter((record) => emittedRecordIds.has(record.id) && !selectedRecordIds.has(record.id))
        .map((record) => ({
          record,
          reason: 'out_of_budget' as const
        }))
    ],
    summaryCursor: buildSummaryCursorMetadata(preCursorRecords, input.cursor),
    includesSystemPrompt: input.includesSystemPrompt,
    syntheticContributions: getContextSyntheticContributions(input.context)
  }
}

function filterRecordsFromCursor(
  records: ChatMessageRecord[],
  summaryCursorOrderSeq: number
): ChatMessageRecord[] {
  const cursor = Math.max(1, summaryCursorOrderSeq)
  return records.filter((record) => record.orderSeq >= cursor)
}

export function buildCacheAwareContextWithMetadata(
  sessionId: string,
  newUserContent: SendMessageInput,
  systemPrompt: string,
  contextLength: number,
  reserveTokens: number,
  messageStore: SessionTranscript,
  supportsVision: boolean = false,
  options: CacheAwareContextBuildOptions
): ContextBuildResult {
  const supportsAudioInput = options.supportsAudioInput === true
  const context = options.contextContributions
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
  const leadingMessages = buildCacheAwareLeadingMessages(systemPrompt, context)
  const inputBudget = resolveFiniteInputBudget(
    contextLength,
    reserveTokens,
    options.extraReserveTokens ?? 0
  )
  const physicalInputBudget = resolvePhysicalInputBudget(
    contextLength,
    options.extraReserveTokens ?? 0
  )
  let newUserMessage = createUserChatMessage(
    newUserContent,
    supportsVision,
    supportsAudioInput,
    context.memoryIncluded ? context.memory.content : null
  )
  let fixedMessages = [
    ...leadingMessages,
    ...(hasPromptMessageContent(newUserMessage) ? [newUserMessage] : [])
  ]
  let fixedTokens = estimateMessagesTokens(fixedMessages)
  const historyTokens = historyTurns.reduce((total, turn) => total + turn.tokens, 0)

  if (
    fixedTokens + historyTokens > inputBudget &&
    context.memoryIncluded &&
    context.memory.content
  ) {
    context.memoryIncluded = false
    newUserMessage = createUserChatMessage(newUserContent, supportsVision, supportsAudioInput)
    fixedMessages = [
      ...leadingMessages,
      ...(hasPromptMessageContent(newUserMessage) ? [newUserMessage] : [])
    ]
    fixedTokens = estimateMessagesTokens(fixedMessages)
  }

  if (fixedTokens > physicalInputBudget) {
    throw buildCacheAwareOverflowError({
      contextLength,
      fixedTokens,
      reserveTokens,
      extraReserveTokens: options.extraReserveTokens ?? 0
    })
  }

  const selectedTurns = selectCompleteTailTurns(historyTurns, inputBudget - fixedTokens)
  return {
    messages: [
      ...leadingMessages,
      ...flattenTurns(selectedTurns),
      ...(hasPromptMessageContent(newUserMessage) ? [newUserMessage] : [])
    ],
    metadata: buildCacheAwareMetadata({
      allCandidateRecords: contextCandidateRecords,
      cursorRecords: historyRecords,
      selectedTurns,
      emittedTurns: historyTurns,
      cursor,
      context,
      includesSystemPrompt: Boolean(systemPrompt)
    })
  }
}

export function buildCacheAwareResumeContextWithMetadata(
  sessionId: string,
  assistantMessageId: string,
  systemPrompt: string,
  contextLength: number,
  reserveTokens: number,
  messageStore: SessionTranscript,
  supportsVision: boolean = false,
  options: CacheAwareContextBuildOptions
): ContextBuildResult {
  const supportsAudioInput = options.supportsAudioInput === true
  const context = options.contextContributions
  const allMessages = options.historyRecords ?? messageStore.getMessages(sessionId)
  const sortedMessages = [...allMessages].sort((left, right) => left.orderSeq - right.orderSeq)
  const targetMessage = sortedMessages.find((message) => message.id === assistantMessageId)
  const targetOrderSeq = targetMessage?.orderSeq
  const cursor = Math.max(1, options.summaryCursorOrderSeq ?? 1)
  const recordsThroughTarget = sortedMessages.filter(
    (record) => targetOrderSeq === undefined || record.orderSeq <= targetOrderSeq
  )
  const targetIndex = recordsThroughTarget.findIndex((record) => record.id === assistantMessageId)
  let ownerUser: ChatMessageRecord | undefined
  for (let index = targetIndex; index >= 0; index -= 1) {
    if (recordsThroughTarget[index]?.role === 'user') {
      ownerUser = recordsThroughTarget[index]
      break
    }
  }
  if (!ownerUser) {
    context.memoryIncluded = false
  }

  const historyRecords = recordsThroughTarget.filter((record) => {
    if (record.id === assistantMessageId) return true
    if (!isContextHistoryRecord(record)) return false
    return record.orderSeq >= cursor || Boolean(ownerUser && record.orderSeq >= ownerUser.orderSeq)
  })
  const memoryByOwnerId =
    ownerUser && context.memoryIncluded && context.memory.content
      ? new Map([[ownerUser.id, context.memory.content]])
      : undefined
  let historyTurns = buildHistoryTurns(
    historyRecords,
    supportsVision,
    options.preserveInterleavedReasoning ?? false,
    options.preserveEmptyInterleavedReasoning ?? false,
    supportsAudioInput,
    memoryByOwnerId
  )
  let activeTurnIndex = historyTurns.findIndex((turn) =>
    turn.records.some((record) => record.id === assistantMessageId)
  )
  if (activeTurnIndex < 0 && historyTurns.length > 0) {
    activeTurnIndex = historyTurns.length - 1
  }
  let activeTurn = activeTurnIndex >= 0 ? historyTurns[activeTurnIndex] : null
  const historyPrefix = activeTurnIndex >= 0 ? historyTurns.slice(0, activeTurnIndex) : historyTurns
  const leadingMessages = buildCacheAwareLeadingMessages(systemPrompt, context)
  const inputBudget = resolveFiniteInputBudget(
    contextLength,
    reserveTokens,
    options.extraReserveTokens ?? 0
  )
  const physicalInputBudget = resolvePhysicalInputBudget(
    contextLength,
    options.extraReserveTokens ?? 0
  )
  let fixedMessages = [...leadingMessages, ...(activeTurn?.messages ?? [])]
  let fixedTokens = estimateMessagesTokens(fixedMessages)
  const historyPrefixTokens = historyPrefix.reduce((total, turn) => total + turn.tokens, 0)

  if (
    fixedTokens + historyPrefixTokens > inputBudget &&
    activeTurn &&
    context.memoryIncluded &&
    context.memory.content
  ) {
    const messages = omitMemoryFromActiveTurn(activeTurn.messages, context)
    activeTurn = {
      ...activeTurn,
      messages,
      tokens: estimateMessagesTokens(messages)
    }
    historyTurns = historyTurns.map((turn, index) => (index === activeTurnIndex ? activeTurn! : turn))
    fixedMessages = [...leadingMessages, ...messages]
    fixedTokens = estimateMessagesTokens(fixedMessages)
  }

  if (fixedTokens > physicalInputBudget) {
    throw buildCacheAwareOverflowError({
      contextLength,
      fixedTokens,
      reserveTokens,
      extraReserveTokens: options.extraReserveTokens ?? 0
    })
  }

  const selectedHistory = selectCompleteTailTurns(historyPrefix, inputBudget - fixedTokens)
  const selectedTurns = [...selectedHistory, ...(activeTurn ? [activeTurn] : [])]
  const contextCandidateRecords = recordsThroughTarget.filter(isContextHistoryRecord)
  return {
    messages: [...leadingMessages, ...flattenTurns(selectedTurns)],
    metadata: buildCacheAwareMetadata({
      allCandidateRecords: contextCandidateRecords,
      cursorRecords: historyRecords,
      selectedTurns,
      emittedTurns: historyTurns,
      cursor,
      context,
      resumeTargetId: assistantMessageId,
      includesSystemPrompt: Boolean(systemPrompt)
    })
  }
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
  newUserContent: SendMessageInput,
  systemPrompt: string,
  contextLength: number,
  reserveTokens: number,
  messageStore: SessionTranscript,
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
  newUserContent: SendMessageInput,
  systemPrompt: string,
  contextLength: number,
  reserveTokens: number,
  messageStore: SessionTranscript,
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

export function fitCacheAwareMessagesToContextWindow(
  messages: ChatMessage[],
  contextLength: number,
  reserveTokens: number,
  context: ContextRuntimeContributions
): ChatMessage[] {
  if (
    messages.length === 0 ||
    !Number.isFinite(contextLength) ||
    contextLength <= 0
  ) {
    return messages
  }

  let offset = 0
  const leadingMessages: ChatMessage[] = []
  if (messages[offset]?.role === 'system') {
    leadingMessages.push(messages[offset])
    offset += 1
  }
  if (
    context.checkpoint.message &&
    messages[offset]?.role === 'user' &&
    messages[offset]?.content === context.checkpoint.message.content
  ) {
    leadingMessages.push(messages[offset])
    offset += 1
  }

  const turns = buildChatMessageTurns(messages.slice(offset))
  let activeTurn = turns.pop() ?? { messages: [], tokens: 0 }
  if (
    context.memoryIncluded &&
    context.memory.content &&
    !activeTurnContainsMemory(activeTurn.messages, context.memory.content)
  ) {
    context.memoryIncluded = false
  }
  const availableInputTokens = Math.max(0, contextLength - Math.max(0, reserveTokens))
  let totalTokens =
    estimateMessagesTokens(leadingMessages) +
    turns.reduce((sum, turn) => sum + turn.tokens, 0) +
    activeTurn.tokens

  if (totalTokens > availableInputTokens && context.memoryIncluded && context.memory.content) {
    const activeMessages = omitMemoryFromActiveTurn(activeTurn.messages, context)
    if (activeMessages !== activeTurn.messages) {
      activeTurn = {
        messages: activeMessages,
        tokens: estimateMessagesTokens(activeMessages)
      }
      totalTokens =
        estimateMessagesTokens(leadingMessages) +
        turns.reduce((sum, turn) => sum + turn.tokens, 0) +
        activeTurn.tokens
    }
  }

  while (turns.length > 0 && totalTokens > availableInputTokens) {
    totalTokens -= turns.shift()?.tokens ?? 0
  }

  const fixedTokens = estimateMessagesTokens(leadingMessages) + activeTurn.tokens
  if (fixedTokens > Math.max(0, contextLength - 1)) {
    throw buildCacheAwareOverflowError({
      contextLength,
      fixedTokens,
      reserveTokens,
      extraReserveTokens: 0
    })
  }

  return [...leadingMessages, ...flattenTurns(turns), ...activeTurn.messages]
}

export function buildResumeContext(
  sessionId: string,
  assistantMessageId: string,
  systemPrompt: string,
  contextLength: number,
  reserveTokens: number,
  messageStore: SessionTranscript,
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
  messageStore: SessionTranscript,
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
