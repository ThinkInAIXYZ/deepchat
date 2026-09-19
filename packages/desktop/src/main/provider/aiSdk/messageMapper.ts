import type { ChatMessage, ChatMessageContent } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/mcp'
import { generateId, type FilePart, type ModelMessage, type TextPart } from 'ai'
import { applyLegacyFunctionCallPrompt } from './middlewares/legacyFunctionCallMiddleware'
import {
  buildFunctionCallRecordContent,
  serializeChatMessageContent,
  splitMergedToolContent,
  toToolResultOutput,
  tryParseJson
} from './toolProtocol'

type PendingToolCall = {
  id: string
  name: string
  args?: string
}

type AiSdkProviderOptions = NonNullable<ModelMessage['providerOptions']>
type MappedUserContentPart = TextPart | FilePart
type UserAudioContentPart = Extract<ChatMessageContent, { type: 'input_audio' }>

const OPENAI_AUDIO_MEDIA_TYPES = new Set(['audio/wav', 'audio/mp3', 'audio/mpeg'])
const OPENAI_COMPATIBLE_AUDIO_FALLBACK_MEDIA_TYPE = 'audio/mpeg'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function sanitizeProviderOptions(
  providerOptions: Record<string, unknown> | undefined
): AiSdkProviderOptions | undefined {
  if (!isPlainObject(providerOptions)) {
    return undefined
  }

  const sanitizedEntries = Object.entries(providerOptions).filter(
    (entry): entry is [string, AiSdkProviderOptions[string]] => isPlainObject(entry[1])
  )

  return sanitizedEntries.length > 0 ? Object.fromEntries(sanitizedEntries) : undefined
}

function hasOwnReasoningContent(message: ChatMessage): boolean {
  return Object.prototype.hasOwnProperty.call(message, 'reasoning_content')
}

function resolveImageMediaType(value: string): string | undefined {
  const dataUrlMatch = value.match(/^data:([^;,]+)[;,]/i)
  if (dataUrlMatch?.[1]) {
    return dataUrlMatch[1]
  }

  const normalized = value.toLowerCase()
  if (normalized.endsWith('.png')) return 'image/png'
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg'
  if (normalized.endsWith('.webp')) return 'image/webp'
  if (normalized.endsWith('.gif')) return 'image/gif'

  return undefined
}

function resolveImageFileData(value: string): FilePart['data'] {
  if (value.startsWith('data:')) {
    return value
  }

  try {
    return new URL(value)
  } catch {
    return value
  }
}

function mapImageUserContentPart(
  part: Extract<ChatMessageContent, { type: 'image_url' }>
): FilePart | null {
  const imageUrl = part.image_url?.url
  if (typeof imageUrl !== 'string' || !imageUrl) {
    return null
  }

  return {
    type: 'file',
    data: resolveImageFileData(imageUrl),
    mediaType: resolveImageMediaType(imageUrl) ?? 'image'
  }
}

function normalizeAudioMediaType(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return undefined
  }

  const [mediaType] = normalized.split(';', 1)
  return mediaType?.trim() || undefined
}

function supportsOpenAIAudioMediaType(value: string | undefined): boolean {
  const mediaType = normalizeAudioMediaType(value)
  if (!mediaType) {
    return false
  }

  return OPENAI_AUDIO_MEDIA_TYPES.has(mediaType)
}

function buildAudioProviderOptions(
  part: UserAudioContentPart,
  options: MapMessagesToModelMessagesOptions,
  mediaType: string
): AiSdkProviderOptions | undefined {
  if (!options.preferOpenAICompatibleAudioDataUrl) {
    return sanitizeProviderOptions(part.provider_options)
  }

  const baseProviderOptions = isPlainObject(part.provider_options) ? part.provider_options : {}
  const existingOpenAICompatible = isPlainObject(baseProviderOptions.openaiCompatible)
    ? baseProviderOptions.openaiCompatible
    : {}

  return sanitizeProviderOptions({
    ...baseProviderOptions,
    openaiCompatible: {
      ...existingOpenAICompatible,
      input_audio: {
        data: `data:${mediaType};base64,${part.input_audio.data}`
      }
    }
  })
}

function mapAudioUserContentPart(
  part: UserAudioContentPart,
  options: MapMessagesToModelMessagesOptions
): FilePart | null {
  const actualMediaType = normalizeAudioMediaType(part.input_audio.media_type)
  if (!actualMediaType?.startsWith('audio/') || !part.input_audio.data) {
    return null
  }

  const mediaType = options.preferOpenAICompatibleAudioDataUrl
    ? supportsOpenAIAudioMediaType(actualMediaType)
      ? actualMediaType
      : OPENAI_COMPATIBLE_AUDIO_FALLBACK_MEDIA_TYPE
    : actualMediaType

  const providerOptions = buildAudioProviderOptions(part, options, mediaType)

  return {
    type: 'file',
    data: part.input_audio.data,
    mediaType,
    ...(typeof part.input_audio.filename === 'string' && part.input_audio.filename.trim()
      ? { filename: part.input_audio.filename }
      : {}),
    ...(providerOptions ? { providerOptions } : {})
  }
}

