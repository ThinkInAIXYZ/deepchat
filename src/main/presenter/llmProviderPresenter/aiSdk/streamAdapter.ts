import { createStreamEvent, type LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { ChatMessageProviderOptions } from '@shared/types/core/chat-message'
import type { ToolSet, TextStreamPart } from 'ai'
import { parseLegacyFunctionCalls } from './toolProtocol'

const FUNCTION_CALL_TAG = '<function_call>'
const FUNCTION_CALL_CLOSE_TAG = '</function_call>'

function resolveSafeTextLength(buffer: string): number {
  const maxCheck = Math.min(buffer.length, FUNCTION_CALL_TAG.length - 1)

  for (let suffixLength = maxCheck; suffixLength > 0; suffixLength -= 1) {
    if (FUNCTION_CALL_TAG.startsWith(buffer.slice(-suffixLength))) {
      return buffer.length - suffixLength
    }
  }

  return buffer.length
}

function mapFinishReason(
  reason: string | undefined
): 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error' | 'complete' {
  switch (reason) {
    case 'tool-calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'error':
      return 'error'
    case 'stop':
      return 'stop_sequence'
    default:
      return 'complete'
  }
}

function toUsageEvent(usage: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  inputTokenDetails?: {
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
}): LLMCoreStreamEvent {
  return createStreamEvent.usage({
    prompt_tokens: usage.inputTokens ?? 0,
    completion_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    ...(usage.inputTokenDetails?.cacheReadTokens
      ? { cached_tokens: usage.inputTokenDetails.cacheReadTokens }
      : {}),
    ...(usage.inputTokenDetails?.cacheWriteTokens
      ? { cache_write_tokens: usage.inputTokenDetails.cacheWriteTokens }
      : {})
  })
}

function toProviderOptions(value: unknown): ChatMessageProviderOptions | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as ChatMessageProviderOptions
}

export interface AdaptAiSdkStreamOptions {
  supportsNativeTools: boolean
  cacheImage?: (data: string) => Promise<string>
}

export async function* adaptAiSdkStream(
  fullStream: AsyncIterable<TextStreamPart<ToolSet>>,
  options: AdaptAiSdkStreamOptions
): AsyncGenerator<LLMCoreStreamEvent> {
  const toolArgumentBuffers = new Map<string, string>()
  const endedToolCalls = new Set<string>()
  let bufferedLegacyText = ''

  const emitLegacyTextBuffer = async function* (
    flushAll = false
  ): AsyncGenerator<LLMCoreStreamEvent> {
    while (true) {
      const startIndex = bufferedLegacyText.indexOf(FUNCTION_CALL_TAG)

      if (startIndex === -1) {
        const safeLength = flushAll
          ? bufferedLegacyText.length
          : resolveSafeTextLength(bufferedLegacyText)
        if (safeLength > 0) {
          yield createStreamEvent.text(bufferedLegacyText.slice(0, safeLength))
          bufferedLegacyText = bufferedLegacyText.slice(safeLength)
        }
        return
      }

      if (startIndex > 0) {
        yield createStreamEvent.text(bufferedLegacyText.slice(0, startIndex))
        bufferedLegacyText = bufferedLegacyText.slice(startIndex)
      }

      const endIndex = bufferedLegacyText.indexOf(FUNCTION_CALL_CLOSE_TAG)
      if (endIndex === -1) {
        return
      }

      const blockEnd = endIndex + FUNCTION_CALL_CLOSE_TAG.length
      const block = bufferedLegacyText.slice(0, blockEnd)
      bufferedLegacyText = bufferedLegacyText.slice(blockEnd)

      const toolCalls = parseLegacyFunctionCalls(block)
      if (!toolCalls.length) {
        yield createStreamEvent.text(block)
        continue
      }

      for (const toolCall of toolCalls) {
        yield createStreamEvent.toolCallStart(toolCall.id, toolCall.function.name)
        yield createStreamEvent.toolCallChunk(toolCall.id, toolCall.function.arguments)
        yield createStreamEvent.toolCallEnd(toolCall.id, toolCall.function.arguments)
      }
    }
  }

  for await (const part of fullStream) {
    switch (part.type) {
      case 'text-delta': {
        if (options.supportsNativeTools) {
          yield createStreamEvent.text(part.text, toProviderOptions((part as any).providerMetadata))
          break
        }

        bufferedLegacyText += part.text
        yield* emitLegacyTextBuffer(false)
        break
      }

      case 'reasoning-delta':
        yield createStreamEvent.reasoning(
          part.text,
          toProviderOptions((part as any).providerMetadata)
        )
        break

      case 'tool-input-start':
        toolArgumentBuffers.set(part.id, '')
        yield createStreamEvent.toolCallStart(
          part.id,
          part.toolName,
          toProviderOptions((part as any).providerMetadata)
        )
        break

      case 'tool-input-delta':
        toolArgumentBuffers.set(part.id, `${toolArgumentBuffers.get(part.id) ?? ''}${part.delta}`)
        yield createStreamEvent.toolCallChunk(
          part.id,
          part.delta,
          toProviderOptions((part as any).providerMetadata)
        )
        break

      case 'tool-input-end':
        endedToolCalls.add(part.id)
        yield createStreamEvent.toolCallEnd(
          part.id,
          toolArgumentBuffers.get(part.id),
          toProviderOptions((part as any).providerMetadata)
        )
        break

      case 'tool-call':
        if (!endedToolCalls.has(part.toolCallId)) {
          const serializedInput = JSON.stringify(part.input ?? {})
          const providerOptions = toProviderOptions((part as any).providerMetadata)
          yield createStreamEvent.toolCallStart(part.toolCallId, part.toolName, providerOptions)
          yield createStreamEvent.toolCallChunk(part.toolCallId, serializedInput, providerOptions)
          yield createStreamEvent.toolCallEnd(part.toolCallId, serializedInput, providerOptions)
          endedToolCalls.add(part.toolCallId)
        }
        break

      case 'file': {
        const mediaType = part.file.mediaType
        if (!mediaType.startsWith('image/')) {
          break
        }

        const dataUrl = `data:${mediaType};base64,${part.file.base64}`
        const cachedImage = options.cacheImage ? await options.cacheImage(dataUrl) : dataUrl

        yield createStreamEvent.imageData({
          data: cachedImage,
          mimeType: mediaType
        })
        break
      }

      case 'finish':
        if (!options.supportsNativeTools) {
          yield* emitLegacyTextBuffer(true)
        }
        yield toUsageEvent(part.totalUsage)
        yield createStreamEvent.stop(mapFinishReason(part.finishReason))
        break

      case 'error':
        yield createStreamEvent.error(
          part.error instanceof Error ? part.error.message : String(part.error)
        )
        yield createStreamEvent.stop('error')
        break
    }
  }
}
