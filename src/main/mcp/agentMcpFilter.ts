import type { IConfigPresenter, MCPToolDefinition } from '@shared/presenter'

export async function getAgentFilteredTools(
  agentId: string,
  isBuiltin: boolean | undefined,
  allTools: MCPToolDefinition[],
  configPresenter: IConfigPresenter
): Promise<MCPToolDefinition[]> {
  if (!agentId) return []

  const selections = await configPresenter.getAgentMcpSelections(agentId, isBuiltin)
  if (!selections?.length) return []

  const selectionSet = new Set(selections)
  return allTools.filter((tool) => selectionSet.has(tool.server?.name))
}
