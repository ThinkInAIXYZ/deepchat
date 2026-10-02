import type { StoreLike } from '@/config/storeLike'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import { emitModelBatchStatusChanged, emitModelStatusChanged } from './eventPublishers'
import {
  decodeModelStatusKey,
  encodeLegacyModelStatusKey,
  encodeModelStatusKey,
  LEGACY_MODEL_STATUS_KEY_PREFIX
} from './modelStatusKey'

type SetSetting = <T>(key: string, value: T) => void

interface ModelStatusHelperOptions {
  store: StoreLike<any>
  setSetting: SetSetting
  publishEvent: DeepchatEventPublisher
}

export class ModelStatusHelper {
  private store: StoreLike<any>
  private readonly setSetting: SetSetting
  private readonly cache: Map<string, boolean> = new Map()
  private readonly publishEvent: DeepchatEventPublisher
  private statusSnapshot: Map<string, boolean> | null = null

  constructor(options: ModelStatusHelperOptions) {
    this.store = options.store
    this.setSetting = options.setSetting
    this.publishEvent = options.publishEvent
  }

  private getStatusKey(providerId: string, modelId: string): string {
    return encodeModelStatusKey(providerId, modelId)
  }

  private getLegacyStatusKey(providerId: string, modelId: string): string {
    return encodeLegacyModelStatusKey(providerId, modelId)
  }

  private getStoredStatus(
    statusKey: string,
    legacyStatusKey: string,
    statusSnapshot: Map<string, boolean> | null
  ): boolean | undefined {
    if (statusSnapshot) {
      return statusSnapshot.get(statusKey) ?? statusSnapshot.get(legacyStatusKey)
    }

    const status = this.store.get(statusKey)
    if (typeof status === 'boolean') {
      return status
    }

    const legacyStatus = this.store.get(legacyStatusKey)
    if (typeof legacyStatus === 'boolean') {
      return legacyStatus
    }
    return undefined
  }

  private getRawStoreEntries(): [string, unknown][] | null {
    const candidate = this.store as StoreLike<Record<string, unknown>> & {
      store?: Record<string, unknown>
    }
    const rawStore = candidate.store
    if (!rawStore || typeof rawStore !== 'object') {
      return null
    }

    return Object.entries(rawStore)
  }

  private buildStatusSnapshot(): Map<string, boolean> | null {
    const rawEntries = this.getRawStoreEntries()
    if (!rawEntries) {
      return null
    }

    const snapshot = new Map<string, boolean>()
    for (const [key, value] of rawEntries) {
      if (!key.startsWith(LEGACY_MODEL_STATUS_KEY_PREFIX)) {
        continue
      }

      if (typeof value !== 'boolean') {
        continue
      }

      snapshot.set(key, value)
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
    const legacyStatusKey = this.getLegacyStatusKey(providerId, modelId)
    const finalStatus = this.getStoredStatus(statusKey, legacyStatusKey, statusSnapshot) ?? false
    this.cache.set(statusKey, finalStatus)
    return finalStatus
  }

  getBatchModelStatus(providerId: string, modelIds: string[]): Record<string, boolean> {
    const result: Record<string, boolean> = {}
    const statusSnapshot = this.getStatusSnapshot()

    if (statusSnapshot) {
      for (const modelId of modelIds) {
        const statusKey = this.getStatusKey(providerId, modelId)
        const legacyStatusKey = this.getLegacyStatusKey(providerId, modelId)
        const status = this.getStoredStatus(statusKey, legacyStatusKey, statusSnapshot) ?? false
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
      const legacyStatusKey = this.getLegacyStatusKey(providerId, modelId)
      const finalStatus = this.getStoredStatus(statusKey, legacyStatusKey, null) ?? false
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

    const candidate = this.store as StoreLike<Record<string, unknown>> & {
      has?: (key: string) => boolean
    }
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
    emitModelStatusChanged(
      {
        providerId,
        modelId,
        enabled
      },
      this.publishEvent
    )
  }

  enableModel(providerId: string, modelId: string): void {
    this.setModelStatus(providerId, modelId, true)
  }

  disableModel(providerId: string, modelId: string): void {
    this.setModelStatus(providerId, modelId, false)
  }

  ensureModelStatus(providerId: string, modelId: string, enabled: boolean): void {
    const statusKey = this.getStatusKey(providerId, modelId)
    const legacyStatusKey = this.getLegacyStatusKey(providerId, modelId)

    if (
      this.cache.has(statusKey) ||
      this.hasStoredStatus(statusKey) ||
      this.hasStoredStatus(legacyStatusKey)
    ) {
      if (!this.cache.has(statusKey)) {
        const statusSnapshot = this.getStatusSnapshot()
        const status = this.getStoredStatus(statusKey, legacyStatusKey, statusSnapshot)
        this.cache.set(statusKey, status ?? false)
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
    for (const key of this.cache.keys()) {
      if (decodeModelStatusKey(key)?.providerId === providerId) this.cache.delete(key)
    }
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

    emitModelBatchStatusChanged(
      {
        providerId,
        updates
      },
      this.publishEvent
    )
  }

  batchSetModelStatus(providerId: string, modelStatusMap: Record<string, boolean>): void {
    for (const [modelId, enabled] of Object.entries(modelStatusMap)) {
      this.setModelStatus(providerId, modelId, enabled)
    }
  }

  deleteModelStatus(providerId: string, modelId: string): void {
    const statusKey = this.getStatusKey(providerId, modelId)
    const legacyStatusKey = this.getLegacyStatusKey(providerId, modelId)
    if (this.hasStoredStatus(legacyStatusKey)) {
      this.setSetting(statusKey, false)
      this.cache.set(statusKey, false)
      this.statusSnapshot?.set(statusKey, false)
    } else {
      this.store.delete(statusKey)
      this.cache.delete(statusKey)
      this.statusSnapshot?.delete(statusKey)
    }
  }

  deleteProviderModelStatuses(providerId: string): void {
    const store = this.store as StoreLike<any> & {
      deleteProviderModelStatuses?: (id: string) => void
    }
    if (store.deleteProviderModelStatuses) {
      store.deleteProviderModelStatuses(providerId)
    } else {
      const keys = new Set((this.getRawStoreEntries() ?? []).map(([key]) => key))
      for (const key of this.cache.keys()) keys.add(key)
      for (const key of keys) {
        if (decodeModelStatusKey(key)?.providerId === providerId) this.store.delete(key)
      }
    }
    this.cache.clear()
    this.statusSnapshot = null
  }
}
