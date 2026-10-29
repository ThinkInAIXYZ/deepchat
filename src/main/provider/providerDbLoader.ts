import fs from 'fs'
import path from 'path'
import {
  ProviderAggregate,
  ProviderEntry,
  ProviderModel,
  sanitizeAggregate
} from '@shared/types/model-db'
import { resolveProviderId } from './providerId'

const DEFAULT_PROVIDER_DB_URL =
  'https://raw.githubusercontent.com/ThinkInAIXYZ/PublicProviderConf/refs/heads/dev/dist/all.json'
const MAX_PROVIDER_DB_PAYLOAD_BYTES = 10 * 1024 * 1024
const PROVIDER_DB_SCHEMA_VERSION = 2

async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number
): Promise<string | null> {
  if (!response.body) {
    const text = await response.text()
    return Buffer.byteLength(text, 'utf8') <= maxBytes ? text : null
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const textChunks: string[] = []
  let bytesRead = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      bytesRead += value.byteLength
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      textChunks.push(decoder.decode(value, { stream: true }))
    }
    textChunks.push(decoder.decode())
    return textChunks.join('')
  } finally {
    reader.releaseLock()
  }
}

type MetaFile = {
  schemaVersion?: number
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

export type ProviderDbCatalogChange =
  | {
      reason: 'loaded'
      providersCount: number
    }
  | {
      reason: 'updated'
      providersCount: number
      lastUpdated: number
    }

export type ProviderDbCatalogListener = (change: ProviderDbCatalogChange) => void

export type ProviderDbBootstrap = {
  userDataDirectory: string
  builtInCatalogPath: string
}

export class ProviderDbLoader {
  private cache: ProviderAggregate | null = null
  private bootstrap: ProviderDbBootstrap | null = null
  private cacheDir = ''
  private cacheFilePath = ''
  private metaFilePath = ''
  private stopped = false
  private refreshController: AbortController | null = null
  private refreshPromise: Promise<ProviderDbRefreshResult> | null = null
  private privacyModeResolver: () => boolean = () => false
  private readonly catalogListeners = new Set<ProviderDbCatalogListener>()

  configure(bootstrap: ProviderDbBootstrap): void {
    if (this.stopped) throw new Error('Provider catalog is stopping')
    if (
      !path.isAbsolute(bootstrap.userDataDirectory) ||
      !path.isAbsolute(bootstrap.builtInCatalogPath)
    ) {
      throw new Error('Provider catalog paths must be absolute')
    }
    if (this.bootstrap) {
      if (
        this.bootstrap.userDataDirectory !== bootstrap.userDataDirectory ||
        this.bootstrap.builtInCatalogPath !== bootstrap.builtInCatalogPath
      ) {
        throw new Error('Provider catalog is already configured for another profile')
      }
      return
    }
    this.bootstrap = { ...bootstrap }
    this.cacheDir = path.join(bootstrap.userDataDirectory, 'provider-db')
    this.cacheFilePath = path.join(this.cacheDir, 'providers.json')
    this.metaFilePath = path.join(this.cacheDir, 'meta.json')

    try {
      if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true })
    } catch {}
  }

  stop(): void {
    this.stopped = true
    this.refreshController?.abort()
  }

  async drain(): Promise<void> {
    await this.refreshPromise
  }

  setPrivacyModeResolver(resolver?: () => boolean): void {
    this.privacyModeResolver = resolver ?? (() => false)
  }

  subscribeCatalogChanges(listener: ProviderDbCatalogListener): () => void {
    this.catalogListeners.add(listener)
    return () => this.catalogListeners.delete(listener)
  }

  // Load the initial catalog; the startup task owner schedules automatic refresh.
  async initialize(): Promise<void> {
    if (!this.bootstrap) throw new Error('Provider catalog paths are required')
    if (this.stopped) return
    // Load from cache or built-in
    this.cache = this.loadFromCache() ?? this.loadFromBuiltIn()
    if (this.cache) {
      this.notifyCatalogChanged({
        reason: 'loaded',
        providersCount: Object.keys(this.cache.providers || {}).length
      })
    }
  }

  getDb(): ProviderAggregate | null {
    if (this.cache) return this.cache
    if (!this.bootstrap || this.stopped) return null
    // Lazy try again if not initialized yet
    this.cache = this.loadFromCache() ?? this.loadFromBuiltIn()
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
      const helperPath = this.bootstrap?.builtInCatalogPath
      if (!helperPath) return null
      if (!fs.existsSync(helperPath)) return null
      const raw = fs.readFileSync(helperPath, 'utf-8')
      const parsed = JSON.parse(raw)
      const sanitized = sanitizeAggregate(parsed)
      return sanitized ?? null
    } catch {
      return null
    }
  }

  private readMeta(): MetaFile | null {
    if (!this.bootstrap || this.stopped) return null
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
    return DEFAULT_PROVIDER_DB_URL
  }

  async refreshIfNeeded(
    force = false,
    options: {
      automatic?: boolean
      signal?: AbortSignal
    } = {}
  ): Promise<ProviderDbRefreshResult> {
    if (!this.bootstrap) throw new Error('Provider catalog paths are required')
    if (this.stopped || options.signal?.aborted) return this.createResult('skipped')
    const meta = this.readMeta()
    if (options.automatic && this.isAutomaticRefreshBlocked()) {
      return this.createResult('skipped', meta)
    }

    if (this.refreshPromise) return this.refreshPromise

    const ttlHours = this.getTtlHours()
    const url = this.getProviderDbUrl()

    const needFirstFetch =
      meta?.schemaVersion !== PROVIDER_DB_SCHEMA_VERSION || !fs.existsSync(this.cacheFilePath)
    const freshnessTimestamp = meta?.lastAttemptedAt ?? meta?.lastUpdated ?? 0
    const expired = meta ? this.now() - freshnessTimestamp > ttlHours * 3600 * 1000 : true

    if (!force && !needFirstFetch && !expired) {
      return this.createResult('skipped', meta)
    }

    this.refreshPromise = this.fetchAndUpdate(url, meta || undefined, options.signal).finally(
      () => {
        this.refreshPromise = null
      }
    )

    return this.refreshPromise
  }

  private isAutomaticRefreshBlocked(): boolean {
    try {
      return Boolean(this.privacyModeResolver())
    } catch {
      return false
    }
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

  private async fetchAndUpdate(
    url: string,
    prevMeta?: MetaFile,
    signal?: AbortSignal
  ): Promise<ProviderDbRefreshResult> {
    const controller = new AbortController()
    this.refreshController = controller
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const headers: Record<string, string> = {}
      // Older sanitized caches discarded reasoning_options and must be downloaded again.
      if (prevMeta?.schemaVersion === PROVIDER_DB_SCHEMA_VERSION && prevMeta.etag) {
        headers['If-None-Match'] = prevMeta.etag
      }

      const res = await fetch(url, { headers, signal: requestSignal })
      if (this.stopped || signal?.aborted) return this.createResult('skipped', prevMeta)
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

      const text = await readResponseTextWithLimit(res, MAX_PROVIDER_DB_PAYLOAD_BYTES)
      if (this.stopped || signal?.aborted) return this.createResult('skipped', prevMeta)
      if (text === null) {
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
        schemaVersion: PROVIDER_DB_SCHEMA_VERSION,
        sourceUrl: url,
        etag,
        lastUpdated: now,
        ttlHours: this.getTtlHours(),
        lastAttemptedAt: now
      }

      // Write cache atomically and update in-memory
      this.writeCacheAtomically(sanitized)
      this.writeMeta(meta)
      this.cache = sanitized
      this.notifyCatalogChanged({
        reason: 'updated',
        providersCount: Object.keys(this.cache.providers || {}).length,
        lastUpdated: meta.lastUpdated
      })
      return this.createResult('updated', meta)
    } catch (error) {
      if (this.stopped || signal?.aborted) return this.createResult('skipped', prevMeta)
      const meta = this.createAttemptMeta(prevMeta, url, this.now())
      if (meta) this.writeMeta(meta)
      const message = error instanceof Error ? error.message : 'Unknown provider DB refresh error'
      return this.createResult('error', meta, message)
    } finally {
      clearTimeout(timeout)
      if (this.refreshController === controller) this.refreshController = null
    }
  }

  private notifyCatalogChanged(change: ProviderDbCatalogChange): void {
    for (const listener of this.catalogListeners) {
      try {
        listener(change)
      } catch (error) {
        console.warn('[ProviderDbLoader] Catalog change listener failed:', error)
      }
    }
  }
}

// Shared singleton
export const providerDbLoader = new ProviderDbLoader()
