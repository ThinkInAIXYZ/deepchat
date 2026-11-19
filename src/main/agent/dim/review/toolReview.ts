import type { ChatMessage } from '@shared/types/core/chat-message'
import type { AssistantMessageBlock, ChatMessageRecord } from '@shared/types/agent-interface'
import type { DimToolReviewDecision, DimToolReviewRequest } from '../productGateway'
import {
  AUTO_APPROVE_REVIEW_MAX_RECENT_MESSAGES,
  reviewAutoApproveToolPermission,
  type ToolPermissionReviewerDependencies
} from './toolPermissionReviewer'
import type { ToolPermissionReviewRequest } from './types'
import { truncateReviewText } from './reviewText'

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
  bridgedTool?(
    nativeSessionId: string,
    name: string
  ): Promise<{ name: string; serverName: string } | null>
}

function reviewMessages(record: ChatMessageRecord): ChatMessage[] {
  const text = (content: string): ChatMessage[] => [{ role: record.role, content }]
  try {
    const parsed = JSON.parse(record.content) as unknown
    if (typeof parsed === 'string') return text(parsed)
    if (record.role === 'user') {
      const content = (parsed as { text?: unknown } | null)?.text
      return typeof content === 'string' ? text(content) : []
    }
    if (!Array.isArray(parsed)) return []
    return (parsed as AssistantMessageBlock[]).flatMap((block): ChatMessage[] => {
      if (!block) return []
      if (block.type === 'tool_call' && typeof block.tool_call?.response === 'string') {
        const call = block.tool_call
        const name = call.name ?? 'unknown tool'
        return [
          {
            role: 'tool',
            tool_call_id: call.id,
            content: truncateReviewText(
              `${name} ${block.status === 'error' ? 'error' : 'result'}:\n${call.response}`,
              undefined,
              'head-and-tail'
            )
          }
        ]
      }
      if ((block.type === 'content' || block.type === 'error') && typeof block.content === 'string')
        return text(block.content)
      return []
    })
  } catch {
    return text(record.content)
  }
}

function recentMessages(records: ChatMessageRecord[]): ChatMessage[] {
  return records.slice(-AUTO_APPROVE_REVIEW_MAX_RECENT_MESSAGES).flatMap(reviewMessages)
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
    const bridged = request.toolName.startsWith('deepchat_mcp_')
      ? await options.bridgedTool?.(request.sessionId, request.toolName)
      : undefined
    if (request.toolName.startsWith('deepchat_mcp_') && !bridged) return 'ask_user'
    const records = await options.messages(owner.sessionId)
    owner.assertCurrent()
    const toolName = bridged?.name ?? request.toolName
    const result = await reviewAutoApproveToolPermission(
      options.reviewer,
      {
        sessionId: owner.sessionId,
        messageId: records.at(-1)?.id ?? '',
        toolCallId: request.callId,
        toolName,
        toolArgs: JSON.stringify(request.arguments),
        ...(bridged
          ? { toolSource: 'mcp', serverName: bridged.serverName }
          : { toolSource: 'agent' }),
        permission: permissionOf({ ...request, toolName }),
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
