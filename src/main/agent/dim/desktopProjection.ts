import type { SessionEventPublisher } from '@/events/sessionEventRouter'
import type { SessionStatusPublisherPorts, DeepChatOutputPort } from '@/agent/shared/output'
import {
  buildAssistantDeliverySegments,
  buildAssistantPreviewMarkdown,
  buildAssistantResponseMarkdown,
  extractWaitingInteraction
} from '@/agent/shared/sessionUpdates'
import type {
  AssistantMessageBlock,
  MessageMetadata,
  SessionStatus
} from '@shared/types/agent-interface'
import type { DimProjection } from './messageProjection'
import type { DimEvent } from './sessionConnection'

interface ProjectionOptions {
  output: DeepChatOutputPort
  publishEvent: SessionEventPublisher
  publishStatus: SessionStatusPublisherPorts['publishStatus']
  completed(sessionId: string): void
  committed?(sessionId: string, event: DimEvent): void
  reset?(sessionId: string): void
}

/** Publishes desktop views of committed native facts. It cannot advance execution. */
export class DimDesktopProjection {
  private readonly observedStatus = new Map<string, SessionStatus>()
  private readonly startedAt = Date.now()
  constructor(private readonly options: ProjectionOptions) {}

  apply(projection: DimProjection): void {
    const { binding, messages, completed } = projection
    const sessionId = binding.sessionId
    if (projection.event) this.options.committed?.(sessionId, projection.event)
    if (projection.resetTranscript) this.options.reset?.(sessionId)
    const previous = this.observedStatus.get(sessionId)
    this.observedStatus.set(sessionId, binding.status)
    if (previous !== binding.status)
      this.options.publishStatus({
        sessionId,
        status: binding.status,
        changed: true,
        updatedAt: Date.now()
      })
    const changedRecords = messages.filter(
      (message) =>
        message.role === 'user' ||
        message.status !== 'pending' ||
        (JSON.parse(message.metadata) as MessageMetadata).dim?.revision === 0
    )
    if (changedRecords.length)
      this.options.publishEvent('sessions.messages.changed', {
        sessionId,
        messages: changedRecords,
        version: Date.now()
      })
    if (
      projection.inputEvents?.some((event) => event.type === 'input') ||
      projection.consumedInputs?.length ||
      projection.retractions?.length
    )
      this.options.publishEvent('sessions.pendingInputs.changed', {
        sessionId,
        version: Date.now()
      })
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      const metadata = JSON.parse(message.metadata) as MessageMetadata
      const blocks = JSON.parse(message.content) as AssistantMessageBlock[]
      const requestId = binding.activeTurnId ?? completed?.requestId
      if (!requestId) continue
      this.options.output.streamSnapshot({
        kind: 'snapshot',
        requestId,
        sessionId,
        messageId: message.id,
        updatedAt: message.updatedAt,
        revision: metadata.dim?.revision ?? 0,
        blocks
      })
      this.options.output.sessionUpdate({
        sessionId,
        kind: 'blocks',
        messageId: message.id,
        updatedAt: message.updatedAt,
        responseMarkdown: buildAssistantResponseMarkdown(blocks),
        previewMarkdown: buildAssistantPreviewMarkdown(blocks),
        deliverySegments: buildAssistantDeliverySegments(message.id, blocks),
        waitingInteraction: extractWaitingInteraction(blocks, message.id)
      })
      const usage = {
        inputTokens: metadata.inputTokens ?? 0,
        outputTokens: metadata.outputTokens ?? 0,
        totalTokens: metadata.totalTokens ?? 0,
        cachedInputTokens: metadata.cachedInputTokens ?? 0
      }
      if (Object.values(usage).some((value) => value > 0))
        this.options.publishStatus({
          sessionId,
          status: binding.status,
          changed: false,
          updatedAt: message.updatedAt,
          usage
        })
    }
    if (completed) {
      const terminal = messages.find((message) => message.id === completed.messageId)
      if (completed.error)
        this.options.output.streamFailed({
          sessionId,
          requestId: completed.requestId,
          messageId: completed.messageId,
          failedAt: terminal?.updatedAt ?? Date.now(),
          error: completed.error
        })
      else
        this.options.output.streamCompleted({
          sessionId,
          requestId: completed.requestId,
          messageId: completed.messageId,
          completedAt: terminal?.updatedAt ?? Date.now()
        })
      if (
        terminal &&
        terminal.updatedAt >= this.startedAt &&
        (JSON.parse(terminal.metadata) as MessageMetadata).runOutcome === 'completed'
      )
        this.options.completed(sessionId)
    }
  }

  forget(sessionId: string): void {
    this.observedStatus.delete(sessionId)
  }
}
