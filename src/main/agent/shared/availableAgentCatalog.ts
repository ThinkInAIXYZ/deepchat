import type { Agent } from '@shared/types/agent-interface'
import type { ConfigServicePort } from '@shared/presenter'

export async function listAvailableAgents(
  configService: Pick<ConfigServicePort, 'listAgents' | 'getAcpEnabled'>
): Promise<Agent[]> {
  const [agents, acpEnabled] = await Promise.all([
    configService.listAgents(),
    configService.getAcpEnabled()
  ])
  return agents.filter((agent) => agent.type === 'deepchat' || acpEnabled)
}