function mapUserContent(
  content: ChatMessage['content'],
  options: MapMessagesToModelMessagesOptions
): MappedUserContentPart[] {
  if (typeof content === 'string' || content == null) {
    return [
      {
        type: 'text',
        text: content ?? ''
      }
    ]
  }

  const mappedContent: MappedUserContentPart[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) {
      continue
    }

    switch (part.type) {
      case 'text': {
        if (typeof part.text === 'string') {
          mappedContent.push({
            type: 'text',
            text: part.text
          })
        }
        continue
      }
      case 'image_url': {
        const mappedImage = mapImageUserContentPart(part)
        if (mappedImage) {
          mappedContent.push(mappedImage)
        }
        continue
      }
      case 'input_audio': {
        if (part.input_audio) {
          const mappedAudio = mapAudioUserContentPart(part, options)
          if (mappedAudio) {
            mappedContent.push(mappedAudio)
          }
        }
        continue
      }
      default: {
        const exhaustiveCheck: never = part
        void exhaustiveCheck
      }
    }
  }

  return mappedContent
}

function mapAssistantTextAndReasoning(message: ChatMessage): any[] {
  const content: any[] = []

  if (hasOwnReasoningContent(message)) {
    content.push({
      type: 'reasoning',
      text: message.reasoning_content ?? '',
      ...(sanitizeProviderOptions(message.reasoning_provider_options)
        ? { providerOptions: sanitizeProviderOptions(message.reasoning_provider_options) }
        : {})
    })
  }

  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type !== 'text' || !part.text) {
        continue
      }

      content.push({
        type: 'text',
        text: part.text,
        ...(sanitizeProviderOptions(part.provider_options)
          ? { providerOptions: sanitizeProviderOptions(part.provider_options) }
          : {})
      })
    }

    return content
  }

  const text = serializeChatMessageContent(message.content)
  if (text) {
    content.push({
      type: 'text',
      text,
      ...(sanitizeProviderOptions(message.provider_options)
        ? { providerOptions: sanitizeProviderOptions(message.provider_options) }
        : {})
    })
  }

  return content
}

export interface MapMessagesToModelMessagesOptions {
  tools: MCPToolDefinition[]
  supportsNativeTools: boolean
  buildLegacyFunctionCallPrompt?: (tools: MCPToolDefinition[]) => string
  preserveOpenAICompatibleReasoningContent?: boolean
  preferOpenAICompatibleAudioDataUrl?: boolean
  mapProviderReplay?: (replay: NonNullable<ChatMessage['provider_replay']>) => unknown
}

function buildAssistantProviderOptions(
  message: ChatMessage,
  options: MapMessagesToModelMessagesOptions
): AiSdkProviderOptions | undefined {
  if (!options.preserveOpenAICompatibleReasoningContent || !hasOwnReasoningContent(message)) {
    return undefined
  }

  return sanitizeProviderOptions({
    ...message.provider_options,
    openaiCompatible: {
      ...message.provider_options?.openaiCompatible,
      reasoning_content: message.reasoning_content ?? ''
    }
  })
}

function buildAssistantModelMessage(
  message: ChatMessage,
  content: any[],
  options: MapMessagesToModelMessagesOptions
): ModelMessage {
  const providerOptions = buildAssistantProviderOptions(message, options)
  return {
    role: 'assistant',
    content,
    ...(providerOptions ? { providerOptions } : {})
  } as ModelMessage
}

