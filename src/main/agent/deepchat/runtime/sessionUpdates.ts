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

function isWaitingInteractionBlock(block: AssistantMessageBlock): boolean {
  return (
    block.type === 'action' &&
    block.status === 'pending' &&
    block.extra?.needsUserAction !== false &&
    Boolean(block.tool_call?.id) &&
    (block.action_type === 'tool_call_permission' || block.action_type === 'question_request')
  )
}

function hasSubagentWaitingInteraction(block: AssistantMessageBlock): boolean {
  if (block.type !== 'tool_call' || block.tool_call?.name !== 'subagent_orchestrator') return false
  const rawProgress = block.extra?.subagentProgress
  if (typeof rawProgress !== 'string' || !rawProgress.trim()) return false
  try {
    const progress = JSON.parse(rawProgress) as { tasks?: unknown }
    if (!Array.isArray(progress?.tasks)) return false
    return progress.tasks.some((task) => {
      if (!task || typeof task !== 'object' || Array.isArray(task)) return false
      const candidate = task as { sessionId?: unknown; waitingInteraction?: unknown }
      if (typeof candidate.sessionId !== 'string' || !candidate.sessionId) return false
      const waiting = candidate.waitingInteraction
      if (!waiting || typeof waiting !== 'object' || Array.isArray(waiting)) return false
      const interaction = waiting as {
        type?: unknown
        messageId?: unknown
        toolCallId?: unknown
        actionBlock?: unknown
      }
      return (
        (interaction.type === 'permission' || interaction.type === 'question') &&
        typeof interaction.messageId === 'string' &&
        Boolean(interaction.messageId) &&
        typeof interaction.toolCallId === 'string' &&
        Boolean(interaction.toolCallId) &&
        Boolean(interaction.actionBlock) &&
        typeof interaction.actionBlock === 'object' &&
        !Array.isArray(interaction.actionBlock)
      )
    })
  } catch {
    return false
  }
}

export const hasWaitingInteraction = (blocks: AssistantMessageBlock[]): boolean =>
  blocks.some((block) => isWaitingInteractionBlock(block) || hasSubagentWaitingInteraction(block))

export const extractWaitingInteraction = (
  blocks: AssistantMessageBlock[],
  messageId: string
): DeepChatInternalSessionWaitingInteraction | null => {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (!isWaitingInteractionBlock(block)) continue
    const toolCallId = block.tool_call?.id
    if (!toolCallId) continue

    if (block.action_type === 'tool_call_permission') {
      return {
        type: 'permission',
        messageId,
        toolCallId,
        actionBlock: JSON.parse(JSON.stringify(block)) as AssistantMessageBlock
      }
    }

    if (block.action_type === 'question_request') {
      return {
        type: 'question',
        messageId,
        toolCallId,
        actionBlock: JSON.parse(JSON.stringify(block)) as AssistantMessageBlock
      }
    }
  }

  return null
}
