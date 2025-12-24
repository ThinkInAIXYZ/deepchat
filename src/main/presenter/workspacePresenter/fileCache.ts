export type FileCacheEntry = {
  content: string
  mtimeMs: number
  cachedAt: number
}

export interface FileCacheOptions {
  maxEntries?: number
  ttlMs?: number
  maxBytes?: number
}

const DEFAULT_MAX_ENTRIES = 200
const DEFAULT_TTL_MS = 60_000
const DEFAULT_MAX_BYTES = 256 * 1024

export class FileCache {
  private readonly cache = new Map<string, FileCacheEntry>()
  private readonly maxEntries: number
  private readonly ttlMs: number
  private readonly maxBytes: number

  constructor(options: FileCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  }

  get(filePath: string, mtimeMs?: number): FileCacheEntry | null {
    const entry = this.cache.get(filePath)
    if (!entry) return null

    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(filePath)
      return null
    }

    if (mtimeMs !== undefined && entry.mtimeMs !== mtimeMs) {
      this.cache.delete(filePath)
      return null
    }

    // Refresh LRU order
    this.cache.delete(filePath)
    this.cache.set(filePath, entry)

    return entry
  }

  set(filePath: string, entry: FileCacheEntry): void {
    if (Buffer.byteLength(entry.content, 'utf8') > this.maxBytes) {
      return
    }

    this.cache.delete(filePath)
    this.cache.set(filePath, entry)
    this.prune()
  }

  delete(filePath: string): void {
    this.cache.delete(filePath)
  }

  clear(): void {
    this.cache.clear()
  }

  private prune(): void {
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value
      if (!oldestKey) {
        return
      }
      this.cache.delete(oldestKey)
    }
  }
}
