import type { Agent } from '@shared/types/agent-interface'
import type { AgentSettingsPort } from '@/agent/settings'

export async function listAvailableAgents(
  agentSettings: Pick<AgentSettingsPort, 'listAgents' | 'getAcpEnabled'>
): Promise<Agent[]> {
  const [agents, acpEnabled] = await Promise.all([
    agentSettings.listAgents(),
    agentSettings.getAcpEnabled()
  ])
  return agents.filter((agent) => agent.type === 'deepchat' || acpEnabled)
}
