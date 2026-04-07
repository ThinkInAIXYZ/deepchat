import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import {
  ProviderAggregate,
  ProviderEntry,
  ProviderModel,
  sanitizeAggregate
} from '@shared/types/model-db'
import { resolveProviderId } from './providerId'
import { PROVIDER_DB_SUPPLEMENTS } from './providerDbSupplements'
import { eventBus, SendTarget } from '@/eventbus'
import { PROVIDER_DB_EVENTS } from '@/events'

const DEFAULT_PROVIDER_DB_URL =
  'https://raw.githubusercontent.com/ThinkInAIXYZ/PublicProviderConf/refs/heads/dev/dist/all.json'

type MetaFile = {
  sourceUrl: string
  etag?: string
  lastUpdated: number
  ttlHours: number
  lastAttemptedAt?: number
}

export type ProviderDbRefreshResult = {
  status: 'updated' | 'not-modified' | 'skipped' | 'error'
  lastUpdated: number | null
  providersCount: number
  message?: string
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const cloneValue = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

const mergeDefinedValue = <T>(base: T, override: unknown): T => {
  if (override === undefined) {
    return cloneValue(base)
  }

  if (!isPlainObject(override)) {
    return cloneValue(override as T)
  }

  const result: Record<string, unknown> = isPlainObject(base) ? cloneValue(base) : {}

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue

    const current = result[key]
    result[key] =
      isPlainObject(current) && isPlainObject(value)
        ? mergeDefinedValue(current, value)
        : cloneValue(value)
  }

  return result as T
}

const mergeProviderModels = (
  baseModels: ProviderModel[],
  supplementModels: ProviderModel[] | undefined
): ProviderModel[] => {
  const mergedModels = baseModels.map((model) => cloneValue(model))

  if (!supplementModels || supplementModels.length === 0) {
    return mergedModels
  }

  const modelIndexById = new Map(mergedModels.map((model, index) => [model.id, index]))

  for (const supplementModel of supplementModels) {
    const existingIndex = modelIndexById.get(supplementModel.id)

    if (existingIndex === undefined) {
      modelIndexById.set(supplementModel.id, mergedModels.length)
      mergedModels.push(cloneValue(supplementModel))
      continue
    }

    const existingModel = mergedModels[existingIndex]
    const mergedModel = mergeDefinedValue(existingModel, supplementModel)

    if (existingModel.name) {
      mergedModel.name = existingModel.name
    }

    if (existingModel.display_name) {
      mergedModel.display_name = existingModel.display_name
    }

    mergedModels[existingIndex] = mergedModel
  }

  return mergedModels
}

const mergeProviderAggregate = (
  base: ProviderAggregate | null,
  supplement: ProviderAggregate
): ProviderAggregate => {
  const mergedProviders = base ? cloneValue(base.providers) : {}

  for (const [providerId, supplementProvider] of Object.entries(supplement.providers)) {
    const existingProvider = mergedProviders[providerId]

    if (!existingProvider) {
      mergedProviders[providerId] = cloneValue(supplementProvider)
      continue
    }

    const { models: _existingModels, ...existingWithoutModels } = existingProvider
    const { models: supplementModels, ...supplementWithoutModels } = supplementProvider

    mergedProviders[providerId] = {
      ...mergeDefinedValue(existingWithoutModels, supplementWithoutModels),
      models: mergeProviderModels(existingProvider.models, supplementModels)
    }
  }

  return {
    providers: mergedProviders
  }
}

export class ProviderDbLoader {
  private cache: ProviderAggregate | null = null
  private userDataDir: string
  private cacheDir: string
  private cacheFilePath: string
  private metaFilePath: string
  private refreshPromise: Promise<ProviderDbRefreshResult> | null = null

