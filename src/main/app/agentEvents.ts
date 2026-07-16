import type { AgentSettingsPort } from '@/agent/settings'
import type { DeepchatEventPublisher } from '@shared/contracts/events'

export function emitAgentCatalogChanged(
  agentSettings: AgentSettingsPort,
  publishEvent: DeepchatEventPublisher,
  agentIds?: string[]
): void {
  void Promise.all([agentSettings.getAcpEnabled(), agentSettings.getAcpAgents()])
    .then(([enabled, agents]) => {
      publishEvent('config.agents.changed', {
        enabled,
        agents: agents.map((agent) => ({ ...agent })),
        agentIds,
        version: Date.now()
      })
    })
    .catch((error) => {
      console.error('Failed to publish typed agents changed event:', error)
    })
}

export function emitAcpAgentModelsChanged(publishEvent: DeepchatEventPublisher): void {
  publishEvent('models.changed', {
    reason: 'agents',
    providerId: 'acp',
    version: Date.now()
  })
}
