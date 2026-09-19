import type { ProviderSettingsPort } from '@/provider/settings'
export interface ProviderQueryScheduler {
  timeout<T>(input: { task: Promise<T>; ms: number; reason: string }): Promise<T>
}

interface ProviderConnectionPort {
  testConnection(
    providerId: string,
    modelId?: string
  ): Promise<{
    isOk: boolean
    errorMsg: string | null
  }>
}

type ProviderModelCatalogPort = Pick<ProviderSettingsPort, 'getProviderModels' | 'getCustomModels'>

const PROVIDER_QUERY_TIMEOUT_MS = 5_000

export class ProviderService {
  constructor(
    private readonly deps: {
      providerCatalogPort: ProviderModelCatalogPort
      providerExecutionPort: ProviderConnectionPort
      scheduler: ProviderQueryScheduler
    }
  ) {}

  async listModels(providerId: string): Promise<{
    providerModels: ReturnType<ProviderModelCatalogPort['getProviderModels']>
    customModels: ReturnType<ProviderModelCatalogPort['getCustomModels']>
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
