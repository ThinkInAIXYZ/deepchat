import { eventBus, SendTarget } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'
import { ModelConfig, MODEL_META } from '@shared/presenter'
import { ModelType } from '@shared/model'
import ElectronStore from 'electron-store'
import path from 'path'

export interface IModelStore {
  models: MODEL_META[]
  custom_models: MODEL_META[]
}

export const PROVIDER_MODELS_DIR = 'provider_models'

type ModelConfigResolver = (modelId: string, providerId?: string) => ModelConfig

type ModelStatusUpdater = (providerId: string, modelId: string, enabled: boolean) => void

type ModelStatusRemover = (providerId: string, modelId: string) => void

interface ProviderModelHelperOptions {
  userDataPath: string
  getModelConfig: ModelConfigResolver
  setModelStatus: ModelStatusUpdater
  deleteModelStatus: ModelStatusRemover
}

export class ProviderModelHelper {
  private readonly userDataPath: string
  private readonly getModelConfig: ModelConfigResolver
  private readonly setModelStatus: ModelStatusUpdater
  private readonly deleteModelStatus: ModelStatusRemover
  private readonly stores: Map<string, ElectronStore<IModelStore>> = new Map()

  constructor(options: ProviderModelHelperOptions) {
    this.userDataPath = options.userDataPath
    this.getModelConfig = options.getModelConfig
    this.setModelStatus = options.setModelStatus
    this.deleteModelStatus = options.deleteModelStatus
  }

  getProviderModelStore(providerId: string): ElectronStore<IModelStore> {
    if (!this.stores.has(providerId)) {
      const storeName = `models_${providerId}`
      const storePath = path.join(this.userDataPath, PROVIDER_MODELS_DIR)
      console.log(
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
      this.stores.set(providerId, store)
      console.log(
        `[ProviderModelHelper] getProviderModelStore: store "${storeName}" created and cached for provider "${providerId}"`
      )
    }
    return this.stores.get(providerId)!
  }

  getProviderModels(providerId: string): MODEL_META[] {
    const store = this.getProviderModelStore(providerId)
    let models = store.get('models') || []
    console.log(
      `[ProviderModelHelper] getProviderModels: reading ${models.length} models for provider "${providerId}"`
    )

    const result = models.map((model) => {
      // Validate and fix providerId if incorrect
      if (model.providerId && model.providerId !== providerId) {
        console.warn(
          `[ProviderModelHelper] getProviderModels: Model ${model.id} has incorrect providerId: expected "${providerId}", got "${model.providerId}". Fixing it.`
        )
        model.providerId = providerId
      } else if (!model.providerId) {
        console.warn(
          `[ProviderModelHelper] getProviderModels: Model ${model.id} missing providerId, setting to "${providerId}"`
        )
        model.providerId = providerId
      }

      const config = this.getModelConfig(model.id, providerId)
      if (config) {
        model.maxTokens = config.maxTokens
        model.contextLength = config.contextLength
        model.vision = model.vision !== undefined ? model.vision : config.vision || false
        model.functionCall =
          model.functionCall !== undefined ? model.functionCall : config.functionCall || false
        model.reasoning =
          model.reasoning !== undefined ? model.reasoning : config.reasoning || false
        model.type = model.type !== undefined ? model.type : config.type || ModelType.Chat
      } else {
        model.vision = model.vision || false
        model.functionCall = model.functionCall || false
        model.reasoning = model.reasoning || false
        model.type = model.type || ModelType.Chat
      }
      return model
    })

    // Log validation results
    const incorrectProviderIds = result.filter((m) => m.providerId !== providerId)
    if (incorrectProviderIds.length > 0) {
      console.error(
        `[ProviderModelHelper] getProviderModels: Found ${incorrectProviderIds.length} models with incorrect providerId for provider "${providerId}"`
      )
    }

    return result
  }

  setProviderModels(providerId: string, models: MODEL_META[]): void {
    console.log(
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
    console.log(
      `[ProviderModelHelper] setProviderModels: stored ${validatedModels.length} models for provider "${providerId}"`
    )
  }

  getCustomModels(providerId: string): MODEL_META[] {
    const store = this.getProviderModelStore(providerId)
    const customModels = (store.get('custom_models') || []) as MODEL_META[]
    return customModels.map((model) => {
      model.vision = model.vision !== undefined ? model.vision : false
      model.functionCall = model.functionCall !== undefined ? model.functionCall : false
      model.reasoning = model.reasoning !== undefined ? model.reasoning : false
      model.enableSearch = model.enableSearch !== undefined ? model.enableSearch : false
      model.type = model.type || ModelType.Chat
      return model
    })
  }

  setCustomModels(providerId: string, models: MODEL_META[]): void {
    const store = this.getProviderModelStore(providerId)
    store.set('custom_models', models)
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
    eventBus.send(CONFIG_EVENTS.MODEL_LIST_CHANGED, SendTarget.ALL_WINDOWS, providerId)
  }

  removeCustomModel(providerId: string, modelId: string): void {
    const models = this.getCustomModels(providerId)
    const filteredModels = models.filter((model) => model.id !== modelId)
    this.setCustomModels(providerId, filteredModels)
    this.deleteModelStatus(providerId, modelId)
    eventBus.send(CONFIG_EVENTS.MODEL_LIST_CHANGED, SendTarget.ALL_WINDOWS, providerId)
  }

  updateCustomModel(providerId: string, modelId: string, updates: Partial<MODEL_META>): void {
    const models = this.getCustomModels(providerId)
    const index = models.findIndex((model) => model.id === modelId)
    if (index !== -1) {
      models[index] = { ...models[index], ...updates }
      this.setCustomModels(providerId, models)
      eventBus.send(CONFIG_EVENTS.MODEL_LIST_CHANGED, SendTarget.ALL_WINDOWS, providerId)
    }
  }
}
