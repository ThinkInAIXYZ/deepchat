import type { ConfigServicePort, MCPToolDefinition } from '@shared/presenter'

export async function getAgentFilteredTools(
  agentId: string,
  isBuiltin: boolean | undefined,
  allTools: MCPToolDefinition[],
  configService: ConfigServicePort
): Promise<MCPToolDefinition[]> {
  if (!agentId) return []

  const selections = await configService.getAgentMcpSelections(agentId, isBuiltin)
  if (!selections?.length) return []

  const selectionSet = new Set(selections)
  return allTools.filter((tool) => selectionSet.has(tool.server?.name))
}
