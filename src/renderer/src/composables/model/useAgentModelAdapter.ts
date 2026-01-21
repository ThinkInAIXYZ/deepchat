import { usePresenter } from '@/composables/usePresenter'
import type { AcpAgentConfig } from '@shared/presenter'

export type AgentModelAdapter = {
  getAcpEnabled: () => Promise<boolean>
  getAcpAgents: () => Promise<AcpAgentConfig[]>
}

export const useAgentModelAdapter = (): AgentModelAdapter => {
  const configPresenter = usePresenter('configPresenter')

  return {
    getAcpEnabled: () => Promise.resolve(configPresenter.getAcpEnabled()),
    getAcpAgents: () => Promise.resolve(configPresenter.getAcpAgents())
  }
}
