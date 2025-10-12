import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import {
  ProviderAggregate,
  ProviderEntry,
  ProviderModel,
  sanitizeAggregate
} from '@shared/types/model-db'
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

export class ProviderDbLoader {
  private cache: ProviderAggregate | null = null
  private userDataDir: string
  private cacheDir: string
  private cacheFilePath: string
  private metaFilePath: string

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
    this.cache = this.loadFromCache() ?? this.loadFromBuiltIn()
    if (this.cache) {
      try {
        const providersCount = Object.keys(this.cache.providers || {}).length
        eventBus.send(PROVIDER_DB_EVENTS.LOADED, SendTarget.ALL_WINDOWS, {
          providersCount
        })
      } catch {}
    }

    // Background refresh if needed (npm 缓存风格)
    this.refreshIfNeeded().catch(() => {})
  }

  getDb(): ProviderAggregate | null {
    if (this.cache) return this.cache
    // Lazy try again if not initialized yet
    this.cache = this.loadFromCache() ?? this.loadFromBuiltIn()
    return this.cache
  }

  getProvider(providerId: string): ProviderEntry | undefined {
    const db = this.getDb()
    if (!db) return undefined
    return db.providers?.[providerId]
  }

  getModel(providerId: string, modelId: string): ProviderModel | undefined {
    const provider = this.getProvider(providerId)
    if (!provider) return undefined
    return provider.models.find((m) => m.id === modelId)
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
    const v = env ? Number(env) : 24
    return Number.isFinite(v) && v > 0 ? v : 24
  }

  private getProviderDbUrl(): string {
    const value = import.meta.env.VITE_PROVIDER_DB_URL
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) return trimmed
    }

    return DEFAULT_PROVIDER_DB_URL
  }

  async refreshIfNeeded(force = false): Promise<void> {
    const meta = this.readMeta()
    const ttlHours = this.getTtlHours()
    const url = this.getProviderDbUrl()

    const needFirstFetch = !meta || !fs.existsSync(this.cacheFilePath)
    const expired = meta ? this.now() - meta.lastUpdated > ttlHours * 3600 * 1000 : true

    if (!force && !needFirstFetch && !expired) return

    await this.fetchAndUpdate(url, meta || undefined)
  }

  private async fetchAndUpdate(url: string, prevMeta?: MetaFile): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const headers: Record<string, string> = {}
      if (prevMeta?.etag) headers['If-None-Match'] = prevMeta.etag

      const res = await fetch(url, { headers, signal: controller.signal })
      const now = this.now()

      if (res.status === 304 && prevMeta) {
        // Not modified; update attempted time only
        this.writeMeta({ ...prevMeta, lastAttemptedAt: now })
        return
      }

      if (!res.ok) {
        // Keep old cache
        const meta = prevMeta ? { ...prevMeta, lastAttemptedAt: now } : undefined
        if (meta) this.writeMeta(meta)
        return
      }

      const text = await res.text()
      // Size guard (≈ 5MB)
      if (text.length > 5 * 1024 * 1024) {
        const meta = prevMeta ? { ...prevMeta, lastAttemptedAt: now } : undefined
        if (meta) this.writeMeta(meta)
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        const meta = prevMeta ? { ...prevMeta, lastAttemptedAt: now } : undefined
        if (meta) this.writeMeta(meta)
        return
      }

      const sanitized = sanitizeAggregate(parsed)
      if (!sanitized) {
        const meta = prevMeta ? { ...prevMeta, lastAttemptedAt: now } : undefined
        if (meta) this.writeMeta(meta)
        return
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
      this.cache = sanitized
      try {
        const providersCount = Object.keys(sanitized.providers || {}).length
        eventBus.send(PROVIDER_DB_EVENTS.UPDATED, SendTarget.ALL_WINDOWS, {
          providersCount,
          lastUpdated: meta.lastUpdated
        })
      } catch {}
    } catch {
      // ignore
    } finally {
      clearTimeout(timeout)
    }
  }
}

// Shared singleton
export const providerDbLoader = new ProviderDbLoader()
