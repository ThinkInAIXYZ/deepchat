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
  private statusSnapshot: Map<string, boolean> | null = null

  constructor(options: ModelStatusHelperOptions) {
    this.store = options.store
    this.setSetting = options.setSetting
  }

  private getStatusKey(providerId: string, modelId: string): string {
    const formattedModelId = modelId.replace(/\./g, '-')
    return `${MODEL_STATUS_KEY_PREFIX}${providerId}_${formattedModelId}`
  }

  private buildStatusSnapshot(): Map<string, boolean> | null {
    const candidate = this.store as ElectronStore<any> & {
      store?: Record<string, unknown>
    }
    const rawStore = candidate.store
    if (!rawStore || typeof rawStore !== 'object') {
      return null
    }

    const snapshot = new Map<string, boolean>()
    for (const [key, value] of Object.entries(rawStore)) {
      if (!key.startsWith(MODEL_STATUS_KEY_PREFIX)) {
        continue
      }

      if (typeof value !== 'boolean') {
        continue
      }

      snapshot.set(key, value)
      this.cache.set(key, value)
    }

    return snapshot
  }

  private getStatusSnapshot(): Map<string, boolean> | null {
    if (this.statusSnapshot) {
      return this.statusSnapshot
    }

    this.statusSnapshot = this.buildStatusSnapshot()
    return this.statusSnapshot
  }

  getModelStatus(providerId: string, modelId: string): boolean {
    const statusKey = this.getStatusKey(providerId, modelId)
    if (this.cache.has(statusKey)) {
      return this.cache.get(statusKey)!
    }

    const statusSnapshot = this.getStatusSnapshot()
    if (statusSnapshot) {
      const status = statusSnapshot.get(statusKey) ?? false
      this.cache.set(statusKey, status)
      return status
    }

    const status = this.store.get(statusKey) as boolean | undefined
    const finalStatus = typeof status === 'boolean' ? status : false
    this.cache.set(statusKey, finalStatus)
    return finalStatus
  }

  getBatchModelStatus(providerId: string, modelIds: string[]): Record<string, boolean> {
    const result: Record<string, boolean> = {}
    const statusSnapshot = this.getStatusSnapshot()

    if (statusSnapshot) {
      for (const modelId of modelIds) {
        const statusKey = this.getStatusKey(providerId, modelId)
        const status = statusSnapshot.get(statusKey) ?? false
        this.cache.set(statusKey, status)
        result[modelId] = status
      }

      return result
    }

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

  private hasStoredStatus(statusKey: string): boolean {
    const statusSnapshot = this.getStatusSnapshot()
    if (statusSnapshot) {
      return statusSnapshot.has(statusKey)
    }

    const candidate = this.store as ElectronStore<any> & { has?: (key: string) => boolean }
    if (typeof candidate.has === 'function') {
      return candidate.has(statusKey)
    }
    return this.store.get(statusKey) !== undefined
  }

  setModelStatus(providerId: string, modelId: string, enabled: boolean): void {
    const statusKey = this.getStatusKey(providerId, modelId)
    this.setSetting(statusKey, enabled)
    this.cache.set(statusKey, enabled)
    this.statusSnapshot?.set(statusKey, enabled)
    eventBus.send(CONFIG_EVENTS.MODEL_STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
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

  ensureModelStatus(providerId: string, modelId: string, enabled: boolean): void {
    const statusKey = this.getStatusKey(providerId, modelId)

    if (this.cache.has(statusKey) || this.hasStoredStatus(statusKey)) {
      if (!this.cache.has(statusKey)) {
        const statusSnapshot = this.getStatusSnapshot()
        if (statusSnapshot) {
          this.cache.set(statusKey, statusSnapshot.get(statusKey) ?? false)
        } else {
          const status = this.store.get(statusKey) as boolean | undefined
          this.cache.set(statusKey, typeof status === 'boolean' ? status : false)
        }
      }
      return
    }

    this.store.set(statusKey, enabled)
    this.cache.set(statusKey, enabled)
    this.statusSnapshot?.set(statusKey, enabled)
  }

  clearModelStatusCache(): void {
    this.cache.clear()
    this.statusSnapshot = null
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
    this.statusSnapshot = null
  }

  batchSetModelStatusQuiet(providerId: string, modelStatusMap: Record<string, boolean>): void {
    const persistedStatuses: Record<string, boolean> = {}
    const updates: { modelId: string; enabled: boolean }[] = []

    for (const [modelId, enabled] of Object.entries(modelStatusMap)) {
      const statusKey = this.getStatusKey(providerId, modelId)
      persistedStatuses[statusKey] = enabled
      updates.push({ modelId, enabled })
    }

    if (updates.length === 0) {
      return
    }

    this.store.set(persistedStatuses)

    for (const [statusKey, enabled] of Object.entries(persistedStatuses)) {
      this.cache.set(statusKey, enabled)
      this.statusSnapshot?.set(statusKey, enabled)
    }

    eventBus.send(CONFIG_EVENTS.MODEL_BATCH_STATUS_CHANGED, SendTarget.ALL_WINDOWS, {
      providerId,
      updates
    })
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
    this.statusSnapshot?.delete(statusKey)
  }
}
