import type { ProviderCatalogPort } from '@/presenter/runtimePorts'
import type { ProviderExecutionPort } from '../hotPathPorts'
import type { Scheduler } from '../scheduler'

const PROVIDER_QUERY_TIMEOUT_MS = 5_000

export class ProviderService {
  constructor(
    private readonly deps: {
      providerCatalogPort: Pick<ProviderCatalogPort, 'getProviderModels' | 'getCustomModels'>
      providerExecutionPort: Pick<ProviderExecutionPort, 'testConnection'>
      scheduler: Scheduler
    }
  ) {}

  async listModels(providerId: string): Promise<{
    providerModels: ReturnType<ProviderCatalogPort['getProviderModels']>
    customModels: ReturnType<ProviderCatalogPort['getCustomModels']>
  }> {
    const [providerModels, customModels] = await Promise.all([
      this.deps.scheduler.timeout({
        task: Promise.resolve(this.deps.providerCatalogPort.getProviderModels(providerId)),
        ms: PROVIDER_QUERY_TIMEOUT_MS,
        reason: `providers.listModels:${providerId}:provider`
      }),
      this.deps.scheduler.timeout({
        task: Promise.resolve(this.deps.providerCatalogPort.getCustomModels(providerId)),
        ms: PROVIDER_QUERY_TIMEOUT_MS,
        reason: `providers.listModels:${providerId}:custom`
      })
    ])

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
