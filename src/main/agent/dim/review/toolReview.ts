import type { ChatMessage } from '@shared/types/core/chat-message'
import type { AssistantMessageBlock, ChatMessageRecord } from '@shared/types/agent-interface'
import type {
  DimProductToolDefinition,
  DimToolReviewDecision,
  DimToolReviewRequest
} from '../productGateway'
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
  catalog(
    nativeSessionId: string
  ): Promise<{ tools: Pick<DimProductToolDefinition, 'name' | 'metadata'>[] }>
}

type BridgedTool = { name: string; serverName: string }

async function reviewMessages(
  record: ChatMessageRecord,
  bridgedTool: (name: string) => Promise<BridgedTool | undefined>
): Promise<ChatMessage[]> {
  const text = (content: string): ChatMessage[] => [{ role: record.role, content }]
  let parsed: unknown
  try {
    parsed = JSON.parse(record.content)
  } catch {
    return text(record.content)
  }
  if (typeof parsed === 'string') return text(parsed)
  if (record.role === 'user') {
    const content = (parsed as { text?: unknown } | null)?.text
    return typeof content === 'string' ? text(content) : []
  }
  if (!Array.isArray(parsed)) return []
  const messages: ChatMessage[] = []
  for (const block of parsed as AssistantMessageBlock[]) {
    if (!block) continue
    if (block.type === 'tool_call' && typeof block.tool_call?.response === 'string') {
      const call = block.tool_call
      let name = call.name ?? 'unknown tool'
      if (typeof name === 'string' && name.startsWith('deepchat_mcp_')) {
        if (typeof block.extra?.toolName === 'string' && block.extra.toolName) {
          name = block.extra.toolName
        } else {
          const tool = await bridgedTool(name)
          if (tool) name = `${tool.serverName} / ${tool.name}`
        }
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: truncateReviewText(
          `${name} ${block.status === 'error' ? 'error' : 'result'}:\n${call.response}`,
          undefined,
          'head-and-tail'
        )
      })
    } else if (
      (block.type === 'content' || block.type === 'error') &&
      typeof block.content === 'string'
    ) {
      messages.push(...text(block.content))
    }
  }
  return messages
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
    let catalog: ReturnType<DimToolReviewOptions['catalog']> | undefined
    async function bridgedTool(name: string): Promise<BridgedTool | undefined> {
      catalog ??= options.catalog(request.sessionId)
      const metadata = (await catalog).tools.find((tool) => tool.name === name)?.metadata
      if (
        typeof metadata?.deepchatMcpTool === 'string' &&
        typeof metadata.deepchatServer === 'string'
      )
        return { name: metadata.deepchatMcpTool, serverName: metadata.deepchatServer }
      return undefined
    }
    const isMcp = request.toolName.startsWith('deepchat_mcp_')
    const bridged = isMcp ? await bridgedTool(request.toolName) : undefined
    if (isMcp && !bridged) return 'ask_user'
    const records = await options.messages(owner.sessionId)
    const messages = await Promise.all(
      records
        .slice(-AUTO_APPROVE_REVIEW_MAX_RECENT_MESSAGES)
        .map((record) => reviewMessages(record, bridgedTool))
    )
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
        messages: messages.flat(),
        signal
      }
    )
    owner.assertCurrent()
    return result.decision
  }
}