  constructor() {
    this.userDataDir = app.getPath('userData')
    this.cacheDir = path.join(this.userDataDir, 'provider-db')
    this.cacheFilePath = path.join(this.cacheDir, 'providers.json')
    this.metaFilePath = path.join(this.cacheDir, 'meta.json')

    try {
      if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true })
    } catch {}
  }

  // Public: initialize on app start (non-blocking refresh)
  async initialize(): Promise<void> {
    // Load from cache or built-in
    this.cache = this.applySupplements(this.loadFromCache() ?? this.loadFromBuiltIn())
    if (this.cache) {
      try {
        const providersCount = Object.keys(this.cache.providers || {}).length
        eventBus.send(PROVIDER_DB_EVENTS.LOADED, SendTarget.ALL_WINDOWS, {
          providersCount
        })
      } catch {}
    }

    // Always refresh once in the background on startup to pick up upstream updates.
    void this.refreshIfNeeded(true)
      .then((result) => {
        if (result.status === 'error') {
          console.warn('[ProviderDbLoader] Startup refresh failed:', result.message)
        }
      })
      .catch((error) => {
        console.warn('[ProviderDbLoader] Startup refresh failed:', error)
      })
  }

  getDb(): ProviderAggregate | null {
    if (this.cache) return this.cache
    // Lazy try again if not initialized yet
    this.cache = this.applySupplements(this.loadFromCache() ?? this.loadFromBuiltIn())
    return this.cache
  }

  getProvider(providerId: string): ProviderEntry | undefined {
    const db = this.getDb()
    if (!db) return undefined
    const resolvedId = resolveProviderId(providerId)
    return db.providers?.[resolvedId ?? providerId]
  }

  getModel(providerId: string, modelId: string): ProviderModel | undefined {
    const provider = this.getProvider(providerId)
    if (!provider) return undefined
    return provider.models.find((m) => m.id === modelId)
  }

  getSourceUrl(): string {
    return this.readMeta()?.sourceUrl?.trim() || this.getProviderDbUrl()
  }

  private loadFromCache(): ProviderAggregate | null {
    try {
      if (!fs.existsSync(this.cacheFilePath)) return null
      const raw = fs.readFileSync(this.cacheFilePath, 'utf-8')
      const parsed = JSON.parse(raw)
      const sanitized = sanitizeAggregate(parsed)
      if (!sanitized) return null
      return sanitized
    } catch {
      return null
    }
  }

  private loadFromBuiltIn(): ProviderAggregate | null {
    try {
      const helperPath = path.join(app.getAppPath(), 'resources', 'model-db', 'providers.json')
      if (!fs.existsSync(helperPath)) return null
      const raw = fs.readFileSync(helperPath, 'utf-8')
      const parsed = JSON.parse(raw)
      const sanitized = sanitizeAggregate(parsed)
      return sanitized ?? null
    } catch {
      return null
    }
  }

  private applySupplements(db: ProviderAggregate | null): ProviderAggregate {
    return mergeProviderAggregate(db, PROVIDER_DB_SUPPLEMENTS)
  }

  private readMeta(): MetaFile | null {
    try {
      if (!fs.existsSync(this.metaFilePath)) return null
      const raw = fs.readFileSync(this.metaFilePath, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  private writeMeta(meta: MetaFile): void {
    try {
      fs.writeFileSync(this.metaFilePath, JSON.stringify(meta, null, 2), 'utf-8')
    } catch {}
  }

  private writeCacheAtomically(db: ProviderAggregate): void {
    const tmp = this.cacheFilePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
    fs.renameSync(tmp, this.cacheFilePath)
  }

  private now(): number {
    return Date.now()
  }

  private getTtlHours(): number {
    const env = process.env.PROVIDER_DB_TTL_HOURS
    const v = env ? Number(env) : 4
    return Number.isFinite(v) && v > 0 ? v : 4
  }

  private getProviderDbUrl(): string {
    const value = import.meta.env.VITE_PROVIDER_DB_URL
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) return trimmed
    }

    return DEFAULT_PROVIDER_DB_URL
  }

  async refreshIfNeeded(force = false): Promise<ProviderDbRefreshResult> {
    if (this.refreshPromise) return this.refreshPromise

    const meta = this.readMeta()
    const ttlHours = this.getTtlHours()
    const url = this.getProviderDbUrl()

    const needFirstFetch = !meta || !fs.existsSync(this.cacheFilePath)
    const freshnessTimestamp = meta?.lastAttemptedAt ?? meta?.lastUpdated ?? 0
    const expired = meta ? this.now() - freshnessTimestamp > ttlHours * 3600 * 1000 : true

    if (!force && !needFirstFetch && !expired) {
      return this.createResult('skipped', meta)
    }

    this.refreshPromise = this.fetchAndUpdate(url, meta || undefined).finally(() => {
      this.refreshPromise = null
    })

    return this.refreshPromise
  }

  private createResult(
    status: ProviderDbRefreshResult['status'],
    meta?: MetaFile | null,
    message?: string
  ): ProviderDbRefreshResult {
    const db = this.getDb()
    const providersCount = Object.keys(db?.providers || {}).length
    return {
      status,
      lastUpdated: meta?.lastUpdated ?? null,
      providersCount,
      ...(message ? { message } : {})
    }
  }

  private createAttemptMeta(
    prevMeta: MetaFile | undefined,
    url: string,
    now: number
  ): MetaFile | null {
    if (!prevMeta) return null
    return {
      ...prevMeta,
      sourceUrl: url,
      ttlHours: this.getTtlHours(),
      lastAttemptedAt: now
    }
  }

  private async fetchAndUpdate(url: string, prevMeta?: MetaFile): Promise<ProviderDbRefreshResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const headers: Record<string, string> = {}
      if (prevMeta?.etag) headers['If-None-Match'] = prevMeta.etag

      const res = await fetch(url, { headers, signal: controller.signal })
      const now = this.now()

      if (res.status === 304 && prevMeta) {
        const meta: MetaFile = {
          ...prevMeta,
          sourceUrl: url,
          ttlHours: this.getTtlHours(),
          lastAttemptedAt: now
        }
        this.writeMeta(meta)
        return this.createResult('not-modified', meta)
      }

      if (!res.ok) {
        const meta = this.createAttemptMeta(prevMeta, url, now)
        if (meta) this.writeMeta(meta)
        return this.createResult('error', meta, `Request failed with status ${res.status}`)
      }

      const text = await res.text()
      // Size guard (≈ 5MB)
      if (text.length > 5 * 1024 * 1024) {
        const meta = this.createAttemptMeta(prevMeta, url, now)
        if (meta) this.writeMeta(meta)
        return this.createResult('error', meta, 'Provider DB payload exceeds size limit')
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        const meta = this.createAttemptMeta(prevMeta, url, now)
        if (meta) this.writeMeta(meta)
        return this.createResult('error', meta, 'Provider DB payload is not valid JSON')
      }

      const sanitized = sanitizeAggregate(parsed)
      if (!sanitized) {
        const meta = this.createAttemptMeta(prevMeta, url, now)
        if (meta) this.writeMeta(meta)
        return this.createResult('error', meta, 'Provider DB payload failed validation')
      }

      const etag = res.headers.get('etag') || undefined
      const meta: MetaFile = {
        sourceUrl: url,
        etag,
        lastUpdated: now,
        ttlHours: this.getTtlHours(),
        lastAttemptedAt: now
      }

      // Write cache atomically and update in-memory
      this.writeCacheAtomically(sanitized)
      this.writeMeta(meta)
      this.cache = this.applySupplements(sanitized)
      try {
        const providersCount = Object.keys(this.cache.providers || {}).length
        eventBus.send(PROVIDER_DB_EVENTS.UPDATED, SendTarget.ALL_WINDOWS, {
          providersCount,
          lastUpdated: meta.lastUpdated
        })
      } catch {}
      return this.createResult('updated', meta)
    } catch (error) {
      const meta = this.createAttemptMeta(prevMeta, url, this.now())
      if (meta) this.writeMeta(meta)
      const message = error instanceof Error ? error.message : 'Unknown provider DB refresh error'
      return this.createResult('error', meta, message)
    } finally {
      clearTimeout(timeout)
    }
  }
}

// Shared singleton
export const providerDbLoader = new ProviderDbLoader()
