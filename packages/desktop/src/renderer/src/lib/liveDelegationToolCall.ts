import { z } from 'zod'
import {
  LIVE_DELEGATION_AGENT_TOOL_NAME,
  LIVE_DELEGATION_AGENT_TOOL_SERVER_NAME
} from '@shared/agentTools'
import {
  LIVE_DELEGATION_MAX_TITLE_LENGTH,
  LiveDelegationDetailSchema,
  type LiveDelegationSummary
} from '@shared/orchestration/liveDelegation'
import { parseChildAgentResultEnvelope } from '@shared/orchestration/resultSafety'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'

const MAX_SPAWN_PARAMS_CHARACTERS = 512 * 1024
const MAX_SPAWN_RESPONSE_CHARACTERS = 512 * 1024

const LiveDelegationSpawnParamsSchema = z
  .object({
    operation: z.literal('spawn'),
    slotId: z.string().trim().min(1).max(256),
    title: z.string().trim().min(1).max(LIVE_DELEGATION_MAX_TITLE_LENGTH)
  })
  .passthrough()

export type ParsedLiveDelegationSpawn = {
  slotId: string
  title: string
  delegation: LiveDelegationSummary | null
}

type ParseCacheEntry = {
  type: DisplayAssistantMessageBlock['type']
  status: DisplayAssistantMessageBlock['status']
  toolSource: 'agent' | 'mcp' | undefined
  name: string | undefined
  serverName: string | undefined
  params: string | undefined
  response: string | undefined
  result: ParsedLiveDelegationSpawn | null
}

const parseCache = new WeakMap<DisplayAssistantMessageBlock, ParseCacheEntry>()

function parseBoundedJson(value: string | undefined, maxCharacters: number): unknown | null {
  if (!value || value.length > maxCharacters) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

export function parseLiveDelegationSpawnBlock(
  block: DisplayAssistantMessageBlock
): ParsedLiveDelegationSpawn | null {
  const toolCall = block.tool_call
  const cached = parseCache.get(block)
  if (
    cached?.type === block.type &&
    cached.status === block.status &&
    cached.toolSource === block.extra?.toolSource &&
    cached.name === toolCall?.name &&
    cached.serverName === toolCall?.server_name &&
    cached.params === toolCall?.params &&
    cached.response === toolCall?.response
  ) {
    return cached.result
  }

  let result: ParsedLiveDelegationSpawn | null = null
  if (
    block.type === 'tool_call' &&
    block.extra?.toolSource === 'agent' &&
    toolCall?.name === LIVE_DELEGATION_AGENT_TOOL_NAME &&
    toolCall.server_name === LIVE_DELEGATION_AGENT_TOOL_SERVER_NAME
  ) {
    const params = LiveDelegationSpawnParamsSchema.safeParse(
      parseBoundedJson(toolCall.params, MAX_SPAWN_PARAMS_CHARACTERS)
    )
    if (params.success) {
      if (block.status === 'success') {
        const response = parseBoundedJson(toolCall.response, MAX_SPAWN_RESPONSE_CHARACTERS)
        const envelope = parseChildAgentResultEnvelope(response)
        const detail = LiveDelegationDetailSchema.safeParse(
          envelope?.source.operation === 'spawn' ? envelope.payload.value : response
        )
        if (
          detail.success &&
          detail.data.delegation.slotId === params.data.slotId &&
          detail.data.delegation.title === params.data.title
        ) {
          result = {
            slotId: params.data.slotId,
            title: params.data.title,
            delegation: detail.data.delegation
          }
        }
      } else {
        result = {
          slotId: params.data.slotId,
          title: params.data.title,
          delegation: null
        }
      }
    }
  }

  parseCache.set(block, {
    type: block.type,
    status: block.status,
    toolSource: block.extra?.toolSource,
    name: toolCall?.name,
    serverName: toolCall?.server_name,
    params: toolCall?.params,
    response: toolCall?.response,
    result
  })
  return result
}
