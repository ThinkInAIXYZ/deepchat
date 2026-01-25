/**
 * AgentPresenter Event Normalizer
 * Converts STREAM_EVENTS to AgenticEventType format and emits via AgenticEventEmitter
 */

import type { AgenticEventEmitter } from '@shared/types/presenters/agentic.presenter.d'
import { STREAM_EVENTS } from '@/events'

/**
 * Normalizes STREAM_EVENTS to AgenticEventType and emits via the provided emitter
 *
 * Event mapping:
 * - STREAM_EVENTS.RESPONSE → AgenticEventType.MESSAGE_DELTA (for content streaming)
 * - STREAM_EVENTS.END → AgenticEventType.MESSAGE_END
 * - STREAM_EVENTS.ERROR → AgenticEventType.ERROR
 *
 * Tool call events are embedded in STREAM_EVENTS.RESPONSE with tool_call fields
 * These are mapped to:
 * - AgenticEventType.TOOL_START (when tool_call: 'start')
 * - AgenticEventType.TOOL_RUNNING (when tool_call: 'running')
 * - AgenticEventType.TOOL_END (when tool_call: 'end')
 *
 * @param streamEvent - The STREAM_EVENT type to normalize
 * @param payload - The event payload
 * @param sessionId - The session ID for the event
 * @param emitter - The AgenticEventEmitter to emit normalized events
 */
export function normalizeAndEmit(
  streamEvent: keyof typeof STREAM_EVENTS,
  payload: unknown,
  _sessionId: string,
  emitter: AgenticEventEmitter
): void {
  if (!payload || typeof payload !== 'object') {
    return
  }

  const data = payload as Record<string, unknown>

  switch (streamEvent) {
    case STREAM_EVENTS.RESPONSE:
      normalizeResponseEventAndEmit(data, emitter)
      break

    case STREAM_EVENTS.END:
      emitter.messageEnd(data.eventId as string)
      break

    case STREAM_EVENTS.ERROR:
      emitter.statusChanged('error', new Error(data.error as string))
      break

    default:
      break
  }
}

/**
 * Normalizes RESPONSE event and emits via emitter
 * Can represent various types: content delta, tool call, reasoning, etc.
 */
function normalizeResponseEventAndEmit(
  data: Record<string, unknown>,
  emitter: AgenticEventEmitter
): void {
  const messageId = data.eventId as string
  const streamKind = data.stream_kind as string

  // Check for explicit tool call state first (before checking for tool_call_id)
  if (data.tool_call === 'start') {
    const toolParams = data.tool_call_params
      ? (JSON.parse(data.tool_call_params as string) as Record<string, unknown>)
      : {}
    emitter.toolStart(data.tool_call_id as string, data.tool_call_name as string, toolParams)
    return
  }

  if (data.tool_call === 'running') {
    emitter.toolRunning(data.tool_call_id as string, 'running')
    return
  }

  if (data.tool_call === 'end') {
    emitter.toolEnd(data.tool_call_id as string, data.tool_call_response_raw)
    return
  }

  // Backward compatibility: if we have tool_call_response but no explicit tool_call state
  // Check this BEFORE tool_call_id, because having a response means it's an END event
  if (data.tool_call_response || data.tool_call_response_raw) {
    emitter.toolEnd(data.tool_call_id as string, data.tool_call_response_raw)
    return
  }

  // Backward compatibility: if we have tool_call_id but no explicit tool_call state
  if (data.tool_call_id || data.tool_call_name) {
    const toolParams = data.tool_call_params
      ? (JSON.parse(data.tool_call_params as string) as Record<string, unknown>)
      : {}
    emitter.toolStart(data.tool_call_id as string, data.tool_call_name as string, toolParams)
    return
  }

  // Special block types (reasoning, image, etc.) - check before content delta
  if (data.reasoning_time) {
    emitter.messageBlock(messageId, 'reasoning', {
      reasoningContent: data.reasoning_content,
      reasoningTime: data.reasoning_time
    })
    return
  }

  if (data.image_data) {
    emitter.messageBlock(messageId, 'image', {
      imageData: data.image_data
    })
    return
  }

  // Content delta events
  const hasContent = data.content || data.reasoning_content
  if (hasContent) {
    emitter.messageDelta(
      messageId,
      (data.content || data.reasoning_content) as string,
      streamKind === 'final'
    )
    return
  }

  // Default to delta for other response types
  emitter.messageDelta(messageId, '', streamKind === 'final')
}

/**
 * Converts SessionInfo from agentic format to DeepChat CONVERSATION settings
 */
export function convertSessionConfigToConversationSettings(config: {
  modelId?: string
  modeId?: string
  [key: string]: unknown
}): {
  providerId?: string
  modelId?: string
  permissionMode?: string
  [key: string]: unknown
} {
  const result: Record<string, unknown> = {}

  if (config.modelId) {
    // For DeepChat, modelId may include provider info (e.g., "openai:gpt-4")
    // We need to extract providerId and modelId
    const parts = config.modelId.split(':')
    if (parts.length === 2) {
      result.providerId = parts[0]
      result.modelId = parts[1]
    } else {
      result.modelId = config.modelId
    }
  }

  // Store modeId as permission mode
  if (config.modeId) {
    result.permissionMode = config.modeId
  }

  return result as {
    providerId?: string
    modelId?: string
    permissionMode?: string
    [key: string]: unknown
  }
}
