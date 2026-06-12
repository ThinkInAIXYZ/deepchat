import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  providersChangedEvent,
  providersAcpDebugEvent,
  providersOllamaPullProgressEvent,
  providersRateLimitConfigUpdatedEvent,
  providersRateLimitRequestExecutedEvent,
  providersRateLimitRequestQueuedEvent
} from '@shared/contracts/events'
import {
  providersAddRoute,
  providersGetAcpProcessConfigOptionsRoute,
  providersGetEmbeddingDimensionsRoute,
  providersGetKeyStatusRoute,
  providersGetRateLimitStatusRoute,
  providersImportApplyRoute,
  providersImportScanRoute,
  providersListDefaultsRoute,
  providersListModelsRoute,
  providersListOllamaModelsRoute,
  providersListOllamaRunningModelsRoute,
  providersListRoute,
  providersListSummariesRoute,
  providersPullOllamaModelRoute,
  providersRefreshModelsRoute,
  providersRemoveRoute,
  providersReorderRoute,
  providersRunAcpDebugActionRoute,
  providersSetByIdRoute,
  providersSyncModelScopeMcpServersRoute,
  providersTestConnectionRoute,
  providersUpdateRoute,
  providersUpdateRateLimitRoute,
  providersWarmupAcpProcessRoute
} from '@shared/contracts/routes'
import type { ProviderImportSelection } from '@shared/providerImport'
import type {
  AcpDebugEventEntry,
  AcpDebugRequest,
  AcpDebugRunResult,
  KeyStatus,
  LLM_PROVIDER,
  ModelScopeMcpSyncOptions,
  ModelScopeMcpSyncResult
} from '@shared/presenter'
import { getDeepchatBridge } from './core'

type ProviderModelScopeMcpSyncOptions = ModelScopeMcpSyncOptions & {
  page_number?: number
  page_size?: number
}

export function createProviderClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getProviders() {
    const result = await bridge.invoke(providersListRoute.name, {})
    return result.providers
  }

  async function getProviderSummaries() {
    const result = await bridge.invoke(providersListSummariesRoute.name, {})
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

  async function getKeyStatus(providerId: string): Promise<KeyStatus | null> {
    const result = await bridge.invoke(providersGetKeyStatusRoute.name, { providerId })
    return result.status
  }

  async function updateProviderRateLimit(providerId: string, enabled: boolean, qpsLimit: number) {
    const result = await bridge.invoke(providersUpdateRateLimitRoute.name, {
      providerId,
      enabled,
      qpsLimit
    })
    return result.config
  }

  async function getEmbeddingDimensions(providerId: string, modelId: string) {
    const result = await bridge.invoke(providersGetEmbeddingDimensionsRoute.name, {
      providerId,
      modelId
    })
    return result.result
  }

  async function syncModelScopeMcpServers(
    providerId: string,
    syncOptions?: ProviderModelScopeMcpSyncOptions
  ): Promise<ModelScopeMcpSyncResult> {
    const result = await bridge.invoke(providersSyncModelScopeMcpServersRoute.name, {
      providerId,
      syncOptions
    })
    return result.result as ModelScopeMcpSyncResult
  }

  async function runAcpDebugAction(request: AcpDebugRequest): Promise<AcpDebugRunResult> {
    const result = await bridge.invoke(providersRunAcpDebugActionRoute.name, {
      agentId: request.agentId,
      action: request.action,
      payload: request.payload,
      sessionId: request.sessionId,
      workdir: request.workdir,
      methodName: request.methodName
    })
    return result.result as AcpDebugRunResult
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

  async function scanProviderImports() {
    return await bridge.invoke(providersImportScanRoute.name, {})
  }

  async function applyProviderImports(sessionId: string, selections: ProviderImportSelection[]) {
    return await bridge.invoke(providersImportApplyRoute.name, {
      sessionId,
      selections: selections.map((selection) => {
        const providerOptions = selection.providerOptions
          ? Object.fromEntries(
              Object.entries(selection.providerOptions).map(([providerId, options]) => [
                providerId,
                {
                  targetApiType: options.targetApiType
                }
              ])
            )
          : undefined

        return {
          sourceId: selection.sourceId,
          providerIds: [...selection.providerIds],
          ...(providerOptions ? { providerOptions } : {})
        }
      })
    })
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

  function onRateLimitEvent(
    listener: (payload: {
      providerId: string
      config?: {
        enabled: boolean
        qpsLimit: number
      }
      queueLength?: number
      requestId?: string
      timestamp?: number
      currentQps?: number
      version: number
    }) => void
  ) {
    const offConfig = bridge.on(providersRateLimitConfigUpdatedEvent.name, listener)
    const offQueued = bridge.on(providersRateLimitRequestQueuedEvent.name, listener)
    const offExecuted = bridge.on(providersRateLimitRequestExecutedEvent.name, listener)

    return () => {
      offConfig()
      offQueued()
      offExecuted()
    }
  }

  function onAcpDebugEvent(
    listener: (payload: {
      webContentsId?: number
      agentId: string
      event: AcpDebugEventEntry
      version: number
    }) => void
  ) {
    return bridge.on(providersAcpDebugEvent.name, listener)
  }

  return {
    getProviders,
    getProviderSummaries,
    getDefaultProviders,
    setProviderById,
    updateProviderAtomic,
    addProviderAtomic,
    removeProviderAtomic,
    reorderProvidersAtomic,
    listModels,
    testConnection,
    getProviderRateLimitStatus,
    getKeyStatus,
    updateProviderRateLimit,
    getEmbeddingDimensions,
    syncModelScopeMcpServers,
    runAcpDebugAction,
    refreshModels,
    listOllamaModels,
    listOllamaRunningModels,
    pullOllamaModels,
    warmupAcpProcess,
    getAcpProcessConfigOptions,
    scanProviderImports,
    applyProviderImports,
    onProvidersChanged,
    onOllamaPullProgress,
    onRateLimitEvent,
    onAcpDebugEvent
  }
}

export type ProviderClient = ReturnType<typeof createProviderClient>
