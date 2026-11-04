import type { DeepChatOutputPort } from './output'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import type { SessionTranscriptPort } from '@/session/data/contracts'
import {
  buildAssistantDeliverySegments,
  buildAssistantPreviewMarkdown,
  buildAssistantResponseMarkdown,
  extractWaitingInteraction
} from './sessionUpdates'
import { resolveStreamRequestId, type StreamRequestIdRegistry } from './streamRequestId'

export type MessageProjectionTranscript = Pick<
  SessionTranscriptPort,
  'getMessage' | 'updateAssistantContent'
>

export interface MessageProjectionServiceDependencies {
  registry: StreamRequestIdRegistry
  transcript: MessageProjectionTranscript
  output: DeepChatOutputPort
}

export class MessageProjectionService {
  constructor(private readonly deps: MessageProjectionServiceDependencies) {}

  refresh(sessionId: string, messageId: string): void {
    this.deps.output.streamCompleted({
      requestId: resolveStreamRequestId(this.deps.registry, sessionId, messageId),
      sessionId,
      messageId,
      completedAt: Date.now()
    })

    const message = this.deps.transcript.getMessage(messageId)
    if (!message || message.role !== 'assistant') {
      return
    }

    try {
      const blocks = JSON.parse(message.content) as AssistantMessageBlock[]
      this.deps.output.sessionUpdate({
        sessionId,
        kind: 'blocks',
        updatedAt: Date.now(),
        messageId,
        previewMarkdown: buildAssistantPreviewMarkdown(blocks),
        responseMarkdown: buildAssistantResponseMarkdown(blocks),
        deliverySegments: buildAssistantDeliverySegments(messageId, blocks),
        waitingInteraction: extractWaitingInteraction(blocks, messageId)
      })
    } catch (error) {
      console.warn('[DeepChatAgent] Failed to emit internal message refresh:', error)
    }
  }

  updateSubagentToolCallProgress(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    responseMarkdown: string,
    progressJson?: string,
    finalJson?: string
  ): void {
    try {
      const message = this.deps.transcript.getMessage(messageId)
      if (!message || message.role !== 'assistant') {
        return
      }

      const blocks = JSON.parse(message.content) as AssistantMessageBlock[]
      const toolBlock = blocks.find(
        (block) => block.type === 'tool_call' && block.tool_call?.id === toolCallId
      )
      if (!toolBlock?.tool_call) {
        return
      }

      toolBlock.tool_call.response = responseMarkdown
      toolBlock.status = finalJson ? 'success' : 'loading'
      toolBlock.extra = {
        ...toolBlock.extra,
        ...(typeof progressJson === 'string' ? { subagentProgress: progressJson } : {}),
        ...(finalJson ? { subagentFinal: finalJson } : {})
      }
      this.deps.transcript.updateAssistantContent(messageId, blocks)
      this.refresh(sessionId, messageId)
    } catch (error) {
      console.warn('[DeepChatAgent] Failed to persist subagent tool progress:', error)
    }
  }
}
