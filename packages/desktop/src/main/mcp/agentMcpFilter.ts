import type { AgentSettingsPort } from '@/agent/settings'
import type { MCPToolDefinition } from '@shared/types/mcp'

export async function getAgentFilteredTools(
  agentId: string,
  isBuiltin: boolean | undefined,
  allTools: MCPToolDefinition[],
  agentSettings: Pick<AgentSettingsPort, 'getAgentMcpSelections'>
): Promise<MCPToolDefinition[]> {
  if (!agentId) return []

  const selections = await agentSettings.getAgentMcpSelections(agentId, isBuiltin)
  if (!selections?.length) return []

  const selectionSet = new Set(selections)
  return allTools.filter((tool) => selectionSet.has(tool.server?.name))
}
