import type { ProviderCatalogPort } from '@/presenter/runtimePorts'
import type { ProviderExecutionPort } from '../hotPathPorts'
import type { OperationRunner } from '../operationRunner'

const PROVIDER_QUERY_TIMEOUT_MS = 5_000

export class ProviderService {
  constructor(
    private readonly deps: {
      providerCatalogPort: Pick<ProviderCatalogPort, 'getProviderModels' | 'getCustomModels'>
      providerExecutionPort: Pick<ProviderExecutionPort, 'testConnection'>
      scheduler: OperationRunner
    }
  ) {}

  async listModels(providerId: string): Promise<{
    providerModels: ReturnType<ProviderCatalogPort['getProviderModels']>
    customModels: ReturnType<ProviderCatalogPort['getCustomModels']>
  }> {
    const providerModels = this.deps.providerCatalogPort.getProviderModels(providerId)
    const customModels = this.deps.providerCatalogPort.getCustomModels(providerId)

    return {
      providerModels,
      customModels
    }
  }

  async testConnection(input: { providerId: string; modelId?: string }): Promise<{
    isOk: boolean
    errorMsg: string | null
  }> {
    return await this.deps.scheduler.timeout({
      task: this.deps.providerExecutionPort.testConnection(input.providerId, input.modelId),
      ms: PROVIDER_QUERY_TIMEOUT_MS,
      reason: `providers.testConnection:${input.providerId}`
    })
  }
}
