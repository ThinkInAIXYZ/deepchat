import { LIVE_DELEGATION_AGENT_TOOL_NAME } from '@shared/agentTools'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { DeepChatTaskContractContext } from '@shared/types/task-contract'
import {
  ExecutionContractError,
  isToolEffectWithinCeiling
} from '@/tape/domain/executionContract'
import {
  isDeepChatTaskContract,
  isDeepChatTaskContractRef
} from '@/tape/domain/taskContract'

function requestedSubagentDepth(tool: MCPToolDefinition): number {
  return tool.source === 'agent' && tool.function.name === LIVE_DELEGATION_AGENT_TOOL_NAME ? 1 : 0
}

export function meetTaskContractToolDefinitions(
  sessionId: string,
  tools: readonly MCPToolDefinition[],
  context: DeepChatTaskContractContext | null
): MCPToolDefinition[] {
  if (context === null) return [...tools]
  if (
    !isDeepChatTaskContract(context.contract) ||
    !isDeepChatTaskContractRef(context.localRef) ||
    context.localRef.sessionId !== sessionId ||
    context.localRef.contractHash !== context.contract.contractHash
  ) {
    throw new ExecutionContractError(
      'TaskContract context does not belong to the tool catalog Session.',
      'invalid_input'
    )
  }

  const ceilings = context.contract.taskHarness.ceilings
  return tools.filter(
    (tool) =>
      isToolEffectWithinCeiling(tool.execution.effect, ceilings.maxToolEffect) &&
      requestedSubagentDepth(tool) <= ceilings.maxSubagentDepth
  )
}

export function resolveExecutionContractSubagentDepth(
  tools: readonly MCPToolDefinition[]
): number {
  return tools.some((tool) => requestedSubagentDepth(tool) > 0) ? 1 : 0
}
