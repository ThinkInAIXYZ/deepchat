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

export function createProviderClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getProviders() {
    const result = await bridge.invoke(providersListRoute.name, {})
    return result.providers
  }

  async function getDefaultProviders() {
    const result = await bridge.invoke(providersListDefaultsRoute.name, {})
    return result.providers
  }

  async function setProviderById(providerId: string, provider: LLM_PROVIDER) {
    const result = await bridge.invoke(providersSetByIdRoute.name, {
      providerId,
      provider
    })
    return result.provider
  }

  async function updateProviderAtomic(providerId: string, updates: Partial<LLM_PROVIDER>) {
    const result = await bridge.invoke(providersUpdateRoute.name, {
      providerId,
      updates
    })
    return result.requiresRebuild
  }

  async function addProviderAtomic(provider: LLM_PROVIDER) {
    const result = await bridge.invoke(providersAddRoute.name, { provider })
    return result.provider
  }

  async function removeProviderAtomic(providerId: string) {
    const result = await bridge.invoke(providersRemoveRoute.name, { providerId })
    return result.removed
  }

  async function reorderProvidersAtomic(providers: LLM_PROVIDER[]) {
    const result = await bridge.invoke(providersReorderRoute.name, { providers })
    return result.providers
  }

  async function listModels(providerId: string) {
    return await bridge.invoke(providersListModelsRoute.name, { providerId })
  }

  async function testConnection(input: { providerId: string; modelId?: string }) {
    return await bridge.invoke(providersTestConnectionRoute.name, input)
  }

  async function getProviderRateLimitStatus(providerId: string) {
    const result = await bridge.invoke(providersGetRateLimitStatusRoute.name, { providerId })
    return result.status
  }

  async function refreshModels(providerId: string) {
    return await bridge.invoke(providersRefreshModelsRoute.name, { providerId })
  }

  async function listOllamaModels(providerId: string) {
    const result = await bridge.invoke(providersListOllamaModelsRoute.name, { providerId })
    return result.models
  }

  async function listOllamaRunningModels(providerId: string) {
    const result = await bridge.invoke(providersListOllamaRunningModelsRoute.name, {
      providerId
    })
    return result.models
  }

  async function pullOllamaModels(providerId: string, modelName: string) {
    const result = await bridge.invoke(providersPullOllamaModelRoute.name, {
      providerId,
      modelName
    })
    return result.success
  }

  async function warmupAcpProcess(agentId: string, workdir?: string) {
    return await bridge.invoke(providersWarmupAcpProcessRoute.name, {
      agentId,
      workdir
    })
  }

  async function getAcpProcessConfigOptions(agentId: string, workdir?: string) {
    const result = await bridge.invoke(providersGetAcpProcessConfigOptionsRoute.name, {
      agentId,
      workdir
    })
    return result.state
  }

  function onProvidersChanged(
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
    return bridge.on(providersChangedEvent.name, listener)
  }

  function onOllamaPullProgress(
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
    return bridge.on(providersOllamaPullProgressEvent.name, listener)
  }

  return {
    getProviders,
    getDefaultProviders,
    setProviderById,
    updateProviderAtomic,
    addProviderAtomic,
    removeProviderAtomic,
    reorderProvidersAtomic,
    listModels,
    testConnection,
    getProviderRateLimitStatus,
    refreshModels,
    listOllamaModels,
    listOllamaRunningModels,
    pullOllamaModels,
    warmupAcpProcess,
    getAcpProcessConfigOptions,
    onProvidersChanged,
    onOllamaPullProgress
  }
}

export type ProviderClient = ReturnType<typeof createProviderClient>
