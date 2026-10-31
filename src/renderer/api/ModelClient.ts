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
  modelsRemoveCustomRoute,
  modelsResetConfigRoute,
  modelsSaveCustomRoute,
  modelsSetBatchStatusRoute,
  modelsSetConfigRoute,
  modelsSetStatusRoute,
  modelsTranscribeAudioRoute,
  modelsUpdateCustomRoute
} from '@shared/contracts/routes'
import type { IModelConfig, ModelConfig, RENDERER_MODEL_META } from '@shared/types/provider'
import type { CapabilitySnapshotQuery } from '@shared/types/model-capabilities'
import { getDeepchatBridge } from './core'

export function createModelClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function fetchCapabilities(query: CapabilitySnapshotQuery) {
    return await bridge.invoke(modelsGetCapabilitiesRoute.name, query)
  }

  const capabilitiesCache = new Map<string, ReturnType<typeof fetchCapabilities>>()

  async function getDbProviderModels(providerId: string) {
    const result = await bridge.invoke(modelsGetProviderCatalogRoute.name, { providerId })
    return result.catalog.dbProviderModels
  }

  async function updateModelStatus(providerId: string, modelId: string, enabled: boolean) {
    const result = await bridge.invoke(modelsSetStatusRoute.name, {
      providerId,
      modelId,
      enabled
    })
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
    return result
  }

  async function addCustomModel(
    providerId: string,
    model: Omit<RENDERER_MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ) {
    const result = await bridge.invoke(modelsAddCustomRoute.name, { providerId, model })
    return result.model
  }

  async function saveCustomModel(
    providerId: string,
    originalModelId: string | undefined,
    model: Omit<RENDERER_MODEL_META, 'providerId' | 'isCustom' | 'group'>,
    config: ModelConfig
  ) {
    const result = await bridge.invoke(modelsSaveCustomRoute.name, {
      providerId,
      originalModelId,
      model,
      config: config as any
    })
    return result.model
  }

  async function removeCustomModel(providerId: string, modelId: string) {
    const result = await bridge.invoke(modelsRemoveCustomRoute.name, { providerId, modelId })
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
    return result.config
  }

  async function resetModelConfig(modelId: string, providerId: string) {
    const result = await bridge.invoke(modelsResetConfigRoute.name, {
      modelId,
      providerId
    })
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

  async function getCapabilities(query: CapabilitySnapshotQuery) {
    if (query.routeOverride || query.reasoningEnabled !== undefined) {
      return (await fetchCapabilities(query)).capabilities
    }

    const cacheKey = JSON.stringify([query.providerId, query.modelId])
    const cached = capabilitiesCache.get(cacheKey)
    if (cached) {
      return (await cached).capabilities
    }

    const promise = fetchCapabilities(query)
    capabilitiesCache.set(cacheKey, promise)

    try {
      return (await promise).capabilities
    } finally {
      capabilitiesCache.delete(cacheKey)
    }
  }

  async function transcribeAudio(
    providerId: string,
    modelId: string,
    audioBase64: string,
    mimeType: string,
    filename?: string
  ) {
    const result = await bridge.invoke(modelsTranscribeAudioRoute.name, {
      providerId,
      modelId,
      audioBase64,
      mimeType,
      ...(filename && { filename })
    })
    return result.text
  }

  async function supportsReasoningCapability(providerId: string, modelId: string) {
    return (await getCapabilities({ providerId, modelId })).supportsReasoning
  }

  async function getReasoningPortrait(providerId: string, modelId: string) {
    return (await getCapabilities({ providerId, modelId })).reasoningPortrait
  }

  async function getThinkingBudgetRange(providerId: string, modelId: string) {
    return (await getCapabilities({ providerId, modelId })).thinkingBudgetRange
  }

  async function supportsSearchCapability(providerId: string, modelId: string) {
    return (await getCapabilities({ providerId, modelId })).supportsSearch
  }

  async function getSearchDefaults(providerId: string, modelId: string) {
    return (await getCapabilities({ providerId, modelId })).searchDefaults
  }

  async function supportsTemperatureControl(providerId: string, modelId: string) {
    return (await getCapabilities({ providerId, modelId })).supportsTemperatureControl
  }

  async function getTemperatureCapability(providerId: string, modelId: string) {
    return (await getCapabilities({ providerId, modelId })).temperatureCapability
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
    getDbProviderModels,
    updateModelStatus,
    setBatchModelStatus,
    addCustomModel,
    saveCustomModel,
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
    transcribeAudio,
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
