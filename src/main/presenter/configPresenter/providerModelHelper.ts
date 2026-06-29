import logger from '@shared/logger'
import { ModelConfig, MODEL_META } from '@shared/presenter'
import {
  isNewApiEndpointType,
  ModelType,
  resolveNewApiModelTypeFromMetadata,
  resolveNewApiSelectableEndpointTypes
} from '@shared/model'
import { resolveVideoGenerationCompatType } from '@shared/videoGenerationSettings'
import ElectronStore from 'electron-store'
import path from 'path'
import type { StoreLike } from './storeLike'
import { emitModelsChanged } from './eventPublishers'

export interface IModelStore {
  models: MODEL_META[]
  custom_models: MODEL_META[]
}

export const PROVIDER_MODELS_DIR = 'provider_models'
const PROVIDER_MODEL_CACHE_TTL_MS = 250

type ModelConfigResolver = (modelId: string, providerId?: string) => ModelConfig

type ModelStatusUpdater = (providerId: string, modelId: string, enabled: boolean) => void

type ModelStatusRemover = (providerId: string, modelId: string) => void

interface ProviderModelHelperOptions {
  userDataPath: string
  getModelConfig: ModelConfigResolver
  setModelStatus: ModelStatusUpdater
  deleteModelStatus: ModelStatusRemover
}

type ProviderModelStore = StoreLike<IModelStore & Record<string, unknown>>

const MODEL_TYPE_VALUES = new Set<string>(Object.values(ModelType))

function isModelType(value: unknown): value is ModelType {
  return typeof value === 'string' && MODEL_TYPE_VALUES.has(value)
}

function isNonChatModelType(type: ModelType | undefined): type is ModelType {
  return type !== undefined && type !== ModelType.Chat
}

export class ProviderModelHelper {
  private readonly userDataPath: string
  private readonly getModelConfig: ModelConfigResolver
  private readonly setModelStatus: ModelStatusUpdater
  private readonly deleteModelStatus: ModelStatusRemover
  private readonly stores: Map<string, ProviderModelStore> = new Map()
  private storeFactory: ((providerId: string) => ProviderModelStore) | null = null
  private readonly providerModelsCache = new Map<
    string,
    {
      expiresAt: number
      models: MODEL_META[]
    }
  >()

  constructor(options: ProviderModelHelperOptions) {
    this.userDataPath = options.userDataPath
    this.getModelConfig = options.getModelConfig
    this.setModelStatus = options.setModelStatus
    this.deleteModelStatus = options.deleteModelStatus
  }

  private getStoreName(providerId: string): string {
    const safeProviderId = encodeURIComponent(providerId).replace(/\*/g, '%2A')
    return `models_${safeProviderId}`
  }

  setStoreFactory(factory: (providerId: string) => ProviderModelStore): void {
    this.storeFactory = factory
    this.stores.clear()
    this.invalidateAllProviderModelsCache()
  }

  getProviderModelStore(providerId: string): ProviderModelStore {
    if (!this.stores.has(providerId)) {
      if (this.storeFactory) {
        this.stores.set(providerId, this.storeFactory(providerId))
        return this.stores.get(providerId)!
      }

      const storeName = this.getStoreName(providerId)
      const storePath = path.join(this.userDataPath, PROVIDER_MODELS_DIR)
      logger.info(
        `[ProviderModelHelper] getProviderModelStore: creating isolated store "${storeName}" at "${storePath}" for provider "${providerId}"`
      )
      const store = new ElectronStore<IModelStore>({
        name: storeName,
        cwd: storePath,
        defaults: {
          models: [],
          custom_models: []
        }
      })
      this.stores.set(providerId, store as unknown as ProviderModelStore)
      logger.info(
        `[ProviderModelHelper] getProviderModelStore: store "${storeName}" created and cached for provider "${providerId}"`
      )
    }
    return this.stores.get(providerId)!
  }

  invalidateProviderModelsCache(providerId: string): void {
    this.providerModelsCache.delete(providerId)
  }

  invalidateAllProviderModelsCache(): void {
    this.providerModelsCache.clear()
  }

  private cloneModel(model: MODEL_META): MODEL_META {
    return {
      ...model
    }
  }

  private cloneModels(models: MODEL_META[]): MODEL_META[] {
    return models.map((model) => this.cloneModel(model))
  }

  private normalizeStoredModel(model: MODEL_META, providerId: string, source: string): MODEL_META {
    const normalizedModel = this.cloneModel(model)

    if (normalizedModel.providerId && normalizedModel.providerId !== providerId) {
      console.warn(
        `[ProviderModelHelper] ${source}: Model ${normalizedModel.id} has incorrect providerId: expected "${providerId}", got "${normalizedModel.providerId}". Fixing it.`
      )
      normalizedModel.providerId = providerId
    } else if (!normalizedModel.providerId) {
      console.warn(
        `[ProviderModelHelper] ${source}: Model ${normalizedModel.id} missing providerId, setting to "${providerId}"`
      )
      normalizedModel.providerId = providerId
    }

    return normalizedModel
  }

