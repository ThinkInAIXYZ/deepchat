import { z } from 'zod'
import { WORKFLOW_AGENT_TOOL_NAME, WORKFLOW_AGENT_TOOL_SERVER_NAME } from '@shared/agentTools'
import { WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES } from '@shared/workflow/runtimeProtocol'
import {
  WorkflowPrepareLaunchToolResultSchema,
  type WorkflowLaunchApproval
} from '@shared/workflow/serviceContracts'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'

const MAX_PREPARE_PARAMS_CHARS = 16 * 1024 * 1024
const MAX_PREPARE_RESPONSE_CHARS = 512 * 1024

const WorkflowPrepareLaunchParamsSchema = z
  .object({
    operation: z.literal('prepare_launch'),
    scriptSource: z.string().min(1).max(WORKFLOW_RUNTIME_MAX_SCRIPT_BYTES)
  })
  .passthrough()

export type ParsedWorkflowLaunchApproval = {
  approval: WorkflowLaunchApproval
  scriptSource: string
}

type ParseCacheEntry = {
  type: DisplayAssistantMessageBlock['type']
  status: DisplayAssistantMessageBlock['status']
  toolSource: 'agent' | 'mcp' | undefined
  name: string | undefined
  serverName: string | undefined
  params: string | undefined
  response: string | undefined
  result: ParsedWorkflowLaunchApproval | null
}

const parseCache = new WeakMap<DisplayAssistantMessageBlock, ParseCacheEntry>()

function parseBoundedJson(value: string | undefined, maxChars: number): unknown | null {
  if (!value || value.length > maxChars) {
    return null
  }
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

export function parseWorkflowLaunchApprovalBlock(
  block: DisplayAssistantMessageBlock
): ParsedWorkflowLaunchApproval | null {
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

  let result: ParsedWorkflowLaunchApproval | null = null
  if (
    block.type === 'tool_call' &&
    block.status === 'success' &&
    block.extra?.toolSource === 'agent' &&
    toolCall?.name === WORKFLOW_AGENT_TOOL_NAME &&
    toolCall.server_name === WORKFLOW_AGENT_TOOL_SERVER_NAME
  ) {
    const parsedResult = WorkflowPrepareLaunchToolResultSchema.safeParse(
      parseBoundedJson(toolCall.response, MAX_PREPARE_RESPONSE_CHARS)
    )
    if (parsedResult.success) {
      const params = WorkflowPrepareLaunchParamsSchema.safeParse(
        parseBoundedJson(toolCall.params, MAX_PREPARE_PARAMS_CHARS)
      )
      if (params.success) {
        result = {
          approval: parsedResult.data.approval,
          scriptSource: params.data.scriptSource
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
