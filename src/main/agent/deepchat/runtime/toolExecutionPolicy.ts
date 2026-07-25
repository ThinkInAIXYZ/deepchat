import type { PermissionMode } from '@shared/types/agent-interface'
import type {
  MCPToolDefinition,
  ToolExecutionMode
} from '@shared/types/core/mcp'

type ToolCallTarget = {
  name: string
}

type ToolBatchExecutionPolicyInput = {
  permissionMode: PermissionMode
  toolCalls: readonly ToolCallTarget[]
  toolDefinitions: readonly MCPToolDefinition[]
}

export function selectToolBatchExecutionMode({
  permissionMode,
  toolCalls,
  toolDefinitions
}: ToolBatchExecutionPolicyInput): ToolExecutionMode {
  if (permissionMode !== 'full_access' || toolCalls.length < 2) {
    return 'sequential'
  }

  const definitionsByName = new Map<string, MCPToolDefinition | null>()
  for (const definition of toolDefinitions) {
    const name = definition?.function?.name
    if (typeof name !== 'string' || name.length === 0) {
      continue
    }

    definitionsByName.set(name, definitionsByName.has(name) ? null : definition)
  }

  const canRunInParallel = toolCalls.every((toolCall) => {
    const name = toolCall?.name
    if (typeof name !== 'string' || name.length === 0) {
      return false
    }
    const definition = definitionsByName.get(name)
    return definition?.execution?.effect === 'read' && definition.execution.mode === 'parallel'
  })

  return canRunInParallel ? 'parallel' : 'sequential'
}
