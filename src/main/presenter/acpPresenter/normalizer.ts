/**
 * AcpPresenter Event Normalizer
 * Converts ACP_EVENTS to AgenticEventType format
 */

import type { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'
import { ACP_EVENTS } from './events'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'

/**
 * Normalizer result contains the unified event type and transformed payload
 */
export interface NormalizedEvent {
  eventType: AgenticEventType
  payload: unknown
}

/**
 * Normalizes ACP_EVENTS to AgenticEventType
 *
 * Event mapping:
 * - ACP_EVENTS.SESSION_UPDATE → AgenticEventType.MESSAGE_DELTA (for content chunks)
 * - ACP_EVENTS.PROMPT_COMPLETED → AgenticEventType.MESSAGE_END
 * - ACP_EVENTS.ERROR → AgenticEventType.ERROR
 *
 * Tool call events are embedded in ACP_EVENTS.SESSION_UPDATE with notification data
 * These are mapped to:
 * - AgenticEventType.TOOL_START (when tool call starts)
 * - AgenticEventType.TOOL_RUNNING (when tool is running)
 * - AgenticEventType.TOOL_END (when tool call ends)
 */
export function normalizeAcpEvent(
  acpEvent: keyof typeof ACP_EVENTS,
  payload: unknown
): NormalizedEvent | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const data = payload as Record<string, unknown>

  switch (acpEvent) {
    case ACP_EVENTS.SESSION_UPDATE:
      return normalizeSessionUpdateEvent(data)

    case ACP_EVENTS.PROMPT_COMPLETED:
      return {
        eventType: 'agentic.message.end' as AgenticEventType,
        payload: {
          sessionId: data.sessionId,
          messageId: data.sessionId // For ACP, sessionId is used as messageId
        }
      }

    case ACP_EVENTS.ERROR:
      return {
        eventType: 'agentic.error' as AgenticEventType,
        payload: {
          sessionId: data.sessionId,
          error: new Error(data.error as string)
        }
      }

    default:
      return null
  }
}

/**
 * Normalizes SESSION_UPDATE event
 * SessionNotification has a nested structure with update.content
 */
function normalizeSessionUpdateEvent(data: Record<string, unknown>): NormalizedEvent | null {
  const sessionId = data.sessionId as string
  const notification = data.notification as schema.SessionNotification

  if (!notification || !notification.update) {
    return null
  }

  // SessionNotification.update is a union type with different update kinds
  const update = notification.update as any

  // Extract content based on update type
  let contentText = ''
  let isComplete = false

  if (update.content) {
    if (typeof update.content === 'string') {
      contentText = update.content
    } else if (update.content.text) {
      contentText = update.content.text
    } else if (update.content.data) {
      contentText = update.content.data
    }
  }

  // Check session update type
  if (update.sessionUpdate) {
    isComplete = update.sessionUpdate === 'complete'
  }

  // Default to message delta
  return {
    eventType: 'agentic.message.delta' as AgenticEventType,
    payload: {
      sessionId,
      messageId: sessionId,
      content: contentText,
      isComplete
    }
  }
}
