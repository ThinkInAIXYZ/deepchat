import type { MCPToolDefinition } from '@shared/presenter'
import type { IAgentConfigPresenter } from '@shared/types/presenters/agentConfig.presenter'

export async function getAgentFilteredTools(
  agentId: string,
  _isBuiltin: boolean | undefined,
  allTools: MCPToolDefinition[],
  agentConfigPresenter: IAgentConfigPresenter
): Promise<MCPToolDefinition[]> {
  if (!agentId) return []

  const selections = await agentConfigPresenter.getAgentMcpSelections(agentId)
  if (!selections?.length) return []

  const selectionSet = new Set(selections)
  return allTools.filter((tool) => selectionSet.has(tool.server?.name))
}
