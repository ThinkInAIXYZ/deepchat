import { eventBus, SendTarget } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'
import ElectronStore from 'electron-store'

type SetSetting = <T>(key: string, value: T) => void

const MODEL_STATUS_KEY_PREFIX = 'model_status_'

interface ModelStatusHelperOptions {
  store: ElectronStore<any>
  setSetting: SetSetting
}

export class ModelStatusHelper {
  private readonly store: ElectronStore<any>
  private readonly setSetting: SetSetting
  private readonly cache: Map<string, boolean> = new Map()

  constructor(options: ModelStatusHelperOptions) {
    this.store = options.store
    this.setSetting = options.setSetting
  }

  private getStatusKey(providerId: string, modelId: string): string {
    const formattedModelId = modelId.replace(/\./g, '-')
    return `${MODEL_STATUS_KEY_PREFIX}${providerId}_${formattedModelId}`
  }

  getModelStatus(providerId: string, modelId: string): boolean {
    const statusKey = this.getStatusKey(providerId, modelId)
    if (this.cache.has(statusKey)) {
      return this.cache.get(statusKey)!
    }

    const status = this.store.get(statusKey) as boolean | undefined
    const finalStatus = typeof status === 'boolean' ? status : false
    this.cache.set(statusKey, finalStatus)
    return finalStatus
  }

  getBatchModelStatus(providerId: string, modelIds: string[]): Record<string, boolean> {
    const result: Record<string, boolean> = {}
    const uncachedKeys: string[] = []
    const uncachedModelIds: string[] = []

    for (const modelId of modelIds) {
      const statusKey = this.getStatusKey(providerId, modelId)
      if (this.cache.has(statusKey)) {
        result[modelId] = this.cache.get(statusKey)!
      } else {
        uncachedKeys.push(statusKey)
        uncachedModelIds.push(modelId)
      }
    }

    for (let i = 0; i < uncachedModelIds.length; i++) {
      const modelId = uncachedModelIds[i]
      const statusKey = uncachedKeys[i]
      const status = this.store.get(statusKey) as boolean | undefined
      const finalStatus = typeof status === 'boolean' ? status : false
      this.cache.set(statusKey, finalStatus)
      result[modelId] = finalStatus
    }

    return result
  }

  setModelStatus(providerId: string, modelId: string, enabled: boolean): void {
    const statusKey = this.getStatusKey(providerId, modelId)
    this.setSetting(statusKey, enabled)
    this.cache.set(statusKey, enabled)
    eventBus.sendToRenderer(CONFIG_EVENTS.MODEL_STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
      providerId,
      modelId,
      enabled
    })
  }

  enableModel(providerId: string, modelId: string): void {
    this.setModelStatus(providerId, modelId, true)
  }

  disableModel(providerId: string, modelId: string): void {
    this.setModelStatus(providerId, modelId, false)
  }

  clearModelStatusCache(): void {
    this.cache.clear()
  }

  clearProviderModelStatusCache(providerId: string): void {
    const prefix = `${MODEL_STATUS_KEY_PREFIX}${providerId}_`
    const keysToDelete: string[] = []
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key)
      }
    }
    keysToDelete.forEach((key) => this.cache.delete(key))
  }

  batchSetModelStatus(providerId: string, modelStatusMap: Record<string, boolean>): void {
    for (const [modelId, enabled] of Object.entries(modelStatusMap)) {
      this.setModelStatus(providerId, modelId, enabled)
    }
  }

  deleteModelStatus(providerId: string, modelId: string): void {
    const statusKey = this.getStatusKey(providerId, modelId)
    this.store.delete(statusKey)
    this.cache.delete(statusKey)
  }
}
