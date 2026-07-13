import type { IConfigPresenter, ILlmProviderPresenter } from '@shared/presenter'
import type { ProviderCatalogPort as PresenterProviderCatalogPort } from '../presenter/runtimePorts'

export interface ProviderExecutionPort {
  testConnection(
    providerId: string,
    modelId?: string
  ): Promise<{
    isOk: boolean
    errorMsg: string | null
  }>
}

export type ProviderCatalogPort = Pick<
  PresenterProviderCatalogPort,
  'getAgentType' | 'getProviderModels' | 'getCustomModels'
>

export function createPresenterHotPathPorts(deps: {
  configPresenter: Pick<IConfigPresenter, 'getProviderModels' | 'getCustomModels' | 'getAgentType'>
  llmProviderPresenter: Pick<ILlmProviderPresenter, 'check'>
}): {
  providerExecutionPort: ProviderExecutionPort
  providerCatalogPort: ProviderCatalogPort
} {
  return {
    providerExecutionPort: {
      testConnection: async (providerId, modelId) =>
        await deps.llmProviderPresenter.check(providerId, modelId)
    },
    providerCatalogPort: {
      getProviderModels: (providerId) => deps.configPresenter.getProviderModels(providerId) ?? [],
      getCustomModels: (providerId) => deps.configPresenter.getCustomModels(providerId) ?? [],
      getAgentType: async (agentId) => await deps.configPresenter.getAgentType(agentId)
    }
  }
}
