/**
 * AcpPresenter Event Normalizer
 * Converts ACP_EVENTS to AgenticEventType format and emits via AgenticEventEmitter
 */

import type { AgenticEventEmitter } from '@shared/types/presenters/agentic.presenter.d'
import { ACP_EVENTS } from './events'
import type * as schema from '@agentclientprotocol/sdk/dist/schema.js'

/**
 * Normalizes ACP_EVENTS to AgenticEventType and emits via the provided emitter
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
 *
 * @param acpEvent - The ACP_EVENT type to normalize
 * @param payload - The event payload
 * @param sessionId - The session ID for the event
 * @param emitter - The AgenticEventEmitter to emit normalized events
 */
export function normalizeAndEmit(
  acpEvent: keyof typeof ACP_EVENTS,
  payload: unknown,
  sessionId: string,
  emitter: AgenticEventEmitter
): void {
  if (!payload || typeof payload !== 'object') {
    return
  }

  const data = payload as Record<string, unknown>

  switch (acpEvent) {
    case ACP_EVENTS.SESSION_UPDATE:
      normalizeSessionUpdateEventAndEmit(data, emitter)
      break

    case ACP_EVENTS.PROMPT_COMPLETED:
      emitter.messageEnd(sessionId) // For ACP, sessionId is used as messageId
      break

    case ACP_EVENTS.ERROR:
      emitter.statusChanged('error', new Error(data.error as string))
      break

    default:
      break
  }
}

/**
 * Normalizes SESSION_UPDATE event and emits via emitter
 * SessionNotification has a nested structure with update.content
 */
function normalizeSessionUpdateEventAndEmit(
  data: Record<string, unknown>,
  emitter: AgenticEventEmitter
): void {
  const sessionId = data.sessionId as string
  const notification = data.notification as schema.SessionNotification

  if (!notification || !notification.update) {
    return
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

  // Emit message delta
  emitter.messageDelta(sessionId, contentText, isComplete)
}
