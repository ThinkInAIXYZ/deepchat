import type { AssistantMessageBlock, ChatMessagePageResult } from '@shared/types/agent-interface'
import {
  WORKFLOW_WAITING_INTERACTIONS_MAX_ITEMS,
  WORKFLOW_WAITING_INTERACTION_LABEL_MAX_LENGTH,
  WORKFLOW_WAITING_INTERACTION_TOOL_NAME_MAX_LENGTH,
  WorkflowWaitingInteractionProjectionSchema,
  type WorkflowWaitingInteractionProjection
} from '@shared/workflow/projection'

const MAX_SCANNED_MESSAGES = 100

export interface WorkflowInteractionTranscriptPort {
  listMessagesPage(
    sessionId: string,
    options: {
      limit: number
    }
  ): ChatMessagePageResult
}

export function projectWorkflowWaitingInteractions(
  transcript: WorkflowInteractionTranscriptPort,
  childSessionId: string
): WorkflowWaitingInteractionProjection[] {
  const page = transcript.listMessagesPage(childSessionId, { limit: MAX_SCANNED_MESSAGES })
  const projected: WorkflowWaitingInteractionProjection[] = []

  for (let messageIndex = page.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = page.messages[messageIndex]
    if (message.role !== 'assistant') {
      continue
    }
    const blocks = parseAssistantBlocks(message.content)
    for (const candidate of blocks) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        continue
      }
      const block = candidate as AssistantMessageBlock
      if (
        block.type !== 'action' ||
        block.status !== 'pending' ||
        block.extra?.needsUserAction === false ||
        (block.action_type !== 'tool_call_permission' && block.action_type !== 'question_request')
      ) {
        continue
      }
      const toolCallId = block.tool_call?.id?.trim()
      if (!toolCallId) {
        continue
      }
      const projection = WorkflowWaitingInteractionProjectionSchema.safeParse({
        kind: block.action_type === 'question_request' ? 'question' : 'permission',
        messageId: message.id,
        toolCallId,
        toolName: truncateOptional(
          block.tool_call?.name,
          WORKFLOW_WAITING_INTERACTION_TOOL_NAME_MAX_LENGTH
        ),
        label: resolveInteractionLabel(block)
      })
      if (projection.success) {
        projected.push(projection.data)
      }
      if (projected.length >= WORKFLOW_WAITING_INTERACTIONS_MAX_ITEMS) {
        return projected
      }
    }
  }

  return projected
}

function parseAssistantBlocks(content: string): unknown[] {
  try {
    const value = JSON.parse(content)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function resolveInteractionLabel(block: AssistantMessageBlock): string | null {
  if (block.action_type === 'question_request') {
    return truncateOptional(
      block.extra?.questionText ?? block.extra?.questionHeader,
      WORKFLOW_WAITING_INTERACTION_LABEL_MAX_LENGTH
    )
  }
  return truncateOptional(
    block.extra?.permissionRequest ?? block.extra?.toolName,
    WORKFLOW_WAITING_INTERACTION_LABEL_MAX_LENGTH
  )
}

function truncateOptional(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : null
}
