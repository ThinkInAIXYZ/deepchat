import type { DeepchatBridge } from '@shared/contracts/bridge'
import { providersChangedEvent, providersOllamaPullProgressEvent } from '@shared/contracts/events'
import {
  providersAddRoute,
  providersGetAcpProcessConfigOptionsRoute,
  providersGetRateLimitStatusRoute,
  providersListDefaultsRoute,
  providersListModelsRoute,
  providersListOllamaModelsRoute,
  providersListOllamaRunningModelsRoute,
  providersListRoute,
  providersPullOllamaModelRoute,
  providersRefreshModelsRoute,
  providersRemoveRoute,
  providersReorderRoute,
  providersSetByIdRoute,
  providersTestConnectionRoute,
  providersUpdateRoute,
  providersWarmupAcpProcessRoute
} from '@shared/contracts/routes'
import type { LLM_PROVIDER } from '@shared/presenter'
import { getDeepchatBridge } from './core'

export class ProviderClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async getProviders() {
    const result = await this.bridge.invoke(providersListRoute.name, {})
    return result.providers
  }

  async getDefaultProviders() {
    const result = await this.bridge.invoke(providersListDefaultsRoute.name, {})
    return result.providers
  }

  async setProviderById(providerId: string, provider: LLM_PROVIDER) {
    const result = await this.bridge.invoke(providersSetByIdRoute.name, {
      providerId,
      provider
    })
    return result.provider
  }

  async updateProviderAtomic(providerId: string, updates: Partial<LLM_PROVIDER>) {
    const result = await this.bridge.invoke(providersUpdateRoute.name, {
      providerId,
      updates
    })
    return result.requiresRebuild
  }

  async addProviderAtomic(provider: LLM_PROVIDER) {
    const result = await this.bridge.invoke(providersAddRoute.name, { provider })
    return result.provider
  }

  async removeProviderAtomic(providerId: string) {
    const result = await this.bridge.invoke(providersRemoveRoute.name, { providerId })
    return result.removed
  }

  async reorderProvidersAtomic(providers: LLM_PROVIDER[]) {
    const result = await this.bridge.invoke(providersReorderRoute.name, { providers })
    return result.providers
  }

  async listModels(providerId: string) {
    return await this.bridge.invoke(providersListModelsRoute.name, { providerId })
  }

  async testConnection(input: { providerId: string; modelId?: string }) {
    return await this.bridge.invoke(providersTestConnectionRoute.name, input)
  }

  async getProviderRateLimitStatus(providerId: string) {
    const result = await this.bridge.invoke(providersGetRateLimitStatusRoute.name, { providerId })
    return result.status
  }

  async refreshModels(providerId: string) {
    return await this.bridge.invoke(providersRefreshModelsRoute.name, { providerId })
  }

  async listOllamaModels(providerId: string) {
    const result = await this.bridge.invoke(providersListOllamaModelsRoute.name, { providerId })
    return result.models
  }

  async listOllamaRunningModels(providerId: string) {
    const result = await this.bridge.invoke(providersListOllamaRunningModelsRoute.name, {
      providerId
    })
    return result.models
  }

  async pullOllamaModels(providerId: string, modelName: string) {
    const result = await this.bridge.invoke(providersPullOllamaModelRoute.name, {
      providerId,
      modelName
    })
    return result.success
  }

  async warmupAcpProcess(agentId: string, workdir?: string) {
    return await this.bridge.invoke(providersWarmupAcpProcessRoute.name, {
      agentId,
      workdir
    })
  }

  async getAcpProcessConfigOptions(agentId: string, workdir?: string) {
    const result = await this.bridge.invoke(providersGetAcpProcessConfigOptionsRoute.name, {
      agentId,
      workdir
    })
    return result.state
  }

  onProvidersChanged(
    listener: (payload: {
      reason:
        | 'providers'
        | 'provider-atomic-update'
        | 'provider-batch-update'
        | 'provider-db-loaded'
        | 'provider-db-updated'
      providerIds?: string[]
      version: number
    }) => void
  ) {
    return this.bridge.on(providersChangedEvent.name, listener)
  }

  onOllamaPullProgress(
    listener: (payload: {
      eventId: string
      providerId: string
      modelName: string
      completed?: number
      total?: number
      status?: string
      version: number
    }) => void
  ) {
    return this.bridge.on(providersOllamaPullProgressEvent.name, listener)
  }
}
