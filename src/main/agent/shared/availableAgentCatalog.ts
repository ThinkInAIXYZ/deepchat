import type { Agent } from '@shared/types/agent-interface'
import type { IConfigPresenter } from '@shared/presenter'

export async function listAvailableAgents(
  configPresenter: Pick<IConfigPresenter, 'listAgents' | 'getAcpEnabled'>
): Promise<Agent[]> {
  const [agents, acpEnabled] = await Promise.all([
    configPresenter.listAgents(),
    configPresenter.getAcpEnabled()
  ])
  return agents.filter((agent) => agent.type === 'deepchat' || acpEnabled)
}