export function mapMessagesToModelMessages(
  messages: ChatMessage[],
  options: MapMessagesToModelMessagesOptions
): ModelMessage[] {
  const pendingNativeToolCalls: PendingToolCall[] = []
  const pendingMockToolCalls: PendingToolCall[] = []

  const enqueueNativeToolCall = (id: string, name: string, args?: string) => {
    pendingNativeToolCalls.push({ id, name, args })
  }

  const enqueueMockToolCall = (id: string, name: string, args?: string) => {
    pendingMockToolCalls.push({ id, name, args })
  }

  const consumeToolCall = (
    source: PendingToolCall[],
    preferredId?: string
  ): PendingToolCall | undefined => {
    if (preferredId) {
      const index = source.findIndex((toolCall) => toolCall.id === preferredId)
      if (index !== -1) {
        return source.splice(index, 1)[0]
      }
    }

    return source.shift()
  }

  const modelMessages = messages.reduce<ModelMessage[]>((acc, message) => {
    if (message.role === 'system') {
      acc.push({
        role: 'system',
        content: serializeChatMessageContent(message.content)
      })
      return acc
    }

    if (message.role === 'user') {
      acc.push({
        role: 'user',
        content: mapUserContent(message.content, options)
      })
      return acc
    }

    if (message.role === 'assistant') {
      const assistantContent = mapAssistantTextAndReasoning(message)
      if (message.provider_replay && options.mapProviderReplay) {
        assistantContent.push(options.mapProviderReplay(message.provider_replay))
      }

      if (message.tool_calls?.length) {
        if (options.supportsNativeTools) {
          for (const toolCall of message.tool_calls) {
            const toolCallId = toolCall.id || `tool-call-${generateId()}`
            const rawArgs = toolCall.function.arguments
            enqueueNativeToolCall(toolCallId, toolCall.function.name, rawArgs)
            assistantContent.push({
              type: 'tool-call',
              toolCallId,
              toolName: toolCall.function.name,
              ...(sanitizeProviderOptions(toolCall.provider_options)
                ? { providerOptions: sanitizeProviderOptions(toolCall.provider_options) }
                : {}),
              input:
                typeof rawArgs === 'string' ? (tryParseJson(rawArgs) ?? { raw: rawArgs }) : rawArgs
            })
          }

          acc.push(buildAssistantModelMessage(message, assistantContent, options))
        } else {
          if (assistantContent.length > 0) {
            acc.push(buildAssistantModelMessage(message, assistantContent, options))
          }

          for (const toolCall of message.tool_calls) {
            enqueueMockToolCall(
              toolCall.id || `tool-call-${generateId()}`,
              toolCall.function.name,
              toolCall.function.arguments
            )
          }
        }

        return acc
      }

      if (assistantContent.length > 0) {
        acc.push(buildAssistantModelMessage(message, assistantContent, options))
      }
      return acc
    }

    if (message.role === 'tool') {
      const serialized =
        typeof message.content === 'string'
          ? message.content
          : serializeChatMessageContent(message.content)

      if (options.supportsNativeTools) {
        const splitParts =
          pendingNativeToolCalls.length > 1 && !message.tool_call_id
            ? splitMergedToolContent(serialized, pendingNativeToolCalls.length)
            : null

        if (splitParts) {
          acc.push(
            ...(splitParts
              .map((part) => {
                const pending = consumeToolCall(pendingNativeToolCalls)
                if (!pending) {
                  return undefined
                }

                return {
                  role: 'tool' as const,
                  content: [
                    {
                      type: 'tool-result',
                      toolCallId: pending.id,
                      toolName: pending.name,
                      output: toToolResultOutput(part)
                    }
                  ]
                } as ModelMessage
              })
              .filter(Boolean) as ModelMessage[])
          )

          return acc
        }

        const pending = consumeToolCall(pendingNativeToolCalls, message.tool_call_id)
        acc.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: pending?.id || message.tool_call_id || `tool-result-${generateId()}`,
              toolName: pending?.name || 'unknown',
              output: toToolResultOutput(serialized),
              ...(sanitizeProviderOptions(message.provider_options)
                ? { providerOptions: sanitizeProviderOptions(message.provider_options) }
                : {})
            }
          ]
        } as ModelMessage)

        return acc
      }

      const splitParts =
        pendingMockToolCalls.length > 1 && !message.tool_call_id
          ? splitMergedToolContent(serialized, pendingMockToolCalls.length)
          : null

      if (splitParts) {
        for (const part of splitParts) {
          const pending = consumeToolCall(pendingMockToolCalls)
          if (!pending) {
            continue
          }

          acc.push({
            role: 'user',
            content: [
              {
                type: 'text',
                text: buildFunctionCallRecordContent(
                  pending.name,
                  tryParseJson(pending.args || '{}') ?? {},
                  part
                )
              }
            ]
          } as ModelMessage)
        }

        return acc
      }

      const pending = consumeToolCall(pendingMockToolCalls, message.tool_call_id)
      acc.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildFunctionCallRecordContent(
              pending?.name || 'unknown',
              tryParseJson(pending?.args || '{}') ?? {},
              serialized
            )
          }
        ]
      } as ModelMessage)
    }

    return acc
  }, [])

  if (!options.supportsNativeTools && options.tools.length > 0) {
    return applyLegacyFunctionCallPrompt(
      modelMessages,
      options.tools,
      options.buildLegacyFunctionCallPrompt
    )
  }

  return modelMessages
}
