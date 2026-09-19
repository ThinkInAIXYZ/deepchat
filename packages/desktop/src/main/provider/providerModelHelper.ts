import logger from '@shared/logger'
import type { MODEL_META, ModelRouteConfig } from '@shared/types/provider'
import { isNewApiEndpointType, ModelType, resolveNewApiModelTypeFromMetadata } from '@shared/model'
import { resolveVideoGenerationCompatType } from '@shared/videoGenerationSettings'
import ElectronStore from 'electron-store'
import path from 'path'
import type { StoreLike } from '@/config/storeLike'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import { emitModelsChanged } from './eventPublishers'
import { stripDerivedProviderModelFields } from './providerModelFacts'

export interface IModelStore {
  models: MODEL_META[]
  custom_models: MODEL_META[]
}

export const PROVIDER_MODELS_DIR = 'provider_models'
const PROVIDER_MODEL_CACHE_TTL_MS = 250

type ProviderModelRouteSource = Pick<
  MODEL_META,
  'id' | 'endpointType' | 'supportedEndpointTypes' | 'type' | 'ownedBy'
>

type ModelStatusUpdater = (providerId: string, modelId: string, enabled: boolean) => void

type ModelStatusRemover = (providerId: string, modelId: string) => void

interface ProviderModelHelperOptions {
  userDataPath: string
  setModelStatus: ModelStatusUpdater
  deleteModelStatus: ModelStatusRemover
  publishEvent: DeepchatEventPublisher
}

type ProviderModelStore = StoreLike<IModelStore & Record<string, unknown>> & {
  getProviderModel?: (source: 'provider' | 'custom', modelId: string) => MODEL_META | undefined
}

export type ProviderModelRouteMetadata = Pick<
  MODEL_META,
  'endpointType' | 'supportedEndpointTypes' | 'type' | 'ownedBy'
>

const MODEL_TYPE_VALUES = new Set<string>(Object.values(ModelType))

function isModelType(value: unknown): value is ModelType {
  return typeof value === 'string' && MODEL_TYPE_VALUES.has(value)
}

function isNonChatModelType(type: ModelType | undefined): type is ModelType {
  return type !== undefined && type !== ModelType.Chat
}

export class ProviderModelHelper {
  private readonly userDataPath: string
  private readonly setModelStatus: ModelStatusUpdater
  private readonly deleteModelStatus: ModelStatusRemover
  private readonly publishEvent: DeepchatEventPublisher
  private readonly stores: Map<string, ProviderModelStore> = new Map()
  private storeFactory: ((providerId: string) => ProviderModelStore) | null = null
  private readonly providerModelsCache = new Map<
    string,
    {
      expiresAt: number
      models: readonly MODEL_META[]
      modelsById: ReadonlyMap<string, MODEL_META>
    }
  >()

