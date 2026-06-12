import type { DeepchatBridge } from '@shared/contracts/bridge'
import { toolsListDefinitionsRoute } from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createToolClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getAllToolDefinitions(context: {
    enabledMcpTools?: string[]
    disabledAgentTools?: string[]
    chatMode?: 'agent' | 'acp agent'
    supportsVision?: boolean
    agentWorkspacePath?: string | null
    conversationId?: string
  }) {
    const result = await bridge.invoke(toolsListDefinitionsRoute.name, context)
    return result.tools
  }

  return {
    getAllToolDefinitions
  }
}

export type ToolClient = ReturnType<typeof createToolClient>
