import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  modelsChangedEvent,
  modelsConfigChangedEvent,
  modelsStatusChangedEvent
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
  modelsSetConfigRoute,
  modelsSetStatusRoute,
  modelsUpdateCustomRoute
} from '@shared/contracts/routes'
import type { IModelConfig, ModelConfig, RENDERER_MODEL_META } from '@shared/presenter'
import { getDeepchatBridge } from './core'

type ProviderCatalogCacheEntry = {
  expiresAt: number
  promise: Promise<Awaited<ReturnType<ModelClient['fetchProviderCatalog']>>>
}

export class ModelClient {
  private readonly catalogCache = new Map<string, ProviderCatalogCacheEntry>()
  private readonly capabilitiesCache = new Map<
    string,
    Promise<Awaited<ReturnType<ModelClient['getCapabilities']>>>
  >()

  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  private async fetchProviderCatalog(providerId: string) {
    const result = await this.bridge.invoke(modelsGetProviderCatalogRoute.name, { providerId })
    return result.catalog
  }

  clearProviderCatalogCache(providerId?: string) {
    if (providerId) {
      this.catalogCache.delete(providerId)
      return
    }
    this.catalogCache.clear()
  }

  private async getProviderCatalog(providerId: string) {
    const cached = this.catalogCache.get(providerId)
    const now = Date.now()
    if (cached && cached.expiresAt > now) {
      return await cached.promise
    }

    const promise = this.fetchProviderCatalog(providerId)
    this.catalogCache.set(providerId, {
      expiresAt: now + 200,
      promise
    })
    return await promise
  }

  async getProviderModels(providerId: string) {
    const catalog = await this.getProviderCatalog(providerId)
    return catalog.providerModels
  }

  async getCustomModels(providerId: string) {
    const catalog = await this.getProviderCatalog(providerId)
    return catalog.customModels
  }

  async getDbProviderModels(providerId: string) {
    const catalog = await this.getProviderCatalog(providerId)
    return catalog.dbProviderModels
  }

  async getBatchModelStatus(providerId: string, modelIds: string[]) {
    const catalog = await this.getProviderCatalog(providerId)
    const result: Record<string, boolean> = {}
    for (const modelId of modelIds) {
      result[modelId] = catalog.modelStatusMap[modelId] ?? false
    }
    return result
  }

  async getModelList(providerId: string) {
    const result = await this.bridge.invoke(modelsListRuntimeRoute.name, { providerId })
    this.clearProviderCatalogCache(providerId)
    return result.models
  }

  async updateModelStatus(providerId: string, modelId: string, enabled: boolean) {
    const result = await this.bridge.invoke(modelsSetStatusRoute.name, {
      providerId,
      modelId,
      enabled
    })
    this.clearProviderCatalogCache(providerId)
    return result
  }

  async addCustomModel(
    providerId: string,
    model: Omit<RENDERER_MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ) {
    const result = await this.bridge.invoke(modelsAddCustomRoute.name, { providerId, model })
    this.clearProviderCatalogCache(providerId)
    return result.model
  }

  async removeCustomModel(providerId: string, modelId: string) {
    const result = await this.bridge.invoke(modelsRemoveCustomRoute.name, { providerId, modelId })
    this.clearProviderCatalogCache(providerId)
    return result.removed
  }

  async updateCustomModel(
    providerId: string,
    modelId: string,
    updates: Partial<RENDERER_MODEL_META> & { enabled?: boolean }
  ) {
    const result = await this.bridge.invoke(modelsUpdateCustomRoute.name, {
      providerId,
      modelId,
      updates
    })
    this.clearProviderCatalogCache(providerId)
    return result.updated
  }

  async getModelConfig(modelId: string, providerId?: string) {
    const result = await this.bridge.invoke(modelsGetConfigRoute.name, { modelId, providerId })
    return result.config
  }

  async setModelConfig(modelId: string, providerId: string, config: ModelConfig) {
    const result = await this.bridge.invoke(modelsSetConfigRoute.name, {
      modelId,
      providerId,
      config: config as any
    })
    this.clearProviderCatalogCache(providerId)
    return result.config
  }

  async resetModelConfig(modelId: string, providerId: string) {
    const result = await this.bridge.invoke(modelsResetConfigRoute.name, {
      modelId,
      providerId
    })
    this.clearProviderCatalogCache(providerId)
    return result.reset
  }

  async getProviderModelConfigs(providerId: string) {
    const result = await this.bridge.invoke(modelsGetProviderConfigsRoute.name, { providerId })
    return result.configs
  }

  async hasUserModelConfig(modelId: string, providerId: string) {
    const result = await this.bridge.invoke(modelsHasUserConfigRoute.name, {
      modelId,
      providerId
    })
    return result.hasConfig
  }

  async exportModelConfigs() {
    const result = await this.bridge.invoke(modelsExportConfigsRoute.name, {})
    return result.configs
  }

  async importModelConfigs(configs: Record<string, IModelConfig>, overwrite = false) {
    return await this.bridge.invoke(modelsImportConfigsRoute.name, {
      configs: configs as any,
      overwrite
    })
  }

  async getCapabilities(providerId: string, modelId: string) {
    const cacheKey = `${providerId}:${modelId}`
    const cached = this.capabilitiesCache.get(cacheKey)
    if (cached) {
      return (await cached).capabilities
    }

    const promise = this.bridge.invoke(modelsGetCapabilitiesRoute.name, {
      providerId,
      modelId
    })
    this.capabilitiesCache.set(cacheKey, promise)

    try {
      return (await promise).capabilities
    } finally {
      this.capabilitiesCache.delete(cacheKey)
    }
  }

  async supportsReasoningCapability(providerId: string, modelId: string) {
    return (await this.getCapabilities(providerId, modelId)).supportsReasoning
  }

  async getReasoningPortrait(providerId: string, modelId: string) {
    return (await this.getCapabilities(providerId, modelId)).reasoningPortrait
  }

  async getThinkingBudgetRange(providerId: string, modelId: string) {
    return (await this.getCapabilities(providerId, modelId)).thinkingBudgetRange
  }

  async supportsSearchCapability(providerId: string, modelId: string) {
    return (await this.getCapabilities(providerId, modelId)).supportsSearch
  }

  async getSearchDefaults(providerId: string, modelId: string) {
    return (await this.getCapabilities(providerId, modelId)).searchDefaults
  }

  async supportsTemperatureControl(providerId: string, modelId: string) {
    return (await this.getCapabilities(providerId, modelId)).supportsTemperatureControl
  }

  async getTemperatureCapability(providerId: string, modelId: string) {
    return (await this.getCapabilities(providerId, modelId)).temperatureCapability
  }

  onModelsChanged(
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
    return this.bridge.on(modelsChangedEvent.name, listener)
  }

  onModelStatusChanged(
    listener: (payload: {
      providerId: string
      modelId: string
      enabled: boolean
      version: number
    }) => void
  ) {
    return this.bridge.on(modelsStatusChangedEvent.name, listener)
  }

  onModelConfigChanged(
    listener: (payload: {
      changeType: 'updated' | 'reset' | 'imported'
      providerId?: string
      modelId?: string
      config?: unknown
      overwrite?: boolean
      version: number
    }) => void
  ) {
    return this.bridge.on(modelsConfigChangedEvent.name, listener)
  }
}
