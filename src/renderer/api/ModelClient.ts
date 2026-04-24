import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  modelsChangedEvent,
  modelsConfigChangedEvent,
  modelsStatusChangedEvent,
  modelBatchStatusChangedEvent
} from '@shared/contracts/events'
import {
  modelsAddCustomRoute,
  modelsExportConfigsRoute,
  modelsGetCapabilitiesRoute,
  modelsGetConfigRoute,
  modelsGetProviderCatalogRoute,
  modelsGetProviderConfigsRoute,
  modelsHasUserConfigRoute,
  modelsImportConfigsRoute,
  modelsListRuntimeRoute,
  modelsRemoveCustomRoute,
  modelsResetConfigRoute,
  modelsSetBatchStatusRoute,
  modelsSetConfigRoute,
  modelsSetStatusRoute,
  modelsUpdateCustomRoute
} from '@shared/contracts/routes'
import type { IModelConfig, ModelConfig, RENDERER_MODEL_META } from '@shared/presenter'
import { getDeepchatBridge } from './core'

export function createModelClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function fetchProviderCatalog(providerId: string) {
    const result = await bridge.invoke(modelsGetProviderCatalogRoute.name, { providerId })
    return result.catalog
  }

  async function fetchCapabilities(providerId: string, modelId: string) {
    return await bridge.invoke(modelsGetCapabilitiesRoute.name, {
      providerId,
      modelId
    })
  }

  type ProviderCatalog = Awaited<ReturnType<typeof fetchProviderCatalog>>
  type ProviderCatalogCacheEntry = {
    expiresAt: number
    promise: Promise<ProviderCatalog>
  }

  const catalogCache = new Map<string, ProviderCatalogCacheEntry>()
  const capabilitiesCache = new Map<string, ReturnType<typeof fetchCapabilities>>()

  function clearProviderCatalogCache(providerId?: string) {
    if (providerId) {
      catalogCache.delete(providerId)
      return
    }

    catalogCache.clear()
  }

  async function getProviderCatalog(providerId: string) {
    const cached = catalogCache.get(providerId)
    const now = Date.now()
    if (cached && cached.expiresAt > now) {
      return await cached.promise
    }

    const promise = fetchProviderCatalog(providerId)
    catalogCache.set(providerId, {
      expiresAt: now + 200,
      promise
    })
    return await promise
  }

  async function getProviderModels(providerId: string) {
    const catalog = await getProviderCatalog(providerId)
    return catalog.providerModels
  }

  async function getCustomModels(providerId: string) {
    const catalog = await getProviderCatalog(providerId)
    return catalog.customModels
  }

  async function getDbProviderModels(providerId: string) {
    const catalog = await getProviderCatalog(providerId)
    return catalog.dbProviderModels
  }

  async function getBatchModelStatus(providerId: string, modelIds: string[]) {
    const catalog = await getProviderCatalog(providerId)
    const result: Record<string, boolean> = {}
    for (const modelId of modelIds) {
      result[modelId] = catalog.modelStatusMap[modelId] ?? false
    }
    return result
  }

  async function getModelList(providerId: string) {
    const result = await bridge.invoke(modelsListRuntimeRoute.name, { providerId })
    clearProviderCatalogCache(providerId)
    return result.models
  }

  async function updateModelStatus(providerId: string, modelId: string, enabled: boolean) {
    const result = await bridge.invoke(modelsSetStatusRoute.name, {
      providerId,
      modelId,
      enabled
    })
    clearProviderCatalogCache(providerId)
    return result
  }

  async function setBatchModelStatus(
    providerId: string,
    updates: { modelId: string; enabled: boolean }[]
  ) {
    const result = await bridge.invoke(modelsSetBatchStatusRoute.name, {
      providerId,
      updates
    })
    clearProviderCatalogCache(providerId)
    return result
  }

  async function addCustomModel(
    providerId: string,
    model: Omit<RENDERER_MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ) {
    const result = await bridge.invoke(modelsAddCustomRoute.name, { providerId, model })
    clearProviderCatalogCache(providerId)
    return result.model
  }

  async function removeCustomModel(providerId: string, modelId: string) {
    const result = await bridge.invoke(modelsRemoveCustomRoute.name, { providerId, modelId })
    clearProviderCatalogCache(providerId)
    return result.removed
  }

  async function updateCustomModel(
    providerId: string,
    modelId: string,
    updates: Partial<RENDERER_MODEL_META> & { enabled?: boolean }
  ) {
    const result = await bridge.invoke(modelsUpdateCustomRoute.name, {
      providerId,
      modelId,
      updates
    })
    clearProviderCatalogCache(providerId)
    return result.updated
  }

  async function getModelConfig(modelId: string, providerId?: string) {
    const result = await bridge.invoke(modelsGetConfigRoute.name, { modelId, providerId })
    return result.config
  }

  async function setModelConfig(modelId: string, providerId: string, config: ModelConfig) {
    const result = await bridge.invoke(modelsSetConfigRoute.name, {
      modelId,
      providerId,
      config: config as any
    })
    clearProviderCatalogCache(providerId)
    return result.config
  }

  async function resetModelConfig(modelId: string, providerId: string) {
    const result = await bridge.invoke(modelsResetConfigRoute.name, {
      modelId,
      providerId
    })
    clearProviderCatalogCache(providerId)
    return result.reset
  }

  async function getProviderModelConfigs(providerId: string) {
    const result = await bridge.invoke(modelsGetProviderConfigsRoute.name, { providerId })
    return result.configs
  }

  async function hasUserModelConfig(modelId: string, providerId: string) {
    const result = await bridge.invoke(modelsHasUserConfigRoute.name, {
      modelId,
      providerId
    })
    return result.hasConfig
  }

  async function exportModelConfigs() {
    const result = await bridge.invoke(modelsExportConfigsRoute.name, {})
    return result.configs
  }

  async function importModelConfigs(configs: Record<string, IModelConfig>, overwrite = false) {
    return await bridge.invoke(modelsImportConfigsRoute.name, {
      configs: configs as any,
      overwrite
    })
  }

  async function getCapabilities(providerId: string, modelId: string) {
    const cacheKey = `${providerId}:${modelId}`
    const cached = capabilitiesCache.get(cacheKey)
    if (cached) {
      return (await cached).capabilities
    }

    const promise = fetchCapabilities(providerId, modelId)
    capabilitiesCache.set(cacheKey, promise)

    try {
      return (await promise).capabilities
    } finally {
      capabilitiesCache.delete(cacheKey)
    }
  }

  async function supportsReasoningCapability(providerId: string, modelId: string) {
    return (await getCapabilities(providerId, modelId)).supportsReasoning
  }

  async function getReasoningPortrait(providerId: string, modelId: string) {
    return (await getCapabilities(providerId, modelId)).reasoningPortrait
  }

  async function getThinkingBudgetRange(providerId: string, modelId: string) {
    return (await getCapabilities(providerId, modelId)).thinkingBudgetRange
  }

  async function supportsSearchCapability(providerId: string, modelId: string) {
    return (await getCapabilities(providerId, modelId)).supportsSearch
  }

  async function getSearchDefaults(providerId: string, modelId: string) {
    return (await getCapabilities(providerId, modelId)).searchDefaults
  }

  async function supportsTemperatureControl(providerId: string, modelId: string) {
    return (await getCapabilities(providerId, modelId)).supportsTemperatureControl
  }

  async function getTemperatureCapability(providerId: string, modelId: string) {
    return (await getCapabilities(providerId, modelId)).temperatureCapability
  }

  function onModelsChanged(
    listener: (payload: {
      reason:
        | 'provider-models'
        | 'custom-models'
        | 'provider-db-loaded'
        | 'provider-db-updated'
        | 'runtime-refresh'
        | 'agents'
      providerId?: string
      version: number
    }) => void
  ) {
    return bridge.on(modelsChangedEvent.name, listener)
  }

  function onModelStatusChanged(
    listener: (payload: {
      providerId: string
      modelId: string
      enabled: boolean
      version: number
    }) => void
  ) {
    return bridge.on(modelsStatusChangedEvent.name, listener)
  }

  function onModelBatchStatusChanged(
    listener: (payload: {
      providerId: string
      updates: { modelId: string; enabled: boolean }[]
      version: number
    }) => void
  ) {
    return bridge.on(modelBatchStatusChangedEvent.name, listener)
  }

  function onModelConfigChanged(
    listener: (payload: {
      changeType: 'updated' | 'reset' | 'imported'
      providerId?: string
      modelId?: string
      config?: unknown
      overwrite?: boolean
      version: number
    }) => void
  ) {
    return bridge.on(modelsConfigChangedEvent.name, listener)
  }

  return {
    clearProviderCatalogCache,
    getProviderModels,
    getCustomModels,
    getDbProviderModels,
    getBatchModelStatus,
    getModelList,
    updateModelStatus,
    setBatchModelStatus,
    addCustomModel,
    removeCustomModel,
    updateCustomModel,
    getModelConfig,
    setModelConfig,
    resetModelConfig,
    getProviderModelConfigs,
    hasUserModelConfig,
    exportModelConfigs,
    importModelConfigs,
    getCapabilities,
    supportsReasoningCapability,
    getReasoningPortrait,
    getThinkingBudgetRange,
    supportsSearchCapability,
    getSearchDefaults,
    supportsTemperatureControl,
    getTemperatureCapability,
    onModelsChanged,
    onModelStatusChanged,
    onModelBatchStatusChanged,
    onModelConfigChanged
  }
}

export type ModelClient = ReturnType<typeof createModelClient>
