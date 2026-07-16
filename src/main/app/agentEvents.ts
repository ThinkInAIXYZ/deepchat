import type { AgentSettingsPort } from '@/agent/settings'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'

export function emitAgentCatalogChanged(
  agentSettings: AgentSettingsPort,
  agentIds?: string[]
): void {
  void Promise.all([agentSettings.getAcpEnabled(), agentSettings.getAcpAgents()])
    .then(([enabled, agents]) => {
      publishDeepchatEvent('config.agents.changed', {
        enabled,
        agents,
        agentIds,
        version: Date.now()
      })
    })
    .catch((error) => {
      console.error('Failed to publish typed agents changed event:', error)
    })
}

export function emitAcpAgentModelsChanged(): void {
  publishDeepchatEvent('models.changed', {
    reason: 'agents',
    providerId: 'acp',
    version: Date.now()
  })
}
