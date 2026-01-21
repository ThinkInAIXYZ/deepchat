import { usePresenter } from '@/composables/usePresenter'
import type { IPresenter } from '@shared/presenter'

type GetAgentMcpSelections = IPresenter['configPresenter']['getAgentMcpSelections']

export type ChatAdapter = {
  getAgentMcpSelections: GetAgentMcpSelections
}

export function useChatAdapter(): ChatAdapter {
  const configPresenter = usePresenter('configPresenter')

  return {
    getAgentMcpSelections: (agentId: string) => configPresenter.getAgentMcpSelections(agentId)
  }
}
