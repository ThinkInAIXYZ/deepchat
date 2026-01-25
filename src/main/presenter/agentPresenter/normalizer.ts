/**
 * AgentPresenter Event Normalizer
 * Converts STREAM_EVENTS to AgenticEventType format
 */

import type { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'
import { STREAM_EVENTS } from '@/events'

/**
 * Normalizer result contains the unified event type and transformed payload
 */
export interface NormalizedEvent {
  eventType: AgenticEventType
  payload: unknown
}

/**
 * Normalizes STREAM_EVENTS to AgenticEventType
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
 */
export function normalizeEvent(
  streamEvent: keyof typeof STREAM_EVENTS,
  payload: unknown
): NormalizedEvent | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const data = payload as Record<string, unknown>

  switch (streamEvent) {
    case STREAM_EVENTS.RESPONSE:
      return normalizeResponseEvent(data)

    case STREAM_EVENTS.END:
      return {
        eventType: 'agentic.message.end' as AgenticEventType,
        payload: {
          sessionId: data.conversationId,
          messageId: data.eventId
        }
      }

    case STREAM_EVENTS.ERROR:
      return {
        eventType: 'agentic.error' as AgenticEventType,
        payload: {
          sessionId: data.conversationId,
          error: new Error(data.error as string)
        }
      }

    default:
      return null
  }
}

/**
 * Normalizes RESPONSE event
 * Can represent various types: content delta, tool call, reasoning, etc.
 */
function normalizeResponseEvent(data: Record<string, unknown>): NormalizedEvent | null {
  const sessionId = data.conversationId as string
  const messageId = data.eventId as string
  const streamKind = data.stream_kind as string

  // Check for tool call events
  if (data.tool_call === 'start' || data.tool_call_id || data.tool_call_name) {
    return {
      eventType: 'agentic.tool.start' as AgenticEventType,
      payload: {
        sessionId,
        toolId: data.tool_call_id as string,
        toolName: data.tool_call_name as string,
        arguments: data.tool_call_params ? JSON.parse(data.tool_call_params as string) : {}
      }
    }
  }

  if (data.tool_call === 'running') {
    return {
      eventType: 'agentic.tool.running' as AgenticEventType,
      payload: {
        sessionId,
        toolId: data.tool_call_id as string,
        status: 'running'
      }
    }
  }

  if (data.tool_call === 'end' || data.tool_call_response) {
    return {
      eventType: 'agentic.tool.end' as AgenticEventType,
      payload: {
        sessionId,
        toolId: data.tool_call_id as string,
        result: data.tool_call_response_raw
      }
    }
  }

  // Content delta events
  const hasContent = data.content || data.reasoning_content
  if (hasContent) {
    return {
      eventType: 'agentic.message.delta' as AgenticEventType,
      payload: {
        sessionId,
        messageId,
        content: (data.content || data.reasoning_content) as string,
        isComplete: streamKind === 'final'
      }
    }
  }

  // Other block types (reasoning, image, etc.)
  if (data.reasoning_time) {
    return {
      eventType: 'agentic.message.block' as AgenticEventType,
      payload: {
        sessionId,
        messageId,
        blockType: 'reasoning',
        content: {
          reasoningContent: data.reasoning_content,
          reasoningTime: data.reasoning_time
        }
      }
    }
  }

  if (data.image_data) {
    return {
      eventType: 'agentic.message.block' as AgenticEventType,
      payload: {
        sessionId,
        messageId,
        blockType: 'text',
        content: {
          imageData: data.image_data
        }
      }
    }
  }

  // Default to delta for other response types
  return {
    eventType: 'agentic.message.delta' as AgenticEventType,
    payload: {
      sessionId,
      messageId,
      content: '',
      isComplete: streamKind === 'final'
    }
  }
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