  constructor(options: ProviderModelHelperOptions) {
    this.userDataPath = options.userDataPath
    this.setModelStatus = options.setModelStatus
    this.deleteModelStatus = options.deleteModelStatus
    this.publishEvent = options.publishEvent
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

  private cloneModels(models: readonly MODEL_META[]): MODEL_META[] {
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

  private resolveNewApiEffectiveModelType(
    model: ProviderModelRouteSource,
    config?: ModelRouteConfig
  ): ModelType | undefined {
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

    return undefined
  }

  resolveProviderModelRouteMetadata(
    providerId: string,
    model: ProviderModelRouteSource,
    config?: ModelRouteConfig
  ): ProviderModelRouteMetadata {
    const isUserConfig = config?.isUserDefined === true
    const storedEndpointType = isNewApiEndpointType(model.endpointType)
      ? model.endpointType
      : undefined
    const configuredEndpointType = isNewApiEndpointType(config?.endpointType)
      ? config.endpointType
      : undefined
    const endpointType = isUserConfig
      ? (configuredEndpointType ?? storedEndpointType)
      : (storedEndpointType ?? configuredEndpointType)
    const storedOwnedBy = typeof model.ownedBy === 'string' ? model.ownedBy : undefined
    const configuredOwnedBy = typeof config?.ownedBy === 'string' ? config.ownedBy : undefined
    const ownedBy = isUserConfig
      ? (configuredOwnedBy ?? storedOwnedBy)
      : (storedOwnedBy ?? configuredOwnedBy)
    const storedType = isModelType(model.type) ? model.type : undefined
    const configuredType = isModelType(config?.type) ? config.type : undefined
    const preferredType = isUserConfig
      ? (configuredType ?? storedType)
      : (storedType ?? configuredType)
    const modelWithRoute = {
      ...model,
      endpointType,
      ownedBy
    }
    const type =
      providerId === 'new-api'
        ? this.resolveNewApiEffectiveModelType(modelWithRoute, config)
        : (resolveVideoGenerationCompatType({
            modelId: model.id,
            type: preferredType,
            apiEndpoint: config?.apiEndpoint,
            endpointType,
            supportedEndpointTypes: model.supportedEndpointTypes
          }) ?? preferredType)

    return {
      endpointType,
      supportedEndpointTypes: Array.isArray(model.supportedEndpointTypes)
        ? model.supportedEndpointTypes.filter(isNewApiEndpointType)
        : undefined,
      type,
      ownedBy
    }
  }

  private getStoredProviderModels(providerId: string): readonly MODEL_META[] {
    const cached = this.providerModelsCache.get(providerId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.models
    }

    const store = this.getProviderModelStore(providerId)
    const storedModels = (store.get('models') || []) as MODEL_META[]
    const normalizedStoredModels = storedModels.map((model) =>
      this.normalizeStoredModel(
        stripDerivedProviderModelFields(model, providerId),
        providerId,
        'getProviderModels'
      )
    )

    const incorrectProviderIds = normalizedStoredModels.filter(
      (model) => model.providerId !== providerId
    )
    if (incorrectProviderIds.length > 0) {
      console.error(
        `[ProviderModelHelper] getProviderModels: Found ${incorrectProviderIds.length} models with incorrect providerId for provider "${providerId}"`
      )
    }

    const cachedModels = this.cloneModels(normalizedStoredModels)
    this.providerModelsCache.set(providerId, {
      expiresAt: Date.now() + PROVIDER_MODEL_CACHE_TTL_MS,
      models: cachedModels,
      modelsById: new Map(cachedModels.map((model) => [model.id, model]))
    })

    return normalizedStoredModels
  }

  getProviderModels(providerId: string): MODEL_META[] {
    return this.cloneModels(this.getStoredProviderModels(providerId))
  }

  getProviderModel(providerId: string, modelId: string): MODEL_META | undefined {
    const store = this.getProviderModelStore(providerId)
    const cached = this.providerModelsCache.get(providerId)
    const hasFreshCache = cached !== undefined && cached.expiresAt > Date.now()
    if (cached && hasFreshCache) {
      const cachedModel = cached.modelsById.get(modelId)
      if (cachedModel) {
        return this.cloneModel(cachedModel)
      }
    }

    if (store.getProviderModel) {
      const providerModel = store.getProviderModel('provider', modelId)
      if (providerModel) {
        return this.normalizeStoredModel(
          stripDerivedProviderModelFields(providerModel, providerId),
          providerId,
          'getProviderModel'
        )
      }
      const customModel = store.getProviderModel('custom', modelId)
      return customModel
        ? this.normalizeStoredModel(customModel, providerId, 'getProviderModel')
        : undefined
    }

    const providerModel = this.getStoredProviderModels(providerId).find(
      (model) => model.id === modelId
    )
    if (providerModel) {
      return this.cloneModel(providerModel)
    }

    const customModel = ((store.get('custom_models') || []) as MODEL_META[]).find(
      (model) => model.id === modelId
    )
    return customModel
      ? this.normalizeStoredModel(customModel, providerId, 'getProviderModel')
      : undefined
  }

  getProviderModelRouteMetadata(
    providerId: string,
    modelId: string,
    resolvedConfig?: ModelRouteConfig
  ): ProviderModelRouteMetadata | undefined {
    const store = this.getProviderModelStore(providerId)
    let cached = this.providerModelsCache.get(providerId)
    if ((!cached || cached.expiresAt <= Date.now()) && !store.getProviderModel) {
      this.getStoredProviderModels(providerId)
      cached = this.providerModelsCache.get(providerId)
    }
    const hasFreshCache = Boolean(cached && cached.expiresAt > Date.now())
    const cachedModel = hasFreshCache ? cached?.modelsById.get(modelId) : undefined
    const rawStoredModel =
      cachedModel !== undefined || !store.getProviderModel
        ? undefined
        : store.getProviderModel('provider', modelId)
    const storedModel =
      cachedModel ??
      (rawStoredModel
        ? this.normalizeStoredModel(
            stripDerivedProviderModelFields(rawStoredModel, providerId),
            providerId,
            'getProviderModelRouteMetadata'
          )
        : undefined)
    if (storedModel) {
      return this.resolveProviderModelRouteMetadata(providerId, storedModel, resolvedConfig)
    }

    const customModel = store.getProviderModel
      ? store.getProviderModel('custom', modelId)
      : ((store.get('custom_models') || []) as MODEL_META[]).find((model) => model.id === modelId)
    if (!customModel) {
      return undefined
    }

    return this.resolveProviderModelRouteMetadata(providerId, customModel, resolvedConfig)
  }

  setProviderModels(providerId: string, models: MODEL_META[]): void {
    logger.info(
      `[ProviderModelHelper] setProviderModels: storing ${models.length} models for provider "${providerId}"`
    )

    // Validate and fix providerId for all models before storing
    const validatedModels = models.map((model) =>
      this.normalizeStoredModel(
        stripDerivedProviderModelFields(model, providerId),
        providerId,
        'setProviderModels'
      )
    )

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
    return customModels.map((model) =>
      this.normalizeStoredModel(model, providerId, 'getCustomModels')
    )
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
    emitModelsChanged(this.publishEvent, providerId)
  }

  removeCustomModel(providerId: string, modelId: string): void {
    const models = this.getCustomModels(providerId)
    const filteredModels = models.filter((model) => model.id !== modelId)
    this.setCustomModels(providerId, filteredModels)
    this.deleteModelStatus(providerId, modelId)
    emitModelsChanged(this.publishEvent, providerId)
  }

  updateCustomModel(providerId: string, modelId: string, updates: Partial<MODEL_META>): void {
    const models = this.getCustomModels(providerId)
    const index = models.findIndex((model) => model.id === modelId)
    if (index !== -1) {
      models[index] = { ...models[index], ...updates }
      this.setCustomModels(providerId, models)
      emitModelsChanged(this.publishEvent, providerId)
    }
  }
}
