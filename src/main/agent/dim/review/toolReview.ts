import type { ChatMessage } from '@shared/types/core/chat-message'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { DimToolReviewDecision, DimToolReviewRequest } from '../productGateway'
import {
  AUTO_APPROVE_REVIEW_MAX_RECENT_MESSAGES,
  reviewAutoApproveToolPermission,
  type ToolPermissionReviewerDependencies
} from './toolPermissionReviewer'
import type { ToolPermissionReviewRequest } from './types'

export interface DimToolReviewOptions {
  reviewer: ToolPermissionReviewerDependencies
  /** Resolves the bound desktop owner of a native session, or throws when it has none. */
  owner(
    nativeSessionId: string,
    signal: AbortSignal
  ): Promise<{
    sessionId: string
    providerId: string
    modelId: string
    assertCurrent(): void
  }>
  messages(sessionId: string): ChatMessageRecord[] | Promise<ChatMessageRecord[]>
}

/** Text the reviewer sees for one stored message; tool output stays out of the transcript view. */
function recordText(record: ChatMessageRecord): string {
  try {
    const parsed = JSON.parse(record.content) as unknown
    if (typeof parsed === 'string') return parsed
    if (record.role === 'user')
      return typeof (parsed as { text?: unknown }).text === 'string'
        ? (parsed as { text: string }).text
        : ''
    if (!Array.isArray(parsed)) return ''
    return parsed
      .filter((block) => block?.type === 'content' && typeof block.content === 'string')
      .map((block) => block.content as string)
      .join('\n')
  } catch {
    return record.content
  }
}

function recentMessages(records: ChatMessageRecord[]): ChatMessage[] {
  return records
    .slice(-AUTO_APPROVE_REVIEW_MAX_RECENT_MESSAGES)
    .map((record) => ({ role: record.role, content: recordText(record) }))
}

function permissionOf(request: DimToolReviewRequest): ToolPermissionReviewRequest['permission'] {
  const command = typeof request.arguments.command === 'string' ? request.arguments.command : ''
  const path = typeof request.arguments.path === 'string' ? request.arguments.path : ''
  if (request.risk === 'execute_process')
    return { permissionType: 'command', description: 'Start a process', command }
  return {
    permissionType: request.risk === 'read_filesystem' ? 'read' : 'write',
    description: `Use ${request.toolName}`,
    ...(path ? { paths: [path] } : {})
  }
}

/**
 * Reviews one native call dim would ask the user about. Any failure answers `ask_user`, which
 * leaves dim's own approval prompt in place.
 */
export function createDimToolReview(options: DimToolReviewOptions) {
  return async (
    request: DimToolReviewRequest,
    signal: AbortSignal
  ): Promise<DimToolReviewDecision> => {
    const owner = await options.owner(request.sessionId, signal)
    const records = await options.messages(owner.sessionId)
    owner.assertCurrent()
    const result = await reviewAutoApproveToolPermission(
      options.reviewer,
      {
        sessionId: owner.sessionId,
        messageId: records.at(-1)?.id ?? '',
        toolCallId: request.callId,
        toolName: request.toolName,
        toolArgs: JSON.stringify(request.arguments),
        toolSource: 'agent',
        permission: permissionOf(request),
        reason: 'requires_permission'
      },
      {
        providerId: owner.providerId,
        modelId: owner.modelId,
        messages: recentMessages(records),
        signal
      }
    )
    owner.assertCurrent()
    return result.decision
  }
}