  private resolveNewApiEffectiveModelType(model: MODEL_META, config?: ModelConfig): ModelType {
    const userConfigType =
      config?.isUserDefined === true && isModelType(config.type) ? config.type : undefined
    if (userConfigType) {
      return userConfigType
    }

    if (isModelType(model.type)) {
      return model.type
    }

    const supportedEndpointTypes = (model.supportedEndpointTypes ?? []).filter(isNewApiEndpointType)
    const routeEndpointTypes =
      supportedEndpointTypes.length > 0
        ? supportedEndpointTypes
        : isNewApiEndpointType(model.endpointType)
          ? [model.endpointType]
          : []
    const metadataType = resolveNewApiModelTypeFromMetadata(routeEndpointTypes, model.id, undefined)
    if (metadataType) {
      return metadataType
    }

    const providerConfigType =
      config?.isUserDefined !== true && isModelType(config?.type) ? config.type : undefined
    if (isNonChatModelType(providerConfigType)) {
      return providerConfigType
    }

    return ModelType.Chat
  }

  private applyResolvedModelConfig(model: MODEL_META, providerId: string): MODEL_META {
    const normalizedModel = this.cloneModel(model)
    const config = this.getModelConfig(normalizedModel.id, providerId)

    if (config) {
      normalizedModel.maxTokens = config.maxTokens
      normalizedModel.contextLength = config.contextLength
      normalizedModel.vision =
        normalizedModel.vision !== undefined ? normalizedModel.vision : config.vision || false
      normalizedModel.functionCall =
        normalizedModel.functionCall !== undefined
          ? normalizedModel.functionCall
          : config.functionCall || false
      normalizedModel.reasoning =
        normalizedModel.reasoning !== undefined
          ? normalizedModel.reasoning
          : config.reasoning || false
      normalizedModel.endpointType = config.endpointType ?? normalizedModel.endpointType
      normalizedModel.ownedBy = normalizedModel.ownedBy ?? config.ownedBy
      if (providerId === 'new-api') {
        normalizedModel.type = this.resolveNewApiEffectiveModelType(normalizedModel, config)
        return normalizedModel
      }

      normalizedModel.type =
        resolveVideoGenerationCompatType({
          modelId: normalizedModel.id,
          type: config.type ?? normalizedModel.type,
          apiEndpoint: config.apiEndpoint,
          endpointType: normalizedModel.endpointType,
          supportedEndpointTypes: normalizedModel.supportedEndpointTypes
        }) ??
        (normalizedModel.type !== undefined ? normalizedModel.type : config.type || ModelType.Chat)
      return normalizedModel
    }

    normalizedModel.vision = normalizedModel.vision || false
    normalizedModel.functionCall = normalizedModel.functionCall || false
    normalizedModel.reasoning = normalizedModel.reasoning || false
    if (providerId === 'new-api') {
      normalizedModel.type = this.resolveNewApiEffectiveModelType(normalizedModel)
      return normalizedModel
    }

    normalizedModel.type =
      resolveVideoGenerationCompatType({
        modelId: normalizedModel.id,
        type: normalizedModel.type,
        endpointType: normalizedModel.endpointType,
        supportedEndpointTypes: normalizedModel.supportedEndpointTypes
      }) ??
      (normalizedModel.type || ModelType.Chat)
    return normalizedModel
  }

  private applyNewApiEndpointCompatibility(model: MODEL_META, providerId: string): MODEL_META {
    if (providerId !== 'new-api') {
      return model
    }

    const selectableEndpointTypes = resolveNewApiSelectableEndpointTypes(
      model.supportedEndpointTypes,
      model.id,
      {
        type: model.type
      }
    )
    return selectableEndpointTypes ? { ...model, selectableEndpointTypes } : model
  }

  getProviderModels(providerId: string): MODEL_META[] {
    const cached = this.providerModelsCache.get(providerId)
    if (cached && cached.expiresAt > Date.now()) {
      return this.cloneModels(cached.models)
    }

    const store = this.getProviderModelStore(providerId)
    const storedModels = (store.get('models') || []) as MODEL_META[]
    const normalizedStoredModels = storedModels.map((model) =>
      this.normalizeStoredModel(model, providerId, 'getProviderModels')
    )

    const incorrectProviderIds = normalizedStoredModels.filter(
      (model) => model.providerId !== providerId
    )
    if (incorrectProviderIds.length > 0) {
      console.error(
        `[ProviderModelHelper] getProviderModels: Found ${incorrectProviderIds.length} models with incorrect providerId for provider "${providerId}"`
      )
    }

    const shouldPersistNormalizedModels = normalizedStoredModels.some(
      (model, index) => model.providerId !== storedModels[index]?.providerId
    )
    if (shouldPersistNormalizedModels) {
      store.set('models', this.cloneModels(normalizedStoredModels))
    }

    const result = normalizedStoredModels.map((model) =>
      this.applyNewApiEndpointCompatibility(
        this.applyResolvedModelConfig(model, providerId),
        providerId
      )
    )

    this.providerModelsCache.set(providerId, {
      expiresAt: Date.now() + PROVIDER_MODEL_CACHE_TTL_MS,
      models: this.cloneModels(result)
    })

    return this.cloneModels(result)
  }

