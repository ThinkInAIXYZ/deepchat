import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import {
  buildAssistantDeliverySegments as buildDeliverySegments,
  type AssistantDeliverySegment
} from '@shared/lib/assistantDeliverySegments'

export type DeepChatInternalSessionRuntimeStatus = 'idle' | 'generating' | 'error'

export interface DeepChatInternalSessionWaitingInteraction {
  type: 'permission' | 'question'
  messageId: string
  toolCallId: string
  actionBlock: AssistantMessageBlock
}

export interface DeepChatInternalSessionUpdate {
  sessionId: string
  kind: 'blocks' | 'status'
  updatedAt: number
  messageId?: string
  status?: DeepChatInternalSessionRuntimeStatus
  previewMarkdown?: string
  responseMarkdown?: string
  deliverySegments?: AssistantDeliverySegment[]
  waitingInteraction?: DeepChatInternalSessionWaitingInteraction | null
  usage?: Record<string, number>
}

const extractBlockText = (block: AssistantMessageBlock): string[] => {
  if (block.type === 'action') {
    const questionText =
      typeof block.extra?.questionText === 'string' ? block.extra.questionText : ''
    const permissionText =
      typeof block.content === 'string'
        ? block.content
        : typeof block.extra?.permissionRequest === 'string'
          ? block.extra.permissionRequest
          : ''

    return [questionText || permissionText]
  }

  if (block.type === 'tool_call') {
    return [typeof block.tool_call?.response === 'string' ? block.tool_call.response : '']
  }

  if (block.type === 'error') {
    return [typeof block.content === 'string' ? block.content : '']
  }

  return [typeof block.content === 'string' ? block.content : '']
}

const toDisplayLines = (text: string): string[] => text.split(/\r?\n/)

export const buildAssistantResponseMarkdown = (blocks: AssistantMessageBlock[]): string =>
  blocks
    .flatMap((block) => extractBlockText(block))
    .flatMap((text) => toDisplayLines(text))
    .join('\n')

export const buildAssistantPreviewMarkdown = (blocks: AssistantMessageBlock[]): string => {
  const lines = buildAssistantResponseMarkdown(blocks)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return lines.slice(-3).join('\n')
}

export const buildAssistantDeliverySegments = (
  messageId: string,
  blocks: AssistantMessageBlock[]
): AssistantDeliverySegment[] => buildDeliverySegments(messageId, blocks)

export const extractWaitingInteraction = (
  blocks: AssistantMessageBlock[],
  messageId: string
): DeepChatInternalSessionWaitingInteraction | null => {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (
      block.type !== 'action' ||
      block.status !== 'pending' ||
      block.extra?.needsUserAction !== true ||
      !block.tool_call?.id
    ) {
      continue
    }

    if (block.action_type === 'tool_call_permission') {
      return {
        type: 'permission',
        messageId,
        toolCallId: block.tool_call.id,
        actionBlock: JSON.parse(JSON.stringify(block)) as AssistantMessageBlock
      }
    }

    if (block.action_type === 'question_request') {
      return {
        type: 'question',
        messageId,
        toolCallId: block.tool_call.id,
        actionBlock: JSON.parse(JSON.stringify(block)) as AssistantMessageBlock
      }
    }
  }

  return null
}