  setProviderModels(providerId: string, models: MODEL_META[]): void {
    logger.info(
      `[ProviderModelHelper] setProviderModels: storing ${models.length} models for provider "${providerId}"`
    )

    // Validate and fix providerId for all models before storing
    const validatedModels = models.map((model) => {
      if (model.providerId && model.providerId !== providerId) {
        console.warn(
          `[ProviderModelHelper] setProviderModels: Model ${model.id} has incorrect providerId: expected "${providerId}", got "${model.providerId}". Fixing it.`
        )
        model.providerId = providerId
      } else if (!model.providerId) {
        console.warn(
          `[ProviderModelHelper] setProviderModels: Model ${model.id} missing providerId, setting to "${providerId}"`
        )
        model.providerId = providerId
      }
      return model
    })

    // Log validation results
    const incorrectProviderIds = validatedModels.filter((m) => m.providerId !== providerId)
    if (incorrectProviderIds.length > 0) {
      console.error(
        `[ProviderModelHelper] setProviderModels: Found ${incorrectProviderIds.length} models with incorrect providerId for provider "${providerId}" after validation`
      )
    }

    const store = this.getProviderModelStore(providerId)
    store.set('models', validatedModels)
    this.invalidateProviderModelsCache(providerId)
    logger.info(
      `[ProviderModelHelper] setProviderModels: stored ${validatedModels.length} models for provider "${providerId}"`
    )
  }

  getCustomModels(providerId: string): MODEL_META[] {
    const store = this.getProviderModelStore(providerId)
    const customModels = (store.get('custom_models') || []) as MODEL_META[]
    return customModels.map((model) => {
      const config = this.getModelConfig(model.id, providerId)
      model.vision = model.vision !== undefined ? model.vision : false
      model.functionCall = model.functionCall !== undefined ? model.functionCall : false
      model.reasoning = model.reasoning !== undefined ? model.reasoning : false
      model.type = model.type || ModelType.Chat
      model.endpointType = config?.endpointType ?? model.endpointType
      model.ownedBy = model.ownedBy ?? config?.ownedBy
      return model
    })
  }

  setCustomModels(providerId: string, models: MODEL_META[]): void {
    const store = this.getProviderModelStore(providerId)
    store.set('custom_models', models)
    this.invalidateProviderModelsCache(providerId)
  }

  clearProviderModelStore(providerId: string): void {
    const store = this.getProviderModelStore(providerId) as ProviderModelStore & {
      clear?: () => void
    }

    if (typeof store.clear === 'function') {
      store.clear()
    } else {
      store.set('models', [])
      store.set('custom_models', [])
    }

    this.stores.delete(providerId)
    this.invalidateProviderModelsCache(providerId)
  }

  addCustomModel(providerId: string, model: MODEL_META): void {
    const models = this.getCustomModels(providerId)
    const existingIndex = models.findIndex((m) => m.id === model.id)
    const { enabled: _enabled, ...modelWithoutStatus } = model as MODEL_META & {
      enabled?: unknown
    }

    if (existingIndex !== -1) {
      models[existingIndex] = modelWithoutStatus as MODEL_META
    } else {
      models.push(modelWithoutStatus as MODEL_META)
    }

    this.setCustomModels(providerId, models)
    this.setModelStatus(providerId, model.id, true)
    emitModelsChanged(providerId)
  }

  removeCustomModel(providerId: string, modelId: string): void {
    const models = this.getCustomModels(providerId)
    const filteredModels = models.filter((model) => model.id !== modelId)
    this.setCustomModels(providerId, filteredModels)
    this.deleteModelStatus(providerId, modelId)
    emitModelsChanged(providerId)
  }

  updateCustomModel(providerId: string, modelId: string, updates: Partial<MODEL_META>): void {
    const models = this.getCustomModels(providerId)
    const index = models.findIndex((model) => model.id === modelId)
    if (index !== -1) {
      models[index] = { ...models[index], ...updates }
      this.setCustomModels(providerId, models)
      emitModelsChanged(providerId)
    }
  }
}
